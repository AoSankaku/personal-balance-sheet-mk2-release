import { eq, desc, sql, inArray, and, gte, lte, like } from "drizzle-orm";
import { Hono } from "hono";
import type {
  BudgetFundingComponentInput,
  BudgetFundingEffect,
  BudgetFundingInput,
  BudgetFundingKind,
} from "@balance-sheet/shared";
import { createDb, type Env } from "../db";
import {
  accounts,
  journalEntries,
  journalLines,
  journalEntryBudgetAllocations,
  budgetAdjustmentLogs,
  budgetFundingAllocations,
  incomeTransferRequirements,
  depreciationSchedules,
  depreciationEntries,
  loanSettlements,
  accountCompletions,
} from "../db/schema";
import { loadCurrencyDecimalPlaces } from "../lib/currencyPrecision";
import {
  findInvalidMoney,
  fromStorageMoneyAmount,
  invalidMoneyResponse,
  type MoneyScaleOptions,
  toStorageMoneyAmount,
} from "../lib/moneyValidation";
import { resolveAsOfDate } from "../lib/appDate";
import { serializeLoanSettlement } from "../lib/loanSettlement";
import { calculateBudgetFundingImpact } from "../lib/budgetFundingImpact";

/** Categories that are considered long-term loan/lending */
const LONG_TERM_LOAN_CATEGORIES = new Set([
  "loan",
  "long_term_loan",
  "long_term_lending",
]);

type AppDb = ReturnType<typeof createDb>;
type AppTransaction = Parameters<Parameters<AppDb["transaction"]>[0]>[0];
type DbOrTx = AppDb | AppTransaction;
type D1QueryResult<T> = { results?: T[] };

/**
 * After creating or deleting journal lines, re-evaluate long-term loan/lending account
 * completions (balance = 0 with at least one transaction → mark complete; otherwise clear).
 */
async function syncLongTermCompletions(
  db: DbOrTx,
  accountIds: number[],
): Promise<void> {
  if (accountIds.length === 0) return;

  // Fetch accounts that are long-term loan/lending categories
  const ltAccounts = await db
    .select({ id: accounts.id, type: accounts.type })
    .from(accounts)
    .where(
      sql`${accounts.id} IN (${sql.join(
        accountIds.map((id) => sql`${id}`),
        sql`, `,
      )}) AND ${accounts.category} IN ('loan', 'long_term_loan', 'long_term_lending')`,
    );

  for (const acct of ltAccounts) {
    // Compute balance
    const [balRow] = await db
      .select({
        balance: sql<number>`COALESCE(${
          acct.type === "asset"
            ? sql`SUM(${journalLines.debit}) - SUM(${journalLines.credit})`
            : sql`SUM(${journalLines.credit}) - SUM(${journalLines.debit})`
        }, 0)`,
        tx_count: sql<number>`COUNT(*)`,
      })
      .from(journalLines)
      .where(eq(journalLines.account_id, acct.id));

    const balance = balRow?.balance ?? 0;
    const txCount = Number(balRow?.tx_count ?? 0);

    if (balance === 0 && txCount > 0) {
      // Mark as completed (INSERT OR IGNORE via DO NOTHING equivalent)
      await db
        .insert(accountCompletions)
        .values({ account_id: acct.id })
        .onConflictDoNothing();
    } else {
      // Not complete — remove any completion record
      await db
        .delete(accountCompletions)
        .where(eq(accountCompletions.account_id, acct.id));
    }
  }
}

const router = new Hono<{ Bindings: Env }>();
const D1_IN_CLAUSE_CHUNK_SIZE = 50;
const BUDGET_FUNDING_KINDS = new Set<BudgetFundingKind>([
  "borrow",
  "repay",
  "lend",
  "collect",
]);
const BUDGET_FUNDING_EFFECTS = new Set<BudgetFundingEffect>([
  "apply",
  "component_only",
]);

function normalizeBudgetFundingComponents(input: {
  budget_funding?: BudgetFundingInput;
  budget_funding_components?: BudgetFundingComponentInput[];
}): BudgetFundingComponentInput[] {
  if (input.budget_funding_components) return input.budget_funding_components;
  if (!input.budget_funding) return [];
  return [{
    ...input.budget_funding,
    applied_amount: input.budget_funding.principal_amount,
    component_only_amount: 0,
  }];
}

function validateBudgetFundingComponents(
  components: BudgetFundingComponentInput[],
  budgetCurrency: string,
): string | null {
  if (new Set(components.map((component) => component.kind)).size !== components.length) {
    return "duplicate budget_funding_components kind";
  }
  for (const component of components) {
    if (!BUDGET_FUNDING_KINDS.has(component.kind)) {
      return "invalid budget_funding_components kind";
    }
    if (
      !Number.isFinite(component.principal_amount) ||
      !Number.isFinite(component.applied_amount) ||
      !Number.isFinite(component.component_only_amount) ||
      component.principal_amount < 0 ||
      component.applied_amount < 0 ||
      component.component_only_amount < 0
    ) {
      return "invalid budget_funding_components amount";
    }
    if (
      Math.abs(
        component.applied_amount +
          component.component_only_amount -
          component.principal_amount,
      ) > 0.000_001
    ) {
      return "budget funding applied and component-only amounts must equal principal";
    }
    const allocations = component.allocations ?? [];
    if (
      allocations.some(
        (allocation) =>
          allocation.amount <= 0 ||
          !BUDGET_FUNDING_EFFECTS.has(allocation.effect ?? "apply") ||
          normalizeCurrency(allocation.currency ?? budgetCurrency) !==
            budgetCurrency,
      )
    ) {
      return "invalid budget_funding_components allocation";
    }
    if (allocations.length > 0) {
      const applied = allocations
        .filter((allocation) => (allocation.effect ?? "apply") === "apply")
        .reduce((sum, allocation) => sum + allocation.amount, 0);
      const componentOnly = allocations
        .filter((allocation) => allocation.effect === "component_only")
        .reduce((sum, allocation) => sum + allocation.amount, 0);
      if (
        Math.abs(applied - component.applied_amount) > 0.000_001 ||
        Math.abs(componentOnly - component.component_only_amount) > 0.000_001
      ) {
        return "budget funding allocation effects must equal component amounts";
      }
    }
  }
  return null;
}

async function validateBudgetFundingComponentsAgainstLines(input: {
  db: AppDb;
  components: BudgetFundingComponentInput[] | undefined;
  lines: Array<{
    account_id: number;
    debit?: number;
    credit?: number;
    currency?: string;
  }>;
  currency: string;
  decimalPlaces: number;
}): Promise<string | null> {
  if (!input.components) return null;
  const accountIds = [
    ...new Set(input.lines.map((line) => line.account_id)),
  ];
  const accountRows =
    accountIds.length === 0
      ? []
      : await input.db
          .select()
          .from(accounts)
          .where(inArray(accounts.id, accountIds));
  const expected = calculateBudgetFundingImpact({
    lines: input.lines,
    accounts: accountRows.map((account) => ({
      ...account,
      is_depreciable: account.is_depreciable === 1,
      include_in_allocatable: account.include_in_allocatable === 1,
      is_system: account.is_system === 1,
    })),
    currency: input.currency,
    decimalPlaces: input.decimalPlaces,
  }).components;
  const tolerance = 10 ** -input.decimalPlaces / 2;
  if (expected.length !== input.components.length) {
    return "budget funding components do not match journal lines";
  }
  for (const expectedComponent of expected) {
    const saved = input.components.find(
      (component) => component.kind === expectedComponent.kind,
    );
    if (
      !saved ||
      Math.abs(saved.principal_amount - expectedComponent.principal_amount) >
        tolerance ||
      Math.abs(saved.applied_amount - expectedComponent.applied_amount) >
        tolerance ||
      Math.abs(
        saved.component_only_amount -
          expectedComponent.component_only_amount,
      ) > tolerance
    ) {
      return "budget funding components do not match journal lines";
    }
  }
  return null;
}

function expandBudgetFundingComponentAllocations(
  components: BudgetFundingComponentInput[],
  budgetCurrency: string,
) {
  return components.flatMap((component) => {
    const sourceId = component.source_journal_entry_ids?.[0] ?? null;
    const allocations =
      component.allocations && component.allocations.length > 0
        ? component.allocations
        : [
            ...(component.applied_amount > 0
              ? [{
                  budget_category_id: null,
                  amount: component.applied_amount,
                  effect: "apply" as const,
                }]
              : []),
            ...(component.component_only_amount > 0
              ? [{
                  budget_category_id: null,
                  amount: component.component_only_amount,
                  effect: "component_only" as const,
                }]
              : []),
          ];
    return allocations.map((allocation) => ({
      kind: component.kind,
      budget_category_id: allocation.budget_category_id ?? null,
      amount: allocation.amount,
      currency: normalizeCurrency(allocation.currency ?? budgetCurrency),
      effect: allocation.effect ?? "apply",
      source_journal_entry_id:
        allocation.source_journal_entry_id ?? sourceId,
    }));
  });
}

function validateExplicitBudgetFunding(
  funding: BudgetFundingInput | undefined,
  budgetCurrency: string,
): string | null {
  if (!funding) return null;
  if (!Number.isFinite(funding.principal_amount) || funding.principal_amount < 0) {
    return "invalid budget_funding principal_amount";
  }
  if (
    (funding.allocations?.length ?? 0) > 0 &&
    (funding.source_journal_entry_ids?.length ?? 0) > 0
  ) {
    return "budget_funding allocations and source entries are mutually exclusive";
  }
  if (!funding.allocations) return null;
  if (
    funding.allocations.some(
      (allocation) =>
        allocation.amount <= 0 ||
        (allocation.budget_category_id !== null &&
          (!Number.isInteger(allocation.budget_category_id) ||
            allocation.budget_category_id <= 0)) ||
        normalizeCurrency(allocation.currency ?? budgetCurrency) !==
          budgetCurrency,
    )
  ) {
    return "invalid budget_funding allocation";
  }
  const allocated = funding.allocations.reduce(
    (sum, allocation) => sum + allocation.amount,
    0,
  );
  if (Math.abs(allocated - funding.principal_amount) > 0.000_001) {
    return "budget_funding allocations must equal principal_amount";
  }
  return null;
}

