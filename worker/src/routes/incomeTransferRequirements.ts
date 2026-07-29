import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import type {
  IncomeTransferHistoricalCandidate,
  IncomeTransferRequirement,
  JournalEntry,
} from "@balance-sheet/shared";
import { createDb, type Env } from "../db";
import {
  accounts,
  budgetAdjustmentLogs,
  budgetCategories,
  budgetCategoryAccountTargets,
  incomeTransferRequirements,
  journalEntries,
  journalLines,
} from "../db/schema";
import {
  fromStorageMoneyAmount,
  toStorageMoneyAmount,
} from "../lib/moneyValidation";
import { loadCurrencyDecimalPlaces } from "../lib/currencyPrecision";
import {
  connectedTargetAccounts,
  groupIncomeTransferRequirements,
  isMatchingPureTransfer,
} from "../lib/incomeTransferRequirements";

const router = new Hono<{ Bindings: Env }>();

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function normalizeCurrency(value: string | null | undefined): string {
  return (value || "JPY").toUpperCase();
}

async function serializeRequirements(
  db: ReturnType<typeof createDb>,
  rows: Array<typeof incomeTransferRequirements.$inferSelect>,
) {
  const scaleOptions = {
    decimalPlacesByCurrency: await loadCurrencyDecimalPlaces(db),
  };
  if (rows.length === 0) return [];
  const sourceIds = [...new Set(rows.map((row) => row.source_income_journal_entry_id))];
  const accountIds = [
    ...new Set(rows.flatMap((row) => [row.from_account_id, row.to_account_id])),
  ];
  const [sources, accountRows] = await Promise.all([
    db
      .select({
        id: journalEntries.id,
        date: journalEntries.date,
        description: journalEntries.description,
      })
      .from(journalEntries)
      .where(inArray(journalEntries.id, sourceIds)),
    db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(inArray(accounts.id, accountIds)),
  ]);
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const accountMap = new Map(accountRows.map((account) => [account.id, account.name]));
  return rows.map((row): IncomeTransferRequirement => ({
    ...row,
    source_income_date: sourceMap.get(row.source_income_journal_entry_id)?.date,
    source_income_description:
      sourceMap.get(row.source_income_journal_entry_id)?.description,
    from_account_name: accountMap.get(row.from_account_id),
    to_account_name: accountMap.get(row.to_account_id),
    amount: fromStorageMoneyAmount(row.amount, row.currency, scaleOptions),
  }));
}

async function pendingGroup(
  db: ReturnType<typeof createDb>,
  requirementId: number,
) {
  const [anchor] = await db
    .select()
    .from(incomeTransferRequirements)
    .where(eq(incomeTransferRequirements.id, requirementId));
  if (!anchor) return [];
  return db
    .select()
    .from(incomeTransferRequirements)
    .where(
      and(
        eq(
          incomeTransferRequirements.source_income_journal_entry_id,
          anchor.source_income_journal_entry_id,
        ),
        eq(incomeTransferRequirements.from_account_id, anchor.from_account_id),
        eq(incomeTransferRequirements.to_account_id, anchor.to_account_id),
        eq(incomeTransferRequirements.currency, anchor.currency),
        sql`${incomeTransferRequirements.transfer_journal_entry_id} IS NULL`,
      ),
    );
}

router.get("/", async (c) => {
  const db = createDb(c.env);
  const status = c.req.query("status");
  const sourceId = Number(c.req.query("source_income_journal_entry_id"));
  const conditions = [];
  if (status === "pending") {
    conditions.push(
      sql`${incomeTransferRequirements.transfer_journal_entry_id} IS NULL`,
    );
  } else if (status === "completed") {
    conditions.push(
      sql`${incomeTransferRequirements.transfer_journal_entry_id} IS NOT NULL`,
    );
  }
  if (Number.isInteger(sourceId) && sourceId > 0) {
    conditions.push(
      eq(incomeTransferRequirements.source_income_journal_entry_id, sourceId),
    );
  }
  const rows = await db
    .select()
    .from(incomeTransferRequirements)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(incomeTransferRequirements.created_at));
  const requirements = await serializeRequirements(db, rows);
  return c.json({
    requirements,
    groups: groupIncomeTransferRequirements(requirements),
  });
});