function chunkIds(ids: number[], size = D1_IN_CLAUSE_CHUNK_SIZE) {
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

function normalizeCurrency(currency: string | null | undefined): string {
  return (currency || "JPY").toUpperCase();
}

function decodeJournalLineAmount<T extends { debit: number; credit: number; currency: string | null }>(
  line: T,
  scaleOptions: MoneyScaleOptions = {},
) {
  const currency = normalizeCurrency(line.currency);
  return {
    ...line,
    currency,
    debit: fromStorageMoneyAmount(line.debit, currency, scaleOptions),
    credit: fromStorageMoneyAmount(line.credit, currency, scaleOptions),
  };
}

function budgetCurrencyFromLines(
  lines: Array<{ debit?: number; credit?: number; currency?: string }>,
): string {
  const line = lines.find((l) => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0);
  return normalizeCurrency(line?.currency);
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function buildRowsSql(rowCount: number, columnsPerRow: number): string {
  const row = `(${placeholders(columnsPerRow)})`;
  return Array.from({ length: rowCount }, () => row).join(", ");
}

function buildNewEntryRowsSql(rowCount: number, columnsPerRow: number): string {
  const row = `((SELECT MAX(id) FROM journal_entries), ${placeholders(
    columnsPerRow,
  )})`;
  return Array.from({ length: rowCount }, () => row).join(", ");
}

// GET /api/journal — all journal entries with lines + account names
router.get("/", async (c) => {
  const db = createDb(c.env);
  const decimalPlacesByCurrency = await loadCurrencyDecimalPlaces(db);
  const scaleOptions = { decimalPlacesByCurrency };
  const asOf = resolveAsOfDate(c.req.query("as_of"));

  const entries = await db
    .select()
    .from(journalEntries)
    .orderBy(desc(journalEntries.date), desc(journalEntries.id));

  if (entries.length === 0) return c.json([]);

  const entryIds = entries.map((e) => e.id);
  const entryIdChunks = chunkIds(entryIds);

  // Fetch all lines for these entries
  const lineChunks = await Promise.all(
    entryIdChunks.map((ids) =>
      db
        .select({
          id: journalLines.id,
          journal_entry_id: journalLines.journal_entry_id,
          account_id: journalLines.account_id,
          account_name: accounts.name,
          debit: journalLines.debit,
          credit: journalLines.credit,
          currency: journalLines.currency,
          credit_card_billing_offset_months:
            journalLines.credit_card_billing_offset_months,
        })
        .from(journalLines)
        .leftJoin(accounts, eq(journalLines.account_id, accounts.id))
        .where(
          sql`${journalLines.journal_entry_id} IN (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        ),
    ),
  );
  const lines = lineChunks.flat();

  const linesMap = new Map<number, typeof lines>();
  for (const line of lines) {
    const arr = linesMap.get(line.journal_entry_id) ?? [];
    arr.push(line);
    linesMap.set(line.journal_entry_id, arr);
  }

  // Fetch expense budget allocations for these entries
  const allocationChunks = await Promise.all(
    entryIdChunks.map((ids) =>
      db
        .select()
        .from(journalEntryBudgetAllocations)
        .where(
          sql`${journalEntryBudgetAllocations.journal_entry_id} IN (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        ),
    ),
  );
  const allocations = allocationChunks.flat();

  const allocsMap = new Map<number, typeof allocations>();
  for (const alloc of allocations) {
    const arr = allocsMap.get(alloc.journal_entry_id) ?? [];
    arr.push(alloc);
    allocsMap.set(alloc.journal_entry_id, arr);
  }

  // Fetch income budget allocations for these entries (from budget_adjustment_logs)
  const incomeAllocChunks = await Promise.all(
    entryIdChunks.map((ids) =>
      db
        .select()
        .from(budgetAdjustmentLogs)
        .where(
          sql`${budgetAdjustmentLogs.journal_entry_id} IN (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        ),
    ),
  );
  const incomeAllocs = incomeAllocChunks.flat();

  const incomeAllocsMap = new Map<
    number,
    {
      budget_category_id: number;
      amount: number;
      currency: string;
      adjustment_type: "allocation" | "transfer";
    }[]
  >();
  for (const alloc of incomeAllocs) {
    if (alloc.journal_entry_id == null) continue;
    const arr = incomeAllocsMap.get(alloc.journal_entry_id) ?? [];
    const currency = normalizeCurrency(alloc.currency);
    arr.push({
      budget_category_id: alloc.budget_category_id,
      amount: fromStorageMoneyAmount(alloc.amount, currency, scaleOptions),
      currency,
      adjustment_type:
        alloc.adjustment_type === "transfer" ? "transfer" : "allocation",
    });
    incomeAllocsMap.set(alloc.journal_entry_id, arr);
  }

  const fundingChunks = await Promise.all(
    entryIdChunks.map((ids) =>
      db
        .select()
        .from(budgetFundingAllocations)
        .where(inArray(budgetFundingAllocations.journal_entry_id, ids)),
    ),
  );
  const fundingRows = fundingChunks.flat();
  const incomeTransferChunks = await Promise.all(
    entryIdChunks.map((ids) =>
      db
        .select()
        .from(incomeTransferRequirements)
        .where(
          inArray(
            incomeTransferRequirements.source_income_journal_entry_id,
            ids,
          ),
        ),
    ),
  );
  const incomeTransferRows = incomeTransferChunks.flat();
  const incomeTransfersBySource = new Map<
    number,
    Array<typeof incomeTransferRequirements.$inferSelect>
  >();
  for (const requirement of incomeTransferRows) {
    const rows =
      incomeTransfersBySource.get(
        requirement.source_income_journal_entry_id,
      ) ?? [];
    rows.push(requirement);
    incomeTransfersBySource.set(
      requirement.source_income_journal_entry_id,
      rows,
    );
  }
  const childTransferChunks = await Promise.all(
    entryIdChunks.map((ids) =>
      db
        .select({
          id: incomeTransferRequirements.id,
          transfer_journal_entry_id:
            incomeTransferRequirements.transfer_journal_entry_id,
          source_income_journal_entry_id:
            incomeTransferRequirements.source_income_journal_entry_id,
        })
        .from(incomeTransferRequirements)
        .where(inArray(incomeTransferRequirements.transfer_journal_entry_id, ids)),
    ),
  );
  const incomeSourceByTransfer = new Map<number, number>();
  const incomeRequirementIdsByTransfer = new Map<number, number[]>();
  for (const requirement of childTransferChunks.flat()) {
    if (requirement.transfer_journal_entry_id != null) {
      incomeSourceByTransfer.set(
        requirement.transfer_journal_entry_id,
        requirement.source_income_journal_entry_id,
      );
      const requirementIds =
        incomeRequirementIdsByTransfer.get(
          requirement.transfer_journal_entry_id,
        ) ?? [];
      requirementIds.push(requirement.id);
      incomeRequirementIdsByTransfer.set(
        requirement.transfer_journal_entry_id,
        requirementIds,
      );
    }
  }
  const fundingByEntry = new Map<
    number,
    {
      kind: BudgetFundingKind;
      allocations: Array<{
        kind: BudgetFundingKind;
        id: number;
        budget_category_id: number | null;
        amount: number;
        currency: string;
        source_journal_entry_id: number | null;
        effect: BudgetFundingEffect;
      }>;
    }
  >();
  for (const row of fundingRows) {
    const currency = normalizeCurrency(row.currency);
    const record = fundingByEntry.get(row.journal_entry_id) ?? {
      kind: row.kind,
      allocations: [],
    };
    record.allocations.push({
      kind: row.kind,
      id: row.id,
      budget_category_id: row.budget_category_id,
      amount: fromStorageMoneyAmount(row.amount, currency, scaleOptions),
      currency,
      source_journal_entry_id: row.source_journal_entry_id,
      effect: row.effect,
    });
    fundingByEntry.set(row.journal_entry_id, record);
  }
  const fundingComponentsByEntry = new Map<
    number,
    Array<{
      kind: BudgetFundingKind;
      principal_amount: number;
      applied_amount: number;
      component_only_amount: number;
      allocations: Array<{
        kind: BudgetFundingKind;
        id: number;
        budget_category_id: number | null;
        amount: number;
        currency: string;
        source_journal_entry_id: number | null;
        effect: BudgetFundingEffect;
      }>;
      source_journal_entry_ids: number[];
    }>
  >();
  for (const [entryId, funding] of fundingByEntry) {
    const byKind = new Map<BudgetFundingKind, typeof funding.allocations>();
    for (const allocation of funding.allocations) {
      const rows = byKind.get(allocation.kind ?? funding.kind) ?? [];
      rows.push(allocation);
      byKind.set(allocation.kind ?? funding.kind, rows);
    }
    fundingComponentsByEntry.set(
      entryId,
      [...byKind].map(([kind, allocationsForKind]) => ({
        kind,
        principal_amount: allocationsForKind.reduce(
          (sum, allocation) => sum + allocation.amount,
          0,
        ),
        applied_amount: allocationsForKind
          .filter((allocation) => allocation.effect === "apply")
          .reduce((sum, allocation) => sum + allocation.amount, 0),
        component_only_amount: allocationsForKind
          .filter((allocation) => allocation.effect === "component_only")
          .reduce((sum, allocation) => sum + allocation.amount, 0),
        allocations: allocationsForKind,
        source_journal_entry_ids: [
          ...new Set(
            allocationsForKind
              .map((allocation) => allocation.source_journal_entry_id)
              .filter((sourceId): sourceId is number => sourceId != null),
          ),
        ],
      })),
    );
  }

  const settlementChunks = await Promise.all(
    entryIdChunks.map((ids) =>
      db
        .select({
          journal_entry_id: loanSettlements.journal_entry_id,
          is_settled: loanSettlements.is_settled,
          settled_by_journal_entry_id:
            loanSettlements.settled_by_journal_entry_id,
          settled_at: loanSettlements.settled_at,
        })
        .from(loanSettlements)
        .where(inArray(loanSettlements.journal_entry_id, ids)),
    ),
  );
  const settlements = settlementChunks.flat();
  const settlementSourceChunks = await Promise.all(
    entryIdChunks.map((ids) =>
      db
        .select({
          journal_entry_id: loanSettlements.journal_entry_id,
          settled_by_journal_entry_id:
            loanSettlements.settled_by_journal_entry_id,
        })
        .from(loanSettlements)
        .where(inArray(loanSettlements.settled_by_journal_entry_id, ids)),
    ),
  );
  const settlementSourcesByEntry = new Map<number, number[]>();
  for (const settlement of settlementSourceChunks.flat()) {
    if (settlement.settled_by_journal_entry_id == null) continue;
    const sourceIds =
      settlementSourcesByEntry.get(settlement.settled_by_journal_entry_id) ??
      [];
    sourceIds.push(settlement.journal_entry_id);
    settlementSourcesByEntry.set(
      settlement.settled_by_journal_entry_id,
      sourceIds,
    );
  }
  const settledByIds = [
    ...new Set(
      settlements
        .map((s) => s.settled_by_journal_entry_id)
        .filter((id): id is number => id != null),
    ),
  ];
  const settledByRows =
    settledByIds.length > 0
      ? await db
          .select({ id: journalEntries.id, date: journalEntries.date })
          .from(journalEntries)
          .where(inArray(journalEntries.id, settledByIds))
      : [];
  const settledByDate = new Map(settledByRows.map((row) => [row.id, row.date]));
  const settlementByEntry = new Map(
    settlements.map((s) => [
      s.journal_entry_id,
      serializeLoanSettlement({
        is_settled: s.is_settled,
        settled_by_journal_entry_id: s.settled_by_journal_entry_id,
        settled_by_entry_date:
          s.settled_by_journal_entry_id == null
            ? null
            : settledByDate.get(s.settled_by_journal_entry_id),
        settled_at: s.settled_at,
        asOf,
      }),
    ]),
  );

  // Fetch depreciation schedule IDs for source purchase entries
  const sourceScheduleChunks = await Promise.all(
    entryIdChunks.map((ids) =>
      db
        .select({
          source_journal_entry_id:
            depreciationSchedules.source_journal_entry_id,
          id: depreciationSchedules.id,
        })
        .from(depreciationSchedules)
        .where(inArray(depreciationSchedules.source_journal_entry_id, ids)),
    ),
  );
  const sourceScheduleRows = sourceScheduleChunks.flat();
  const monthlyScheduleChunks = await Promise.all(
    entryIdChunks.map((ids) =>
      db
        .select({
          journal_entry_id: depreciationEntries.journal_entry_id,
          schedule_id: depreciationEntries.schedule_id,
        })
        .from(depreciationEntries)
        .where(inArray(depreciationEntries.journal_entry_id, ids)),
    ),
  );
  const monthlyScheduleRows = monthlyScheduleChunks.flat();

  const scheduleByEntry = new Map<number, number>(
    sourceScheduleRows.map((s) => [s.source_journal_entry_id, s.id]),
  );
  const scheduleKindByEntry = new Map<number, "source" | "monthly">(
    sourceScheduleRows.map((s) => [s.source_journal_entry_id, "source"]),
  );
  for (const row of monthlyScheduleRows) {
    scheduleByEntry.set(row.journal_entry_id, row.schedule_id);
    scheduleKindByEntry.set(row.journal_entry_id, "monthly");
  }

  const result = entries.map((entry) => ({
    ...entry,
    lines: (linesMap.get(entry.id) ?? []).map((l) => ({
      ...decodeJournalLineAmount(l, scaleOptions),
      account_name: l.account_name ?? "Unknown",
      credit_card_billing_offset_months:
        l.credit_card_billing_offset_months ?? null,
    })),
    budget_allocations: (allocsMap.get(entry.id) ?? []).map((a) => ({
      budget_category_id: a.budget_category_id,
      amount: fromStorageMoneyAmount(a.amount, a.currency, scaleOptions),
      currency: normalizeCurrency(a.currency),
      source: a.source,
    })),
    income_budget_allocations: incomeAllocsMap.get(entry.id) ?? [],
    depreciation_schedule_id: scheduleByEntry.get(entry.id) ?? null,
    depreciation_entry_kind: scheduleKindByEntry.get(entry.id) ?? null,
    loan_settlement: settlementByEntry.get(entry.id) ?? null,
    loan_settlement_source_journal_entry_ids:
      settlementSourcesByEntry.get(entry.id) ?? [],
    budget_funding:
      (fundingComponentsByEntry.get(entry.id)?.length ?? 0) === 1
        ? fundingByEntry.get(entry.id) ?? null
        : null,
    budget_funding_components: fundingComponentsByEntry.get(entry.id) ?? [],
    income_transfer_requirements: (
      incomeTransfersBySource.get(entry.id) ?? []
    ).map((requirement) => ({
      ...requirement,
      amount: fromStorageMoneyAmount(
        requirement.amount,
        requirement.currency,
        scaleOptions,
      ),
    })),
    income_transfer_source_journal_entry_id:
      incomeSourceByTransfer.get(entry.id) ?? null,
    income_transfer_requirement_ids: [
      ...(incomeRequirementIdsByTransfer.get(entry.id) ?? []),
    ].sort((left, right) => left - right),
  }));

  return c.json(result);
});

// POST /api/journal — create journal entry with lines atomically
router.post("/", async (c) => {
  const body = await c.req.json<{
    date: string;
    description: string;
    lines: Array<{
      account_id: number;
      debit: number;
      credit: number;
      currency?: string;
      credit_card_billing_offset_months?: number | null;
    }>;
    budget_allocations?: Array<{
      budget_category_id: number;
      amount: number;
      currency?: string;
    }>;
    budget_source?: "simple" | "multiline";
    income_budget_allocations?: Array<{
      budget_category_id: number;
      amount: number;
      currency?: string;
      adjustment_type?: "allocation" | "reset" | "transfer";
    }>;
    /** If true, this entry opens a new short-term loan/lending — create a loan_settlements record */
    loan_settlement_opening?: boolean;
    /** IDs of opening entries being settled by this repayment/collection */
    loan_settlement_journal_entry_ids?: number[];
    budget_funding?: BudgetFundingInput;
    budget_funding_components?: BudgetFundingComponentInput[];
    income_transfer_destinations?: Array<{
      budget_category_id: number;
      from_account_id: number;
      to_account_id: number;
      amount: number;
      currency?: string;
    }>;
    /** Skip debit=credit balance check for currency exchange entries */
    is_currency_exchange?: boolean;
  }>();

  if (
    !body.date ||
    !body.description ||
    !Array.isArray(body.lines) ||
    body.lines.length < 2
  ) {
    return c.json(
      { error: "date, description, and at least 2 lines are required" },
      400,
    );
  }

  const db = createDb(c.env);
  const decimalPlacesByCurrency = await loadCurrencyDecimalPlaces(db);
  const scaleOptions = { decimalPlacesByCurrency };

  const invalidMoney = findInvalidMoney([
    ...body.lines.flatMap((line, index) => [
      {
        path: `lines[${index}].debit`,
        value: line.debit,
        currency: line.currency,
        decimalPlaces: decimalPlacesByCurrency[normalizeCurrency(line.currency)],
      },
      {
        path: `lines[${index}].credit`,
        value: line.credit,
        currency: line.currency,
        decimalPlaces: decimalPlacesByCurrency[normalizeCurrency(line.currency)],
      },
    ]),
    ...(body.budget_allocations ?? []).map((allocation, index) => ({
      path: `budget_allocations[${index}].amount`,
      value: allocation.amount,
      currency: allocation.currency ?? budgetCurrencyFromLines(body.lines),
      decimalPlaces:
        decimalPlacesByCurrency[
          normalizeCurrency(allocation.currency ?? budgetCurrencyFromLines(body.lines))
        ],
    })),
    ...(body.income_budget_allocations ?? []).map((allocation, index) => ({
      path: `income_budget_allocations[${index}].amount`,
      value: allocation.amount,
      currency: allocation.currency ?? budgetCurrencyFromLines(body.lines),
      decimalPlaces:
        decimalPlacesByCurrency[
          normalizeCurrency(allocation.currency ?? budgetCurrencyFromLines(body.lines))
        ],
    })),
    ...(body.budget_funding?.allocations ?? []).map((allocation, index) => ({
      path: `budget_funding.allocations[${index}].amount`,
      value: allocation.amount,
      currency: allocation.currency ?? budgetCurrencyFromLines(body.lines),
      decimalPlaces:
        decimalPlacesByCurrency[
          normalizeCurrency(
            allocation.currency ?? budgetCurrencyFromLines(body.lines),
          )
        ],
    })),
    ...(body.budget_funding
      ? [
          {
            path: "budget_funding.principal_amount",
            value: body.budget_funding.principal_amount,
            currency: budgetCurrencyFromLines(body.lines),
            decimalPlaces:
              decimalPlacesByCurrency[
                normalizeCurrency(budgetCurrencyFromLines(body.lines))
              ],
          },
        ]
      : []),
    ...normalizeBudgetFundingComponents(body).flatMap((component, index) => [
      {
        path: `budget_funding_components[${index}].principal_amount`,
        value: component.principal_amount,
        currency: budgetCurrencyFromLines(body.lines),
        decimalPlaces:
          decimalPlacesByCurrency[budgetCurrencyFromLines(body.lines)],
      },
      {
        path: `budget_funding_components[${index}].applied_amount`,
        value: component.applied_amount,
        currency: budgetCurrencyFromLines(body.lines),
        decimalPlaces:
          decimalPlacesByCurrency[budgetCurrencyFromLines(body.lines)],
      },
      {
        path: `budget_funding_components[${index}].component_only_amount`,
        value: component.component_only_amount,
        currency: budgetCurrencyFromLines(body.lines),
        decimalPlaces:
          decimalPlacesByCurrency[budgetCurrencyFromLines(body.lines)],
      },
      ...(component.allocations ?? []).map((allocation, allocationIndex) => ({
        path: `budget_funding_components[${index}].allocations[${allocationIndex}].amount`,
        value: allocation.amount,
        currency: allocation.currency ?? budgetCurrencyFromLines(body.lines),
        decimalPlaces:
          decimalPlacesByCurrency[
            normalizeCurrency(
              allocation.currency ?? budgetCurrencyFromLines(body.lines),
            )
          ],
      })),
    ]),
    ...(body.income_transfer_destinations ?? []).map((destination, index) => ({
      path: `income_transfer_destinations[${index}].amount`,
      value: destination.amount,
      currency: destination.currency ?? budgetCurrencyFromLines(body.lines),
      decimalPlaces:
        decimalPlacesByCurrency[
          normalizeCurrency(
            destination.currency ?? budgetCurrencyFromLines(body.lines),
          )
        ],
    })),
  ]);
  if (invalidMoney) {
    return c.json(
      invalidMoneyResponse(invalidMoney.path, invalidMoney.currency),
      400,
    );
  }

  if (!body.is_currency_exchange) {
    const totalDebit = body.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const totalCredit = body.lines.reduce((s, l) => s + (l.credit ?? 0), 0);

    if (Math.abs(totalDebit - totalCredit) > 0.001) {
      return c.json(
        {
          error: `Unbalanced entry: debit ${totalDebit} ≠ credit ${totalCredit}`,
        },
        400,
      );
    }
  }
  if (
    body.budget_funding &&
    !BUDGET_FUNDING_KINDS.has(body.budget_funding.kind)
  ) {
    return c.json({ error: "invalid budget_funding kind" }, 400);
  }

  const budgetCurrency = budgetCurrencyFromLines(body.lines);
  const fundingValidationError = validateExplicitBudgetFunding(
    body.budget_funding,
    budgetCurrency,
  );
  if (fundingValidationError) {
    return c.json({ error: fundingValidationError }, 400);
  }
  const componentValidationError = validateBudgetFundingComponents(
    normalizeBudgetFundingComponents(body),
    budgetCurrency,
  );
  if (componentValidationError) {
    return c.json({ error: componentValidationError }, 400);
  }
  const componentLineValidationError =
    await validateBudgetFundingComponentsAgainstLines({
      db,
      components: body.budget_funding_components,
      lines: body.lines,
      currency: budgetCurrency,
      decimalPlaces: decimalPlacesByCurrency[budgetCurrency] ?? 0,
    });
  if (componentLineValidationError) {
    return c.json({ error: componentLineValidationError }, 400);
  }
  const validAllocations = (body.budget_allocations ?? []).filter(
    (a) => a.budget_category_id && a.amount !== 0,
  );
  const validIncomeAllocs = (body.income_budget_allocations ?? []).filter(
    (a) => a.budget_category_id && a.amount !== 0,
  );
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO journal_entries (date, description, source)
       VALUES (?, ?, 'manual')
       RETURNING id, date, description, source, created_at`,
    ).bind(body.date, body.description),
  ];

  const lineValues = body.lines.flatMap((l) => [
    l.account_id,
    toStorageMoneyAmount(l.debit ?? 0, l.currency, scaleOptions),
    toStorageMoneyAmount(l.credit ?? 0, l.currency, scaleOptions),
    normalizeCurrency(l.currency),
    l.credit_card_billing_offset_months ?? null,
  ]);
  const lineResultIndex = statements.length;
  statements.push(
    c.env.DB.prepare(
      `INSERT INTO journal_lines
        (journal_entry_id, account_id, debit, credit, currency, credit_card_billing_offset_months)
       VALUES ${buildNewEntryRowsSql(body.lines.length, 5)}
       RETURNING id, journal_entry_id, account_id, debit, credit, currency, credit_card_billing_offset_months, created_at`,
    ).bind(...lineValues),
  );

  if (validAllocations.length > 0) {
    const allocationValues = validAllocations.flatMap((a) => [
      a.budget_category_id,
      toStorageMoneyAmount(
        a.amount,
        a.currency ?? budgetCurrency,
        scaleOptions,
      ),
      normalizeCurrency(a.currency ?? budgetCurrency),
      body.budget_source ?? null,
    ]);
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO journal_entry_budget_allocations
          (journal_entry_id, budget_category_id, amount, currency, source)
         VALUES ${buildNewEntryRowsSql(validAllocations.length, 4)}`,
      ).bind(...allocationValues),
    );
  }

  if (validIncomeAllocs.length > 0) {
    const incomeValues = validIncomeAllocs.flatMap((a) => [
      a.budget_category_id,
      toStorageMoneyAmount(
        a.amount,
        a.currency ?? budgetCurrency,
        scaleOptions,
      ),
      normalizeCurrency(a.currency ?? budgetCurrency),
      body.date.slice(0, 7),
      body.date,
      a.adjustment_type === "transfer" ? "transfer" : "allocation",
    ]);
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO budget_adjustment_logs
          (journal_entry_id, budget_category_id, amount, currency, year_month, date, adjustment_type)
         VALUES ${buildNewEntryRowsSql(validIncomeAllocs.length, 6)}`,
      ).bind(...incomeValues),
    );
  }

  if (body.loan_settlement_opening) {
    statements.push(
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO loan_settlements (journal_entry_id, is_settled)
         VALUES ((SELECT MAX(id) FROM journal_entries), 0)`,
      ),
    );
  }

  const settleIds = body.loan_settlement_journal_entry_ids ?? [];
  if (settleIds.length > 0) {
    statements.push(
      c.env.DB.prepare(
        `UPDATE loan_settlements
         SET is_settled = 1,
             settled_by_journal_entry_id = (SELECT MAX(id) FROM journal_entries),
             settled_at = ?
         WHERE journal_entry_id IN (${placeholders(settleIds.length)})`,
      ).bind(new Date().toISOString(), ...settleIds),
    );
  }

  const funding = body.budget_funding;
  const componentRows = body.budget_funding_components
    ? expandBudgetFundingComponentAllocations(
        body.budget_funding_components,
        budgetCurrency,
      )
    : [];
  const explicitFundingAllocations = (funding?.allocations ?? []).filter(
    (allocation) => allocation.amount > 0,
  );
  const fundingSourceIds = funding?.source_journal_entry_ids ?? [];
  if (componentRows.length > 0) {
    const values = componentRows.flatMap((allocation) => [
      allocation.budget_category_id,
      allocation.kind,
      toStorageMoneyAmount(
        allocation.amount,
        allocation.currency,
        scaleOptions,
      ),
      allocation.currency,
      allocation.source_journal_entry_id,
      allocation.effect,
    ]);
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO budget_funding_allocations
          (journal_entry_id, budget_category_id, kind, amount, currency, source_journal_entry_id, effect)
         VALUES ${buildNewEntryRowsSql(componentRows.length, 6)}`,
      ).bind(...values),
    );
  } else if (funding && fundingSourceIds.length > 0) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO budget_funding_allocations
          (journal_entry_id, budget_category_id, kind, amount, currency, source_journal_entry_id, effect)
         SELECT
          (SELECT MAX(id) FROM journal_entries),
          budget_category_id,
          ?,
          amount,
          currency,
          journal_entry_id,
          effect
         FROM budget_funding_allocations
         WHERE journal_entry_id IN (${placeholders(fundingSourceIds.length)})
           AND source_journal_entry_id IS NULL`,
      ).bind(funding.kind, ...fundingSourceIds),
    );
  } else if (funding && explicitFundingAllocations.length > 0) {
    const values = explicitFundingAllocations.flatMap((allocation) => [
      allocation.budget_category_id ?? null,
      funding.kind,
      toStorageMoneyAmount(
        allocation.amount,
        allocation.currency ?? budgetCurrency,
        scaleOptions,
      ),
      normalizeCurrency(allocation.currency ?? budgetCurrency),
      null,
      allocation.effect ?? "apply",
    ]);
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO budget_funding_allocations
          (journal_entry_id, budget_category_id, kind, amount, currency, source_journal_entry_id, effect)
         VALUES ${buildNewEntryRowsSql(explicitFundingAllocations.length, 6)}`,
      ).bind(...values),
    );
  } else if (!funding && settleIds.length > 0) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO budget_funding_allocations
          (journal_entry_id, budget_category_id, kind, amount, currency, source_journal_entry_id, effect)
         SELECT
          (SELECT MAX(id) FROM journal_entries),
          budget_category_id,
          CASE kind
            WHEN 'borrow' THEN 'repay'
            WHEN 'lend' THEN 'collect'
            ELSE kind
          END,
          amount,
          currency,
          journal_entry_id,
          effect
         FROM budget_funding_allocations
         WHERE journal_entry_id IN (${placeholders(settleIds.length)})
           AND source_journal_entry_id IS NULL`,
      ).bind(...settleIds),
    );
  }

  for (const destination of body.income_transfer_destinations ?? []) {
    if (
      !Number.isInteger(destination.budget_category_id) ||
      !Number.isInteger(destination.from_account_id) ||
      !Number.isInteger(destination.to_account_id) ||
      destination.from_account_id === destination.to_account_id ||
      destination.amount <= 0
    ) {
      return c.json({ error: "invalid income transfer destination" }, 400);
    }
    const currency = normalizeCurrency(destination.currency ?? budgetCurrency);
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO income_transfer_requirements
          (source_income_journal_entry_id, budget_category_id, budget_category_name,
           from_account_id, to_account_id, amount, currency)
         SELECT
          (SELECT MAX(id) FROM journal_entries), ?, name, ?, ?, ?, ?
         FROM budget_categories
         WHERE id = ?`,
      ).bind(
        destination.budget_category_id,
        destination.from_account_id,
        destination.to_account_id,
        toStorageMoneyAmount(destination.amount, currency, scaleOptions),
        currency,
        destination.budget_category_id,
      ),
    );
  }

  const results = await c.env.DB.batch(statements);
  const entry = (results[0] as D1QueryResult<typeof journalEntries.$inferSelect>)
    .results?.[0];
  if (!entry) throw new Error("Failed to create journal entry");
  const rawLines =
    (results[lineResultIndex] as D1QueryResult<typeof journalLines.$inferSelect>)
      .results ?? [];
  const insertedLines = rawLines.map((line) =>
    decodeJournalLineAmount(line, scaleOptions),
  );

  await syncLongTermCompletions(
    db,
    body.lines.map((l) => l.account_id),
  );

  return c.json({ ...entry, lines: insertedLines }, 201);
});