router.get("/historical", async (c) => {
  const db = createDb(c.env);
  const [
    allocationRows,
    resetRows,
    targetRows,
    accountRows,
    categoryRows,
    existingRows,
  ] = await Promise.all([
    db
      .select()
      .from(budgetAdjustmentLogs)
      .where(
        and(
          eq(budgetAdjustmentLogs.adjustment_type, "allocation"),
          sql`${budgetAdjustmentLogs.journal_entry_id} IS NOT NULL`,
          sql`${budgetAdjustmentLogs.amount} > 0`,
        ),
      )
      .orderBy(desc(budgetAdjustmentLogs.date), desc(budgetAdjustmentLogs.id))
      .limit(500),
    db
      .select()
      .from(budgetAdjustmentLogs)
      .where(eq(budgetAdjustmentLogs.adjustment_type, "reset")),
    db.select().from(budgetCategoryAccountTargets),
    db.select().from(accounts),
    db.select({ id: budgetCategories.id, name: budgetCategories.name }).from(
      budgetCategories,
    ),
    db
      .select({
        source_income_journal_entry_id:
          incomeTransferRequirements.source_income_journal_entry_id,
        budget_category_id: incomeTransferRequirements.budget_category_id,
      })
      .from(incomeTransferRequirements),
  ]);

  const latestResetByCategory = new Map<
    number,
    { date: string; created_at: string }
  >();
  for (const reset of resetRows) {
    const previous = latestResetByCategory.get(reset.budget_category_id);
    if (
      !previous ||
      reset.date > previous.date ||
      (reset.date === previous.date &&
        reset.created_at > previous.created_at)
    ) {
      latestResetByCategory.set(reset.budget_category_id, {
        date: reset.date,
        created_at: reset.created_at,
      });
    }
  }

  const existingKeys = new Set(
    existingRows.map(
      (row) =>
        `${row.source_income_journal_entry_id}:${row.budget_category_id}`,
    ),
  );
  const groupedAllocations = new Map<
    string,
    {
      sourceId: number;
      categoryId: number;
      currency: string;
      amount: number;
    }
  >();
  for (const allocation of allocationRows) {
    const sourceId = allocation.journal_entry_id;
    if (sourceId == null) continue;
    const reset = latestResetByCategory.get(allocation.budget_category_id);
    if (
      reset &&
      (allocation.date < reset.date ||
        (allocation.date === reset.date &&
          allocation.created_at <= reset.created_at))
    ) {
      continue;
    }
    if (
      existingKeys.has(`${sourceId}:${allocation.budget_category_id}`)
    ) {
      continue;
    }
    const currency = normalizeCurrency(allocation.currency);
    const key = `${sourceId}:${allocation.budget_category_id}:${currency}`;
    const grouped = groupedAllocations.get(key) ?? {
      sourceId,
      categoryId: allocation.budget_category_id,
      currency,
      amount: 0,
    };
    grouped.amount += allocation.amount;
    groupedAllocations.set(key, grouped);
  }

  const sourceIds = [
    ...new Set(
      [...groupedAllocations.values()].map((allocation) => allocation.sourceId),
    ),
  ];
  if (sourceIds.length === 0) return c.json([]);
  const [sourceEntries, sourceLines] = await Promise.all([
    db.select().from(journalEntries).where(inArray(journalEntries.id, sourceIds)),
    db
      .select()
      .from(journalLines)
      .where(inArray(journalLines.journal_entry_id, sourceIds)),
  ]);
  const entryMap = new Map(sourceEntries.map((entry) => [entry.id, entry]));
  const accountMap = new Map(accountRows.map((account) => [account.id, account]));
  const categoryMap = new Map(
    categoryRows.map((category) => [category.id, category.name]),
  );
  const scaleOptions = {
    decimalPlacesByCurrency: await loadCurrencyDecimalPlaces(db),
  };
  const candidates: IncomeTransferHistoricalCandidate[] = [];

  for (const allocation of groupedAllocations.values()) {
    const entry = entryMap.get(allocation.sourceId);
    const categoryName = categoryMap.get(allocation.categoryId);
    if (!entry || !categoryName) continue;
    const lines = sourceLines.filter(
      (line) =>
        line.journal_entry_id === allocation.sourceId &&
        normalizeCurrency(line.currency) === allocation.currency,
    );
    const hasIncome = lines.some((line) => {
      const account = accountMap.get(line.account_id);
      return account?.type === "income" && line.credit > line.debit;
    });
    if (!hasIncome) continue;
    const sourceAccounts = [
      ...new Set(
        lines.flatMap((line) => {
          const account = accountMap.get(line.account_id);
          return account?.type === "asset" &&
            account.category === "cash" &&
            account.include_in_allocatable === 1 &&
            account.is_depreciable === 0 &&
            line.debit > line.credit
            ? [account.id]
            : [];
        }),
      ),
    ];
    // A compound income with multiple deposit accounts cannot be assigned
    // safely without user-entered per-account amounts.
    if (sourceAccounts.length !== 1) continue;
    const fromAccountId = sourceAccounts[0]!;
    const connectedAccounts = connectedTargetAccounts(
      allocation.categoryId,
      targetRows,
    );
    if (connectedAccounts.has(fromAccountId)) continue;
    const targetAccounts = targetRows
      .filter((target) => target.budget_category_id === allocation.categoryId)
      .flatMap((target) => {
        const account = accountMap.get(target.account_id);
        return account?.type === "asset" &&
          account.category === "cash" &&
          account.include_in_allocatable === 1 &&
          account.is_depreciable === 0
          ? [{ id: account.id, name: account.name }]
          : [];
      });
    candidates.push({
      source_income_journal_entry_id: entry.id,
      source_income_date: entry.date,
      source_income_description: entry.description,
      budget_category_id: allocation.categoryId,
      budget_category_name: categoryName,
      from_account_id: fromAccountId,
      from_account_name: accountMap.get(fromAccountId)!.name,
      amount: fromStorageMoneyAmount(
        allocation.amount,
        allocation.currency,
        scaleOptions,
      ),
      currency: allocation.currency,
      target_accounts: targetAccounts,
    });
  }
  return c.json(candidates);
});

router.post("/", async (c) => {
  const body = await c.req.json<{
    source_income_journal_entry_id: number;
    destinations: Array<{
      budget_category_id: number;
      from_account_id: number;
      to_account_id: number;
      amount: number;
      currency?: string;
    }>;
  }>();
  if (
    !Number.isInteger(body.source_income_journal_entry_id) ||
    !Array.isArray(body.destinations) ||
    body.destinations.length === 0
  ) {
    return c.json({ error: "invalid income transfer requirements" }, 400);
  }
  const db = createDb(c.env);
  const [source] = await db
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(eq(journalEntries.id, body.source_income_journal_entry_id));
  if (!source) return c.json({ error: "source income not found" }, 404);
  const scaleOptions = {
    decimalPlacesByCurrency: await loadCurrencyDecimalPlaces(db),
  };
  const categoryIds = body.destinations.map((item) => item.budget_category_id);
  const categories = await db
    .select({ id: budgetCategories.id, name: budgetCategories.name })
    .from(budgetCategories)
    .where(inArray(budgetCategories.id, categoryIds));
  const categoryMap = new Map(categories.map((category) => [category.id, category.name]));
  if (
    body.destinations.some(
      (item) =>
        !categoryMap.has(item.budget_category_id) ||
        item.from_account_id === item.to_account_id ||
        item.amount <= 0,
    )
  ) {
    return c.json({ error: "invalid income transfer destination" }, 400);
  }
  const inserted = await db
    .insert(incomeTransferRequirements)
    .values(
      body.destinations.map((item) => {
        const currency = normalizeCurrency(item.currency);
        return {
          source_income_journal_entry_id: body.source_income_journal_entry_id,
          budget_category_id: item.budget_category_id,
          budget_category_name: categoryMap.get(item.budget_category_id)!,
          from_account_id: item.from_account_id,
          to_account_id: item.to_account_id,
          amount: toStorageMoneyAmount(item.amount, currency, scaleOptions),
          currency,
        };
      }),
    )
    .returning();
  return c.json(await serializeRequirements(db, inserted), 201);
});