// POST /api/journal/batch — create multiple journal entries
router.post("/batch", async (c) => {
  const body = await c.req.json<{
    entries: Array<{
      date: string;
      description: string;
      lines: Array<{
        account_id: number;
        debit: number;
        credit: number;
        currency?: string;
        credit_card_billing_offset_months?: number | null;
      }>;
      budget_allocations?: Array<{
        budget_category_id: number;
        amount: number;
        currency?: string;
      }>;
    }>;
  }>();

  if (!Array.isArray(body.entries) || body.entries.length === 0) {
    return c.json(
      { error: "entries array is required and must not be empty" },
      400,
    );
  }

  const db = createDb(c.env);
  const decimalPlacesByCurrency = await loadCurrencyDecimalPlaces(db);
  const scaleOptions = { decimalPlacesByCurrency };

  const invalidMoney = findInvalidMoney(
    body.entries.flatMap((entry, entryIndex) => [
      ...(Array.isArray(entry.lines)
        ? entry.lines.flatMap((line, lineIndex) => [
            {
              path: `entries[${entryIndex}].lines[${lineIndex}].debit`,
              value: line.debit,
              currency: line.currency,
              decimalPlaces:
                decimalPlacesByCurrency[normalizeCurrency(line.currency)],
            },
            {
              path: `entries[${entryIndex}].lines[${lineIndex}].credit`,
              value: line.credit,
              currency: line.currency,
              decimalPlaces:
                decimalPlacesByCurrency[normalizeCurrency(line.currency)],
            },
          ])
        : []),
      ...(entry.budget_allocations ?? []).map((allocation, allocationIndex) => ({
        path: `entries[${entryIndex}].budget_allocations[${allocationIndex}].amount`,
        value: allocation.amount,
        currency: allocation.currency ?? budgetCurrencyFromLines(entry.lines),
        decimalPlaces:
          decimalPlacesByCurrency[
            normalizeCurrency(allocation.currency ?? budgetCurrencyFromLines(entry.lines))
          ],
      })),
    ]),
  );
  if (invalidMoney) {
    return c.json(
      invalidMoneyResponse(invalidMoney.path, invalidMoney.currency),
      400,
    );
  }

  const created = [];

  for (const entry of body.entries) {
    if (
      !entry.date ||
      !entry.description ||
      !Array.isArray(entry.lines) ||
      entry.lines.length < 2
    ) {
      continue; // skip malformed entries
    }

    const totalDebit = entry.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const totalCredit = entry.lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.001) continue; // skip unbalanced

    const insertedEntries = await db
      .insert(journalEntries)
      .values({
        date: entry.date,
        description: entry.description,
        source: "csv_import",
      })
      .returning();
    const newEntry = insertedEntries[0];
    if (!newEntry) continue;

    const insertedLines = await db
      .insert(journalLines)
      .values(
        entry.lines.map((l) => ({
          journal_entry_id: newEntry.id,
          account_id: l.account_id,
          debit: toStorageMoneyAmount(l.debit ?? 0, l.currency, scaleOptions),
          credit: toStorageMoneyAmount(l.credit ?? 0, l.currency, scaleOptions),
          currency: normalizeCurrency(l.currency),
          credit_card_billing_offset_months:
            l.credit_card_billing_offset_months ?? null,
        })),
      )
      .returning();

    const validAllocations = (entry.budget_allocations ?? []).filter(
      (a) => a.budget_category_id && a.amount !== 0,
    );
    const budgetCurrency = budgetCurrencyFromLines(entry.lines);
    if (validAllocations.length > 0) {
      await db.insert(journalEntryBudgetAllocations).values(
        validAllocations.map((a) => ({
          journal_entry_id: newEntry.id,
          budget_category_id: a.budget_category_id,
          amount: toStorageMoneyAmount(
            a.amount,
            a.currency ?? budgetCurrency,
            scaleOptions,
          ),
          currency: normalizeCurrency(a.currency ?? budgetCurrency),
        })),
      );
    }

    created.push({
      ...newEntry,
      lines: insertedLines.map((line) =>
        decodeJournalLineAmount(line, scaleOptions),
      ),
    });
  }

  return c.json(created, 201);
});