router.post("/:id/complete", async (c) => {
  const id = Number(c.req.param("id"));
  const db = createDb(c.env);
  const rows = await pendingGroup(db, id);
  if (rows.length === 0) {
    return c.json({ error: "pending requirement not found" }, 404);
  }
  const [source] = await db
    .select({ date: journalEntries.date, description: journalEntries.description })
    .from(journalEntries)
    .where(eq(journalEntries.id, rows[0]!.source_income_journal_entry_id));
  if (!source) return c.json({ error: "source income not found" }, 409);
  const amount = rows.reduce((sum, row) => sum + row.amount, 0);
  const now = new Date().toISOString();
  const ids = rows.map((row) => row.id);
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO journal_entries (date, description, source)
       VALUES (?, ?, 'manual')
       RETURNING id, date, description, source, created_at`,
    ).bind(
      source.date,
      `Income allocation transfer: ${source.description}`,
    ),
    c.env.DB.prepare(
      `INSERT INTO journal_lines
        (journal_entry_id, account_id, debit, credit, currency)
       VALUES
        ((SELECT MAX(id) FROM journal_entries), ?, ?, 0, ?),
        ((SELECT MAX(id) FROM journal_entries), ?, 0, ?, ?)`,
    ).bind(
      rows[0]!.to_account_id,
      amount,
      rows[0]!.currency,
      rows[0]!.from_account_id,
      amount,
      rows[0]!.currency,
    ),
    c.env.DB.prepare(
      `UPDATE income_transfer_requirements
       SET transfer_journal_entry_id = (SELECT MAX(id) FROM journal_entries),
           completion_source = 'created',
           completed_at = ?
       WHERE id IN (${placeholders(ids.length)})`,
    ).bind(now, ...ids),
  ]);
  const created = (results[0] as D1QueryResult<{
    id: number;
    date: string;
    description: string;
  }>).results?.[0];
  return c.json({ transfer_journal_entry: created, requirement_ids: ids });
});

type D1QueryResult<T> = { results?: T[] };

router.post("/:id/link", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{
    transfer_journal_entry_id: number;
    remove_budget_transfer_logs?: boolean;
  }>();
  const db = createDb(c.env);
  const rows = await pendingGroup(db, id);
  if (rows.length === 0) {
    return c.json({ error: "pending requirement not found" }, 404);
  }
  const [entry] = await db
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.id, body.transfer_journal_entry_id));
  if (!entry) return c.json({ error: "transfer journal not found" }, 404);
  const scaleOptions = {
    decimalPlacesByCurrency: await loadCurrencyDecimalPlaces(db),
  };
  const lineRows = await db
    .select()
    .from(journalLines)
    .where(eq(journalLines.journal_entry_id, entry.id));
  const candidate: JournalEntry = {
    ...entry,
    lines: lineRows.map((line) => ({
      ...line,
      account_name: "",
      debit: fromStorageMoneyAmount(line.debit, line.currency, scaleOptions),
      credit: fromStorageMoneyAmount(line.credit, line.currency, scaleOptions),
    })),
  };
  const expectedAmount = fromStorageMoneyAmount(
    rows.reduce((sum, row) => sum + row.amount, 0),
    rows[0]!.currency,
    scaleOptions,
  );
  if (
    !isMatchingPureTransfer(candidate, {
      from_account_id: rows[0]!.from_account_id,
      to_account_id: rows[0]!.to_account_id,
      amount: expectedAmount,
      currency: rows[0]!.currency,
    })
  ) {
    return c.json({ error: "journal is not an exact pure transfer" }, 409);
  }
  const budgetLogs = await db
    .select({
      id: budgetAdjustmentLogs.id,
      adjustment_type: budgetAdjustmentLogs.adjustment_type,
    })
    .from(budgetAdjustmentLogs)
    .where(eq(budgetAdjustmentLogs.journal_entry_id, entry.id));
  const transferBudgetLogs = budgetLogs.filter(
    (log) => log.adjustment_type === "transfer",
  );
  const otherBudgetLogs = budgetLogs.filter(
    (log) => log.adjustment_type !== "transfer",
  );
  if (otherBudgetLogs.length > 0) {
    return c.json(
      {
        error: "linked_transfer_has_non_transfer_budget_logs",
        budget_adjustment_log_ids: otherBudgetLogs.map((row) => row.id),
      },
      409,
    );
  }
  if (
    transferBudgetLogs.length > 0 &&
    !body.remove_budget_transfer_logs
  ) {
    return c.json(
      {
        error: "linked_transfer_has_budget_logs",
        budget_adjustment_log_ids: transferBudgetLogs.map((row) => row.id),
      },
      409,
    );
  }
  if (transferBudgetLogs.length > 0) {
    await db
      .delete(budgetAdjustmentLogs)
      .where(
        and(
          eq(budgetAdjustmentLogs.journal_entry_id, entry.id),
          eq(budgetAdjustmentLogs.adjustment_type, "transfer"),
        ),
      );
  }
  const ids = rows.map((row) => row.id);
  await c.env.DB.prepare(
    `UPDATE income_transfer_requirements
     SET transfer_journal_entry_id = ?,
         completion_source = 'linked',
         completed_at = ?
     WHERE id IN (${placeholders(ids.length)})`,
  )
    .bind(entry.id, new Date().toISOString(), ...ids)
    .run();
  return c.json({ transfer_journal_entry_id: entry.id, requirement_ids: ids });
});

router.post("/:id/cancel", async (c) => {
  const id = Number(c.req.param("id"));
  const db = createDb(c.env);
  const [anchor] = await db
    .select()
    .from(incomeTransferRequirements)
    .where(eq(incomeTransferRequirements.id, id));
  if (!anchor?.transfer_journal_entry_id) {
    return c.json({ error: "completed requirement not found" }, 404);
  }
  const rows = await db
    .select()
    .from(incomeTransferRequirements)
    .where(
      eq(
        incomeTransferRequirements.transfer_journal_entry_id,
        anchor.transfer_journal_entry_id,
      ),
    );
  const ids = rows.map((row) => row.id);
  await c.env.DB.prepare(
    `UPDATE income_transfer_requirements
     SET transfer_journal_entry_id = NULL,
         completion_source = NULL,
         completed_at = NULL
     WHERE id IN (${placeholders(ids.length)})`,
  )
    .bind(...ids)
    .run();
  if (anchor.completion_source === "created") {
    await db
      .delete(journalEntries)
      .where(eq(journalEntries.id, anchor.transfer_journal_entry_id));
  }
  return c.json({
    requirement_ids: ids,
    deleted_transfer_journal_entry:
      anchor.completion_source === "created",
  });
});

router.get("/:id/candidates", async (c) => {
  const id = Number(c.req.param("id"));
  const db = createDb(c.env);
  const rows = await pendingGroup(db, id);
  if (rows.length === 0) {
    return c.json({ error: "pending requirement not found" }, 404);
  }
  const [source] = await db
    .select({ date: journalEntries.date })
    .from(journalEntries)
    .where(
      eq(
        journalEntries.id,
        rows[0]!.source_income_journal_entry_id,
      ),
    );
  if (!source) return c.json({ error: "source income not found" }, 409);
  const categoryIds = rows
    .map((row) => row.budget_category_id)
    .filter((categoryId): categoryId is number => categoryId != null);
  const resetRows =
    categoryIds.length === 0
      ? []
      : await db
          .select({
            date: budgetAdjustmentLogs.date,
            created_at: budgetAdjustmentLogs.created_at,
          })
          .from(budgetAdjustmentLogs)
          .where(
            and(
              inArray(budgetAdjustmentLogs.budget_category_id, categoryIds),
              eq(budgetAdjustmentLogs.adjustment_type, "reset"),
            ),
          );
  const reset = resetRows.sort(
    (left, right) =>
      right.date.localeCompare(left.date) ||
      right.created_at.localeCompare(left.created_at),
  )[0];
  const entries = await db
    .select()
    .from(journalEntries)
    .where(
      and(
        sql`${journalEntries.id} <> ${rows[0]!.source_income_journal_entry_id}`,
        sql`${journalEntries.date} >= ${source.date}`,
        reset?.date ? sql`${journalEntries.date} >= ${reset.date}` : undefined,
      ),
    )
    .orderBy(desc(journalEntries.date), desc(journalEntries.id))
    .limit(200);
  const entryIds = entries.map((entry) => entry.id);
  const scaleOptions = {
    decimalPlacesByCurrency: await loadCurrencyDecimalPlaces(db),
  };
  const lineRows =
    entryIds.length === 0
      ? []
      : await db
          .select()
          .from(journalLines)
          .where(inArray(journalLines.journal_entry_id, entryIds));
  const expectedAmount = fromStorageMoneyAmount(
    rows.reduce((sum, row) => sum + row.amount, 0),
    rows[0]!.currency,
    scaleOptions,
  );
  const candidates = entries
    .map((entry): JournalEntry => ({
      ...entry,
      lines: lineRows
        .filter((line) => line.journal_entry_id === entry.id)
        .map((line) => ({
          ...line,
          account_name: "",
          debit: fromStorageMoneyAmount(line.debit, line.currency, scaleOptions),
          credit: fromStorageMoneyAmount(
            line.credit,
            line.currency,
            scaleOptions,
          ),
        })),
    }))
    .filter(
      (entry) =>
        (!reset ||
          entry.date > reset.date ||
          (entry.date === reset.date &&
            entry.created_at > reset.created_at)) &&
        isMatchingPureTransfer(entry, {
          from_account_id: rows[0]!.from_account_id,
          to_account_id: rows[0]!.to_account_id,
          amount: expectedAmount,
          currency: rows[0]!.currency,
        }),
    );
  const candidateIds = candidates.map((entry) => entry.id);
  const logs =
    candidateIds.length === 0
      ? []
      : await db
          .select({
            journal_entry_id: budgetAdjustmentLogs.journal_entry_id,
          })
          .from(budgetAdjustmentLogs)
          .where(inArray(budgetAdjustmentLogs.journal_entry_id, candidateIds));
  const withBudgetLogs = new Set(logs.map((log) => log.journal_entry_id));
  return c.json(
    candidates.map((entry) => ({
      ...entry,
      has_budget_adjustment_logs: withBudgetLogs.has(entry.id),
    })),
  );
});

export { router as incomeTransferRequirementsRouter };