// GET /api/journal/:id — fetch a single journal entry with lines + budget allocations
router.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const db = createDb(c.env);
  const decimalPlacesByCurrency = await loadCurrencyDecimalPlaces(db);
  const scaleOptions = { decimalPlacesByCurrency };
  const asOf = resolveAsOfDate(c.req.query("as_of"));

  const [entry] = await db
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.id, id));
  if (!entry) return c.json({ error: "Not found" }, 404);

  const lines = await db
    .select({
      id: journalLines.id,
      journal_entry_id: journalLines.journal_entry_id,
      account_id: journalLines.account_id,
      account_name: accounts.name,
      debit: journalLines.debit,
      credit: journalLines.credit,
      currency: journalLines.currency,
      credit_card_billing_offset_months:
        journalLines.credit_card_billing_offset_months,
    })
    .from(journalLines)
    .leftJoin(accounts, eq(journalLines.account_id, accounts.id))
    .where(eq(journalLines.journal_entry_id, id));

  const allocations = await db
    .select()
    .from(journalEntryBudgetAllocations)
    .where(eq(journalEntryBudgetAllocations.journal_entry_id, id));

  const incomeAllocations = await db
    .select()
    .from(budgetAdjustmentLogs)
    .where(eq(budgetAdjustmentLogs.journal_entry_id, id));

  const fundingRows = await db
    .select()
    .from(budgetFundingAllocations)
    .where(eq(budgetFundingAllocations.journal_entry_id, id));
  const incomeTransferRows = await db
    .select()
    .from(incomeTransferRequirements)
    .where(eq(incomeTransferRequirements.source_income_journal_entry_id, id));
  const childRequirementRows = await db
    .select({
      id: incomeTransferRequirements.id,
      source_income_journal_entry_id:
        incomeTransferRequirements.source_income_journal_entry_id,
    })
    .from(incomeTransferRequirements)
    .where(eq(incomeTransferRequirements.transfer_journal_entry_id, id));

  const [settlement] = await db
    .select({
      is_settled: loanSettlements.is_settled,
      settled_by_journal_entry_id: loanSettlements.settled_by_journal_entry_id,
      settled_at: loanSettlements.settled_at,
    })
    .from(loanSettlements)
    .where(eq(loanSettlements.journal_entry_id, id));
  const settlementSources = await db
    .select({ journal_entry_id: loanSettlements.journal_entry_id })
    .from(loanSettlements)
    .where(eq(loanSettlements.settled_by_journal_entry_id, id));
  const [settledByEntry] =
    settlement?.settled_by_journal_entry_id == null
      ? []
      : await db
          .select({ date: journalEntries.date })
          .from(journalEntries)
          .where(eq(journalEntries.id, settlement.settled_by_journal_entry_id));

  const [sourceSchedule] = await db
    .select({
      id: depreciationSchedules.id,
    })
    .from(depreciationSchedules)
    .where(eq(depreciationSchedules.source_journal_entry_id, id));

  const [monthlySchedule] = await db
    .select({
      schedule_id: depreciationEntries.schedule_id,
    })
    .from(depreciationEntries)
    .where(eq(depreciationEntries.journal_entry_id, id));

  return c.json({
    ...entry,
    lines: lines.map((l) => ({
      ...decodeJournalLineAmount(l, scaleOptions),
      account_name: l.account_name ?? "Unknown",
      credit_card_billing_offset_months:
        l.credit_card_billing_offset_months ?? null,
    })),
    budget_allocations: allocations.map((a) => ({
      budget_category_id: a.budget_category_id,
      amount: fromStorageMoneyAmount(a.amount, a.currency, scaleOptions),
      currency: normalizeCurrency(a.currency),
      source: a.source,
    })),
    income_budget_allocations: incomeAllocations.map((a) => ({
      budget_category_id: a.budget_category_id,
      amount: fromStorageMoneyAmount(a.amount, a.currency, scaleOptions),
      currency: normalizeCurrency(a.currency),
      adjustment_type:
        a.adjustment_type === "transfer" ? "transfer" : "allocation",
    })),
    depreciation_schedule_id:
      sourceSchedule?.id ?? monthlySchedule?.schedule_id ?? null,
    depreciation_entry_kind: sourceSchedule
      ? "source"
      : monthlySchedule
        ? "monthly"
        : null,
    loan_settlement: settlement
      ? serializeLoanSettlement({
          is_settled: settlement.is_settled,
          settled_by_journal_entry_id:
            settlement.settled_by_journal_entry_id,
          settled_by_entry_date: settledByEntry?.date ?? null,
          settled_at: settlement.settled_at,
          asOf,
        })
      : null,
    loan_settlement_source_journal_entry_ids: settlementSources.map(
      (source) => source.journal_entry_id,
    ),
    budget_funding:
      fundingRows.length === 0 ||
      new Set(fundingRows.map((row) => row.kind)).size !== 1
        ? null
        : {
            kind: fundingRows[0]!.kind,
            allocations: fundingRows.map((row) => {
              const currency = normalizeCurrency(row.currency);
              return {
                id: row.id,
                budget_category_id: row.budget_category_id,
                amount: fromStorageMoneyAmount(
                  row.amount,
                  currency,
                  scaleOptions,
                ),
                currency,
                source_journal_entry_id: row.source_journal_entry_id,
                effect: row.effect,
              };
            }),
          },
    budget_funding_components: [...new Set(fundingRows.map((row) => row.kind))]
      .map((kind) => {
        const rows = fundingRows.filter((row) => row.kind === kind);
        const allocations = rows.map((row) => {
          const currency = normalizeCurrency(row.currency);
          return {
            id: row.id,
            budget_category_id: row.budget_category_id,
            amount: fromStorageMoneyAmount(
              row.amount,
              currency,
              scaleOptions,
            ),
            currency,
            source_journal_entry_id: row.source_journal_entry_id,
            effect: row.effect,
          };
        });
        return {
          kind,
          principal_amount: allocations.reduce(
            (sum, allocation) => sum + allocation.amount,
            0,
          ),
          applied_amount: allocations
            .filter((allocation) => allocation.effect === "apply")
            .reduce((sum, allocation) => sum + allocation.amount, 0),
          component_only_amount: allocations
            .filter((allocation) => allocation.effect === "component_only")
            .reduce((sum, allocation) => sum + allocation.amount, 0),
          allocations,
          source_journal_entry_ids: [
            ...new Set(
              allocations
                .map((allocation) => allocation.source_journal_entry_id)
                .filter((sourceId): sourceId is number => sourceId != null),
            ),
          ],
        };
      }),
    income_transfer_requirements: incomeTransferRows.map((requirement) => ({
      ...requirement,
      amount: fromStorageMoneyAmount(
        requirement.amount,
        requirement.currency,
        scaleOptions,
      ),
    })),
    income_transfer_source_journal_entry_id:
      childRequirementRows[0]?.source_income_journal_entry_id ?? null,
    income_transfer_requirement_ids: childRequirementRows
      .map((row) => row.id)
      .sort((left, right) => left - right),
  });
});

// PUT /api/journal/:id — replace header + lines + budget allocations
router.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const body = await c.req.json<{
    date: string;
    description: string;
    lines: Array<{
      account_id: number;
      debit: number;
      credit: number;
      currency?: string;
      credit_card_billing_offset_months?: number | null;
    }>;
    budget_allocations?: Array<{
      budget_category_id: number;
      amount: number;
      currency?: string;
    }>;
    budget_source?: "simple" | "multiline";
    income_budget_allocations?: Array<{
      budget_category_id: number;
      amount: number;
      currency?: string;
      adjustment_type?: "allocation" | "reset" | "transfer";
    }>;
    loan_settlement_opening?: boolean;
    loan_settlement_journal_entry_ids?: number[];
    budget_funding?: BudgetFundingInput;
    budget_funding_components?: BudgetFundingComponentInput[];
    income_transfer_destinations?: Array<{
      budget_category_id: number;
      from_account_id: number;
      to_account_id: number;
      amount: number;
      currency?: string;
    }>;
    is_currency_exchange?: boolean;
  }>();

  if (
    !body.date ||
    !body.description ||
    !Array.isArray(body.lines) ||
    body.lines.length < 2
  )
    return c.json(
      { error: "date, description, and at least 2 lines are required" },
      400,
    );

  const db = createDb(c.env);
  const decimalPlacesByCurrency = await loadCurrencyDecimalPlaces(db);
  const scaleOptions = { decimalPlacesByCurrency };

  const invalidMoney = findInvalidMoney([
    ...body.lines.flatMap((line, index) => [
      {
        path: `lines[${index}].debit`,
        value: line.debit,
        currency: line.currency,
        decimalPlaces: decimalPlacesByCurrency[normalizeCurrency(line.currency)],
      },
      {
        path: `lines[${index}].credit`,
        value: line.credit,
        currency: line.currency,
        decimalPlaces: decimalPlacesByCurrency[normalizeCurrency(line.currency)],
      },
    ]),
    ...(body.budget_allocations ?? []).map((allocation, index) => ({
      path: `budget_allocations[${index}].amount`,
      value: allocation.amount,
      currency: allocation.currency ?? budgetCurrencyFromLines(body.lines),
      decimalPlaces:
        decimalPlacesByCurrency[
          normalizeCurrency(allocation.currency ?? budgetCurrencyFromLines(body.lines))
        ],
    })),
    ...(body.income_budget_allocations ?? []).map((allocation, index) => ({
      path: `income_budget_allocations[${index}].amount`,
      value: allocation.amount,
      currency: allocation.currency ?? budgetCurrencyFromLines(body.lines),
      decimalPlaces:
        decimalPlacesByCurrency[
          normalizeCurrency(allocation.currency ?? budgetCurrencyFromLines(body.lines))
        ],
    })),
    ...(body.budget_funding?.allocations ?? []).map((allocation, index) => ({
      path: `budget_funding.allocations[${index}].amount`,
      value: allocation.amount,
      currency: allocation.currency ?? budgetCurrencyFromLines(body.lines),
      decimalPlaces:
        decimalPlacesByCurrency[
          normalizeCurrency(
            allocation.currency ?? budgetCurrencyFromLines(body.lines),
          )
        ],
    })),
    ...(body.budget_funding
      ? [
          {
            path: "budget_funding.principal_amount",
            value: body.budget_funding.principal_amount,
            currency: budgetCurrencyFromLines(body.lines),
            decimalPlaces:
              decimalPlacesByCurrency[
                normalizeCurrency(budgetCurrencyFromLines(body.lines))
              ],
          },
        ]
      : []),
    ...normalizeBudgetFundingComponents(body).flatMap((component, index) => [
      {
        path: `budget_funding_components[${index}].principal_amount`,
        value: component.principal_amount,
        currency: budgetCurrencyFromLines(body.lines),
        decimalPlaces:
          decimalPlacesByCurrency[budgetCurrencyFromLines(body.lines)],
      },
      {
        path: `budget_funding_components[${index}].applied_amount`,
        value: component.applied_amount,
        currency: budgetCurrencyFromLines(body.lines),
        decimalPlaces:
          decimalPlacesByCurrency[budgetCurrencyFromLines(body.lines)],
      },
      {
        path: `budget_funding_components[${index}].component_only_amount`,
        value: component.component_only_amount,
        currency: budgetCurrencyFromLines(body.lines),
        decimalPlaces:
          decimalPlacesByCurrency[budgetCurrencyFromLines(body.lines)],
      },
      ...(component.allocations ?? []).map((allocation, allocationIndex) => ({
        path: `budget_funding_components[${index}].allocations[${allocationIndex}].amount`,
        value: allocation.amount,
        currency: allocation.currency ?? budgetCurrencyFromLines(body.lines),
        decimalPlaces:
          decimalPlacesByCurrency[
            normalizeCurrency(
              allocation.currency ?? budgetCurrencyFromLines(body.lines),
            )
          ],
      })),
    ]),
    ...(body.income_transfer_destinations ?? []).map((destination, index) => ({
      path: `income_transfer_destinations[${index}].amount`,
      value: destination.amount,
      currency: destination.currency ?? budgetCurrencyFromLines(body.lines),
      decimalPlaces:
        decimalPlacesByCurrency[
          normalizeCurrency(
            destination.currency ?? budgetCurrencyFromLines(body.lines),
          )
        ],
    })),
  ]);
  if (invalidMoney) {
    return c.json(
      invalidMoneyResponse(invalidMoney.path, invalidMoney.currency),
      400,
    );
  }

  if (!body.is_currency_exchange) {
    const totalDebit = body.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const totalCredit = body.lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.001)
      return c.json(
        {
          error: `Unbalanced entry: debit ${totalDebit} ≠ credit ${totalCredit}`,
        },
        400,
      );
  }
  if (
    body.budget_funding &&
    !BUDGET_FUNDING_KINDS.has(body.budget_funding.kind)
  ) {
    return c.json({ error: "invalid budget_funding kind" }, 400);
  }

  const existing = await db
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.id, id));
  if (existing.length === 0) return c.json({ error: "Not found" }, 404);
  let preserveIncomeTransferRequirements = false;
  if (body.income_transfer_destinations === undefined) {
    const completedRequirements = await db
      .select({ id: incomeTransferRequirements.id })
      .from(incomeTransferRequirements)
      .where(
        and(
          eq(incomeTransferRequirements.source_income_journal_entry_id, id),
          sql`${incomeTransferRequirements.transfer_journal_entry_id} IS NOT NULL`,
        ),
      );
    if (completedRequirements.length > 0) {
      return c.json(
        {
          error: "income_transfer_completed_conflict",
          completed_requirement_ids: completedRequirements.map(
            (row) => row.id,
          ),
        },
        409,
      );
    }
  }
  if (body.income_transfer_destinations !== undefined) {
    const currentRequirements = await db
      .select()
      .from(incomeTransferRequirements)
      .where(
        eq(incomeTransferRequirements.source_income_journal_entry_id, id),
      );
    const completedRequirements = currentRequirements.filter(
      (requirement) => requirement.transfer_journal_entry_id != null,
    );
    if (completedRequirements.length > 0) {
      const currentKeys = currentRequirements
        .map((requirement) =>
          [
            requirement.budget_category_id,
            requirement.from_account_id,
            requirement.to_account_id,
            requirement.amount,
            requirement.currency,
          ].join(":"),
        )
        .sort();
      const incomingKeys = body.income_transfer_destinations
        .map((destination) => {
          const currency = normalizeCurrency(
            destination.currency ?? budgetCurrencyFromLines(body.lines),
          );
          return [
            destination.budget_category_id,
            destination.from_account_id,
            destination.to_account_id,
            toStorageMoneyAmount(
              destination.amount,
              currency,
              scaleOptions,
            ),
            currency,
          ].join(":");
        })
        .sort();
      preserveIncomeTransferRequirements =
        currentKeys.length === incomingKeys.length &&
        currentKeys.every((key, index) => key === incomingKeys[index]);
      if (!preserveIncomeTransferRequirements) {
        return c.json(
          {
            error: "income_transfer_completed_conflict",
            completed_requirement_ids: completedRequirements.map(
              (row) => row.id,
            ),
          },
          409,
        );
      }
    }
  }

  const validAllocations = (body.budget_allocations ?? []).filter(
    (a) => a.budget_category_id && a.amount !== 0,
  );
  const budgetCurrency = budgetCurrencyFromLines(body.lines);
  const fundingValidationError = validateExplicitBudgetFunding(
    body.budget_funding,
    budgetCurrency,
  );
  if (fundingValidationError) {
    return c.json({ error: fundingValidationError }, 400);
  }
  const componentValidationError = validateBudgetFundingComponents(
    normalizeBudgetFundingComponents(body),
    budgetCurrency,
  );
  if (componentValidationError) {
    return c.json({ error: componentValidationError }, 400);
  }
  const componentLineValidationError =
    await validateBudgetFundingComponentsAgainstLines({
      db,
      components: body.budget_funding_components,
      lines: body.lines,
      currency: budgetCurrency,
      decimalPlaces: decimalPlacesByCurrency[budgetCurrency] ?? 0,
    });
  if (componentLineValidationError) {
    return c.json({ error: componentLineValidationError }, 400);
  }
  const validIncomeAllocs = (body.income_budget_allocations ?? []).filter(
    (a) => a.budget_category_id && a.amount !== 0,
  );

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      "UPDATE journal_entries SET date = ?, description = ? WHERE id = ?",
    ).bind(body.date, body.description, id),
    c.env.DB.prepare(
      "DELETE FROM journal_lines WHERE journal_entry_id = ?",
    ).bind(id),
  ];
  if (
    body.income_transfer_destinations !== undefined &&
    !preserveIncomeTransferRequirements
  ) {
    statements.push(
      c.env.DB.prepare(
        `DELETE FROM income_transfer_requirements
         WHERE source_income_journal_entry_id = ?
           AND transfer_journal_entry_id IS NULL`,
      ).bind(id),
    );
  }

  const lineValues = body.lines.flatMap((line) => [
    id,
    line.account_id,
    toStorageMoneyAmount(line.debit ?? 0, line.currency, scaleOptions),
    toStorageMoneyAmount(line.credit ?? 0, line.currency, scaleOptions),
    normalizeCurrency(line.currency),
    line.credit_card_billing_offset_months ?? null,
  ]);
  const lineResultIndex = statements.length;
  statements.push(
    c.env.DB.prepare(
      `INSERT INTO journal_lines
        (journal_entry_id, account_id, debit, credit, currency, credit_card_billing_offset_months)
       VALUES ${buildRowsSql(body.lines.length, 6)}
       RETURNING id, journal_entry_id, account_id, debit, credit, currency, credit_card_billing_offset_months, created_at`,
    ).bind(...lineValues),
    c.env.DB.prepare(
      "DELETE FROM journal_entry_budget_allocations WHERE journal_entry_id = ?",
    ).bind(id),
  );

  if (validAllocations.length > 0) {
    const allocationValues = validAllocations.flatMap((allocation) => [
      id,
      allocation.budget_category_id,
      toStorageMoneyAmount(
        allocation.amount,
        allocation.currency ?? budgetCurrency,
        scaleOptions,
      ),
      normalizeCurrency(allocation.currency ?? budgetCurrency),
      body.budget_source ?? null,
    ]);
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO journal_entry_budget_allocations
          (journal_entry_id, budget_category_id, amount, currency, source)
         VALUES ${buildRowsSql(validAllocations.length, 5)}`,
      ).bind(...allocationValues),
    );
  }

  statements.push(
    c.env.DB.prepare(
      "DELETE FROM budget_adjustment_logs WHERE journal_entry_id = ?",
    ).bind(id),
    c.env.DB.prepare(
      "DELETE FROM budget_funding_allocations WHERE journal_entry_id = ?",
    ).bind(id),
  );

  if (validIncomeAllocs.length > 0) {
    const incomeAllocationValues = validIncomeAllocs.flatMap((allocation) => [
      id,
      allocation.budget_category_id,
      toStorageMoneyAmount(
        allocation.amount,
        allocation.currency ?? budgetCurrency,
        scaleOptions,
      ),
      normalizeCurrency(allocation.currency ?? budgetCurrency),
      body.date.slice(0, 7),
      body.date,
      allocation.adjustment_type === "transfer" ? "transfer" : "allocation",
    ]);
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO budget_adjustment_logs
          (journal_entry_id, budget_category_id, amount, currency, year_month, date, adjustment_type)
         VALUES ${buildRowsSql(validIncomeAllocs.length, 7)}`,
      ).bind(...incomeAllocationValues),
    );
  }

  if (body.loan_settlement_opening) {
    statements.push(
      c.env.DB.prepare(
        "INSERT OR IGNORE INTO loan_settlements (journal_entry_id, is_settled) VALUES (?, 0)",
      ).bind(id),
    );
  } else {
    statements.push(
      c.env.DB.prepare(
        "DELETE FROM loan_settlements WHERE journal_entry_id = ? AND is_settled = 0",
      ).bind(id),
    );
  }

  statements.push(
    c.env.DB.prepare(
      `UPDATE loan_settlements
       SET is_settled = 0, settled_by_journal_entry_id = NULL, settled_at = NULL
       WHERE settled_by_journal_entry_id = ?`,
    ).bind(id),
  );

  const settleIds = body.loan_settlement_journal_entry_ids ?? [];
  if (settleIds.length > 0) {
    statements.push(
      c.env.DB.prepare(
        `UPDATE loan_settlements
         SET is_settled = 1, settled_by_journal_entry_id = ?, settled_at = ?
         WHERE journal_entry_id IN (${placeholders(settleIds.length)})`,
      ).bind(id, new Date().toISOString(), ...settleIds),
    );
  }

  const funding = body.budget_funding;
  const componentRows = body.budget_funding_components
    ? expandBudgetFundingComponentAllocations(
        body.budget_funding_components,
        budgetCurrency,
      )
    : [];
  const explicitFundingAllocations = (funding?.allocations ?? []).filter(
    (allocation) => allocation.amount > 0,
  );
  const fundingSourceIds = funding?.source_journal_entry_ids ?? [];
  if (componentRows.length > 0) {
    const values = componentRows.flatMap((allocation) => [
      id,
      allocation.budget_category_id,
      allocation.kind,
      toStorageMoneyAmount(
        allocation.amount,
        allocation.currency,
        scaleOptions,
      ),
      allocation.currency,
      allocation.source_journal_entry_id,
      allocation.effect,
    ]);
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO budget_funding_allocations
          (journal_entry_id, budget_category_id, kind, amount, currency, source_journal_entry_id, effect)
         VALUES ${buildRowsSql(componentRows.length, 7)}`,
      ).bind(...values),
    );
  } else if (funding && fundingSourceIds.length > 0) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO budget_funding_allocations
          (journal_entry_id, budget_category_id, kind, amount, currency, source_journal_entry_id, effect)
         SELECT
          ?,
          budget_category_id,
          ?,
          amount,
          currency,
          journal_entry_id,
          effect
         FROM budget_funding_allocations
         WHERE journal_entry_id IN (${placeholders(fundingSourceIds.length)})
           AND source_journal_entry_id IS NULL`,
      ).bind(id, funding.kind, ...fundingSourceIds),
    );
  } else if (funding && explicitFundingAllocations.length > 0) {
    const values = explicitFundingAllocations.flatMap((allocation) => [
      id,
      allocation.budget_category_id ?? null,
      funding.kind,
      toStorageMoneyAmount(
        allocation.amount,
        allocation.currency ?? budgetCurrency,
        scaleOptions,
      ),
      normalizeCurrency(allocation.currency ?? budgetCurrency),
      null,
      allocation.effect ?? "apply",
    ]);
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO budget_funding_allocations
          (journal_entry_id, budget_category_id, kind, amount, currency, source_journal_entry_id, effect)
         VALUES ${buildRowsSql(explicitFundingAllocations.length, 7)}`,
      ).bind(...values),
    );
  } else if (!funding && settleIds.length > 0) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO budget_funding_allocations
          (journal_entry_id, budget_category_id, kind, amount, currency, source_journal_entry_id, effect)
         SELECT
          ?,
          budget_category_id,
          CASE kind
            WHEN 'borrow' THEN 'repay'
            WHEN 'lend' THEN 'collect'
            ELSE kind
          END,
          amount,
          currency,
          journal_entry_id,
          effect
         FROM budget_funding_allocations
         WHERE journal_entry_id IN (${placeholders(settleIds.length)})
           AND source_journal_entry_id IS NULL`,
      ).bind(id, ...settleIds),
    );
  }

  for (const destination of preserveIncomeTransferRequirements
    ? []
    : body.income_transfer_destinations ?? []) {
    if (
      !Number.isInteger(destination.budget_category_id) ||
      !Number.isInteger(destination.from_account_id) ||
      !Number.isInteger(destination.to_account_id) ||
      destination.from_account_id === destination.to_account_id ||
      destination.amount <= 0
    ) {
      return c.json({ error: "invalid income transfer destination" }, 400);
    }
    const currency = normalizeCurrency(destination.currency ?? budgetCurrency);
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO income_transfer_requirements
          (source_income_journal_entry_id, budget_category_id, budget_category_name,
           from_account_id, to_account_id, amount, currency)
         SELECT ?, ?, name, ?, ?, ?, ?
         FROM budget_categories
         WHERE id = ?`,
      ).bind(
        id,
        destination.budget_category_id,
        destination.from_account_id,
        destination.to_account_id,
        toStorageMoneyAmount(destination.amount, currency, scaleOptions),
        currency,
        destination.budget_category_id,
      ),
    );
  }

  const results = await c.env.DB.batch(statements);
  const newLines =
    (results[lineResultIndex] as D1QueryResult<
      typeof journalLines.$inferSelect
    >).results ?? [];

  await syncLongTermCompletions(
    db,
    body.lines.map((line) => line.account_id),
  );

  return c.json({
    id,
    date: body.date,
    description: body.description,
    lines: newLines.map((line) => decodeJournalLineAmount(line, scaleOptions)),
  });
});

// DELETE /api/journal/:id — delete entry (cascades lines)
router.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const db = createDb(c.env);

  // Collect account IDs before deletion for completion sync
  const affectedLines = await db
    .select({ account_id: journalLines.account_id })
    .from(journalLines)
    .where(eq(journalLines.journal_entry_id, id));
  const affectedAccountIds = [
    ...new Set(affectedLines.map((l) => l.account_id)),
  ];

  // If this entry is a settlement entry (settled_by_journal_entry_id = id),
  // revert those opening entries to unsettled BEFORE deletion.
  // (The FK SET NULL would null the column but leave is_settled = 1, so we fix it first.)
  await db
    .update(loanSettlements)
    .set({ is_settled: 0, settled_by_journal_entry_id: null, settled_at: null })
    .where(eq(loanSettlements.settled_by_journal_entry_id, id));

  // A copied repayment/collection split must not become a standalone category
  // adjustment when its source entry disappears (the FK would otherwise SET NULL).
  // The remaining cash movement is therefore treated as unallocated funding.
  await db
    .delete(budgetFundingAllocations)
    .where(eq(budgetFundingAllocations.source_journal_entry_id, id));

  const deleted = await db
    .delete(journalEntries)
    .where(eq(journalEntries.id, id))
    .returning();

  if (deleted.length === 0) {
    return c.json({ error: "Not found" }, 404);
  }

  // Sync long-term completion state after deletion
  await syncLongTermCompletions(db, affectedAccountIds);

  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// Bulk operation helpers
// ---------------------------------------------------------------------------

/** Fetch journal entries (with lines + account names) for the given entry IDs. */
async function fetchEntriesWithLines(
  db: ReturnType<typeof createDb>,
  entryIds: number[],
) {
  if (entryIds.length === 0) return [];
  const decimalPlacesByCurrency = await loadCurrencyDecimalPlaces(db);
  const scaleOptions = { decimalPlacesByCurrency };

  const entriesChunks = await Promise.all(
    chunkIds(entryIds).map((chunk) =>
      db
        .select()
        .from(journalEntries)
        .where(
          sql`${journalEntries.id} IN (${sql.join(
            chunk.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        )
        .orderBy(desc(journalEntries.date), desc(journalEntries.id)),
    ),
  );
  const allEntries = entriesChunks.flat();

  const lineChunks = await Promise.all(
    chunkIds(entryIds).map((chunk) =>
      db
        .select({
          id: journalLines.id,
          journal_entry_id: journalLines.journal_entry_id,
          account_id: journalLines.account_id,
          account_name: accounts.name,
          debit: journalLines.debit,
          credit: journalLines.credit,
          currency: journalLines.currency,
          credit_card_billing_offset_months:
            journalLines.credit_card_billing_offset_months,
        })
        .from(journalLines)
        .leftJoin(accounts, eq(journalLines.account_id, accounts.id))
        .where(
          sql`${journalLines.journal_entry_id} IN (${sql.join(
            chunk.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        ),
    ),
  );
  const allLines = lineChunks.flat();

  const linesMap = new Map<number, typeof allLines>();
  for (const line of allLines) {
    const arr = linesMap.get(line.journal_entry_id) ?? [];
    arr.push(line);
    linesMap.set(line.journal_entry_id, arr);
  }

  return allEntries.map((e) => ({
    ...e,
    lines: (linesMap.get(e.id) ?? []).map((line) => ({
      ...decodeJournalLineAmount(line, scaleOptions),
      account_name: line.account_name ?? "Unknown",
      credit_card_billing_offset_months:
        line.credit_card_billing_offset_months ?? null,
    })),
  }));
}

/** Execute bulk delete for the given entry IDs (already resolved). */
async function executeBulkDelete(
  db: ReturnType<typeof createDb>,
  entryIds: number[],
) {
  if (entryIds.length === 0) return 0;

  const allAccountIds = new Set<number>();
  for (const chunk of chunkIds(entryIds)) {
    const rows = await db
      .selectDistinct({ account_id: journalLines.account_id })
      .from(journalLines)
      .where(
        sql`${journalLines.journal_entry_id} IN (${sql.join(
          chunk.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );
    rows.forEach((r) => allAccountIds.add(r.account_id));
  }

  for (const chunk of chunkIds(entryIds)) {
    await db
      .update(loanSettlements)
      .set({
        is_settled: 0,
        settled_by_journal_entry_id: null,
        settled_at: null,
      })
      .where(
        sql`${loanSettlements.settled_by_journal_entry_id} IN (${sql.join(
          chunk.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );
  }

  for (const chunk of chunkIds(entryIds)) {
    await db.delete(budgetFundingAllocations).where(
      sql`${budgetFundingAllocations.source_journal_entry_id} IN (${sql.join(
        chunk.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );
  }

  for (const chunk of chunkIds(entryIds)) {
    await db.delete(journalEntries).where(
      sql`${journalEntries.id} IN (${sql.join(
        chunk.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );
  }

  await syncLongTermCompletions(db, [...allAccountIds]);

  return entryIds.length;
}

// ---------------------------------------------------------------------------
// POST /api/journal/bulk-replace
// Body: { from_account_id, to_account_id, dry_run? } |
//       { from_account_id, to_account_id, entry_ids: number[] }
// dry_run=true → returns entries with lines (no changes)
// entry_ids    → execute only for those entries
// ---------------------------------------------------------------------------
router.post("/bulk-replace", async (c) => {
  const body = await c.req.json<{
    from_account_id: number;
    to_account_id: number;
    dry_run?: boolean;
    entry_ids?: number[];
  }>();

  if (!body.from_account_id || !body.to_account_id) {
    return c.json(
      { error: "from_account_id and to_account_id are required" },
      400,
    );
  }
  if (body.from_account_id === body.to_account_id) {
    return c.json({ error: "from and to account must be different" }, 400);
  }

  const db = createDb(c.env);

  // Find entry IDs containing a line for from_account_id
  const matchingLines = await db
    .selectDistinct({ entry_id: journalLines.journal_entry_id })
    .from(journalLines)
    .where(eq(journalLines.account_id, body.from_account_id));
  const allEntryIds = matchingLines.map((l) => l.entry_id);

  if (body.dry_run) {
    const entries = await fetchEntriesWithLines(db, allEntryIds);
    // Count only the lines that will be replaced (account = from_id)
    const affected_lines = entries.reduce(
      (n, e) =>
        n + e.lines.filter((l) => l.account_id === body.from_account_id).length,
      0,
    );
    return c.json({ entries, affected_lines, dry_run: true });
  }

  // Execute: restrict to entry_ids if provided, otherwise all
  const targetEntryIds =
    body.entry_ids && body.entry_ids.length > 0 ? body.entry_ids : allEntryIds;

  if (targetEntryIds.length === 0) {
    return c.json({ affected_lines: 0 });
  }

  let affected_lines = 0;
  for (const chunk of chunkIds(targetEntryIds)) {
    const updated = await db
      .update(journalLines)
      .set({ account_id: body.to_account_id })
      .where(
        sql`${journalLines.account_id} = ${body.from_account_id} AND ${journalLines.journal_entry_id} IN (${sql.join(
          chunk.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      )
      .returning({ id: journalLines.id });
    affected_lines += updated.length;
  }

  await syncLongTermCompletions(db, [body.from_account_id, body.to_account_id]);

  return c.json({ affected_lines });
});

// ---------------------------------------------------------------------------
// POST /api/journal/bulk-delete
// Body: { account_id?, date_from?, date_to?, description?, dry_run? } |
//       { entry_ids: number[] }
// dry_run=true → returns entries with lines (no changes)
// entry_ids    → skip condition matching; delete exactly those entries
// ---------------------------------------------------------------------------
router.post("/bulk-delete", async (c) => {
  const body = await c.req.json<{
    account_id?: number;
    date_from?: string;
    date_to?: string;
    description?: string;
    dry_run?: boolean;
    entry_ids?: number[];
  }>();

  const db = createDb(c.env);

  // If caller provided explicit IDs, skip condition resolution
  if (body.entry_ids) {
    if (body.entry_ids.length === 0) {
      return c.json({ deleted_entries: 0 });
    }
    const deleted_entries = await executeBulkDelete(db, body.entry_ids);
    return c.json({ deleted_entries });
  }

  // Otherwise resolve IDs from conditions
  if (
    !body.account_id &&
    !body.date_from &&
    !body.date_to &&
    !body.description
  ) {
    return c.json({ error: "At least one filter condition is required" }, 400);
  }

  let entryIdSet: Set<number>;

  if (
    body.account_id &&
    !body.date_from &&
    !body.date_to &&
    !body.description
  ) {
    const lines = await db
      .selectDistinct({ id: journalLines.journal_entry_id })
      .from(journalLines)
      .where(eq(journalLines.account_id, body.account_id));
    entryIdSet = new Set(lines.map((l) => l.id));
  } else {
    const conditions = [];
    if (body.date_from)
      conditions.push(gte(journalEntries.date, body.date_from));
    if (body.date_to) conditions.push(lte(journalEntries.date, body.date_to));
    if (body.description)
      conditions.push(
        like(journalEntries.description, `%${body.description}%`),
      );

    const entries = await db
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    entryIdSet = new Set(entries.map((e) => e.id));

    if (body.account_id && entryIdSet.size > 0) {
      const filtered = new Set<number>();
      for (const chunk of chunkIds([...entryIdSet])) {
        const rows = await db
          .selectDistinct({ id: journalLines.journal_entry_id })
          .from(journalLines)
          .where(
            sql`${journalLines.account_id} = ${body.account_id} AND ${journalLines.journal_entry_id} IN (${sql.join(
              chunk.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          );
        rows.forEach((r) => filtered.add(r.id));
      }
      entryIdSet = filtered;
    }
  }

  if (body.dry_run) {
    const entries = await fetchEntriesWithLines(db, [...entryIdSet]);
    return c.json({ entries, deleted_entries: entryIdSet.size, dry_run: true });
  }

  const deleted_entries = await executeBulkDelete(db, [...entryIdSet]);
  return c.json({ deleted_entries });
});

export { router as journalRouter };
