import {
  allocateLoanBudgetDefaultMinorUnits,
  normalizeLoanBudgetWeights,
} from "../../../shared/longTermLoanBudgetDefaults";
import type {
  LongTermLoanBudgetDefaults,
  LongTermLoanBudgetSettledAllocation,
  LongTermLoanBudgetWeight,
} from "../../../shared/types";
import { chunkForD1InClause } from "./d1Query";
import { readBudgetMutationRevision } from "./d1Mutation";

type LoanAccount = {
  id: number;
  type: string;
  category: string;
};

type LongTermLoanBudgetConfig = Omit<
  LongTermLoanBudgetDefaults,
  "settled_minor_units" | "settled_allocations" | "settled_progress_available"
  | "budget_revision"
>;

type OpeningSourceRow = {
  source_id: number;
  principal: number;
  peer_account_count: number;
  target_principal: number;
  funding_id: number | null;
  budget_category_id: number | null;
  amount: number | null;
  effect: "apply" | "component_only" | null;
};

type SettlementProgressRow = {
  entry_id: number;
  principal: number;
  peer_account_count: number | null;
  target_principal: number | null;
  funding_id: number | null;
  budget_category_id: number | null;
  amount: number | null;
  effect: "apply" | "component_only" | null;
};

type LoanBudgetSettlementEvent = {
  entryId: number;
  principal: number;
  peerAccountCount: number | null;
  targetPrincipal: number | null;
  fundingRows: Array<{
    budgetCategoryId: number | null;
    amount: number;
    effect: "apply" | "component_only";
  }>;
};

export class LoanBudgetDefaultsChangedError extends Error {
  constructor() {
    super("stale_loan_budget_defaults");
    this.name = "LoanBudgetDefaultsChangedError";
  }
}

const LENDING_CATEGORIES = ["lending", "short_term_lending", "long_term_lending"] as const;
const BORROWING_CATEGORIES = ["short_term_loan", "loan", "long_term_loan"] as const;

export function normalizeLoanBudgetCurrency(currency: string | null | undefined) {
  return (currency || "JPY").trim().toUpperCase();
}

export function isLongTermLoanBudgetAccount(account: LoanAccount) {
  return (account.type === "asset" && account.category === "long_term_lending") ||
    (account.type === "liability" && ["loan", "long_term_loan"].includes(account.category));
}

function unavailable(
  accountId: number,
  currency: string,
  sourceJournalEntryId: number | null,
): LongTermLoanBudgetConfig {
  return {
    account_id: accountId,
    currency,
    source: "unavailable",
    source_journal_entry_id: sourceJournalEntryId,
    allocations: [{ budget_category_id: null, weight: 1 }],
  };
}

async function readCustomDefault(
  db: D1Database,
  accountId: number,
  currency: string,
): Promise<LongTermLoanBudgetConfig | null> {
  const result = await db.prepare(`
    SELECT d.id AS default_id, a.budget_category_id, a.weight
    FROM long_term_loan_budget_defaults d
    LEFT JOIN long_term_loan_budget_default_allocations a ON a.default_id = d.id
    WHERE d.account_id = ? AND d.currency = ?
    ORDER BY a.id
  `).bind(accountId, currency).all<{
    default_id: number;
    budget_category_id: number | null;
    weight: number | null;
  }>();
  if (!result.results?.length) return null;

  const allocations = normalizeLoanBudgetWeights(result.results
    .filter((row): row is typeof row & { weight: number } => row.weight !== null)
    .map(({ budget_category_id, weight }) => ({ budget_category_id, weight })));
  return {
    account_id: accountId,
    currency,
    source: "custom",
    source_journal_entry_id: null,
    allocations,
  };
}

async function deriveOpeningDefault(
  db: D1Database,
  account: LoanAccount,
  currency: string,
): Promise<LongTermLoanBudgetConfig> {
  const kind = account.type === "asset" ? "lend" : "borrow";
  const normalAmount = account.type === "asset"
    ? "jl.debit - jl.credit"
    : "jl.credit - jl.debit";
  const loanCategories = kind === "lend" ? LENDING_CATEGORIES : BORROWING_CATEGORIES;
  const lineNormalAmount = kind === "lend"
    ? "jl.debit - jl.credit"
    : "jl.credit - jl.debit";
  const categorySql = loanCategories.map(() => "?").join(", ");
  const sourceRows = await db.prepare(`
    WITH opening_source AS (
      SELECT je.id, SUM(${normalAmount}) AS principal
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_id = ? AND UPPER(COALESCE(jl.currency, 'JPY')) = ?
      GROUP BY je.id
      HAVING SUM(${normalAmount}) > 0
      ORDER BY je.date ASC, je.created_at ASC, je.id ASC
      LIMIT 1
    ),
    peer_principals AS (
      SELECT jl.account_id, SUM(${lineNormalAmount}) AS principal
      FROM journal_lines jl
      JOIN opening_source opening ON opening.id = jl.journal_entry_id
      JOIN accounts a ON a.id = jl.account_id
      WHERE UPPER(COALESCE(jl.currency, 'JPY')) = ?
        AND a.type = ?
        AND a.category IN (${categorySql})
      GROUP BY jl.account_id
      HAVING SUM(${lineNormalAmount}) <> 0
    ),
    peer_summary AS (
      SELECT COUNT(*) AS account_count,
        COALESCE(MAX(CASE WHEN account_id = ? THEN principal END), 0) AS target_principal
      FROM peer_principals
    )
    SELECT opening.id AS source_id,
      opening.principal AS principal,
      peers.account_count AS peer_account_count,
      peers.target_principal AS target_principal,
      funding.id AS funding_id,
      funding.budget_category_id AS budget_category_id,
      funding.amount AS amount,
      funding.effect AS effect
    FROM opening_source opening
    CROSS JOIN peer_summary peers
    LEFT JOIN budget_funding_allocations funding
      ON funding.journal_entry_id = opening.id
      AND funding.kind = ?
      AND UPPER(funding.currency) = ?
      AND funding.source_journal_entry_id IS NULL
    ORDER BY funding.id
  `).bind(
    account.id,
    currency,
    currency,
    account.type,
    ...loanCategories,
    account.id,
    kind,
    currency,
  ).all<OpeningSourceRow>();

  if (!sourceRows.results?.length) return unavailable(account.id, currency, null);
  const source = sourceRows.results[0]!;
  if (!Number.isSafeInteger(source.principal) || source.principal <= 0) {
    return unavailable(account.id, currency, source.source_id);
  }
  if (
    source.peer_account_count !== 1 ||
    source.target_principal !== source.principal
  ) {
    return unavailable(account.id, currency, source.source_id);
  }
  const fundingRows = sourceRows.results.filter(
    (row): row is typeof row & { funding_id: number; amount: number; effect: "apply" | "component_only" } => row.funding_id !== null,
  );
  if (fundingRows.length === 0) return unavailable(account.id, currency, source.source_id);

  const amountByCategory = new Map<number | null, bigint>();
  let assigned = 0n;
  for (const row of fundingRows) {
    if (row.effect !== "apply") continue;
    if (!Number.isSafeInteger(row.amount) || row.amount <= 0) {
      return unavailable(account.id, currency, source.source_id);
    }
    const amount = BigInt(row.amount);
    const categoryId = row.budget_category_id;
    amountByCategory.set(categoryId, (amountByCategory.get(categoryId) ?? 0n) + amount);
    assigned += amount;
  }

  const principalAmount = BigInt(source.principal);
  if (assigned > principalAmount) return unavailable(account.id, currency, source.source_id);

  const unallocated = principalAmount - assigned;
  if (unallocated > 0n) {
    amountByCategory.set(null, (amountByCategory.get(null) ?? 0n) + unallocated);
  }
  const weights: LongTermLoanBudgetWeight[] = [...amountByCategory]
    .filter(([, weight]) => weight > 0n)
    .map(([budget_category_id, weight]) => ({
      budget_category_id,
      weight: Number(weight),
    }));
  try {
    return {
      account_id: account.id,
      currency,
      source: "opening",
      source_journal_entry_id: source.source_id,
      allocations: normalizeLoanBudgetWeights(weights),
    };
  } catch {
    return unavailable(account.id, currency, source.source_id);
  }
}

async function readLoanBudgetSettlementEvents(
  db: D1Database,
  account: LoanAccount,
  currency: string,
): Promise<LoanBudgetSettlementEvent[]> {
  const isLending = account.type === "asset";
  const kind = isLending ? "collect" : "repay";
  const normalAmount = isLending
    ? "jl.debit - jl.credit"
    : "jl.credit - jl.debit";
  const loanCategories = isLending ? LENDING_CATEGORIES : BORROWING_CATEGORIES;
  const categorySql = loanCategories.map(() => "?").join(", ");
  const result = await db.prepare(`
    WITH decreases AS (
      SELECT je.id, -SUM(${normalAmount}) AS principal
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_id = ? AND UPPER(COALESCE(jl.currency, 'JPY')) = ?
      GROUP BY je.id
      HAVING SUM(${normalAmount}) < 0
    ),
    peer_principals AS (
      SELECT decreases.id AS entry_id, jl.account_id, SUM(${normalAmount}) AS principal
      FROM decreases
      JOIN journal_lines jl ON jl.journal_entry_id = decreases.id
      JOIN accounts a ON a.id = jl.account_id
      WHERE UPPER(COALESCE(jl.currency, 'JPY')) = ?
        AND a.type = ?
        AND a.category IN (${categorySql})
      GROUP BY decreases.id, jl.account_id
      HAVING SUM(${normalAmount}) <> 0
    ),
    peer_summary AS (
      SELECT entry_id, COUNT(*) AS account_count,
        MAX(CASE WHEN account_id = ? THEN principal END) AS target_principal
      FROM peer_principals
      GROUP BY entry_id
    )
    SELECT decreases.id AS entry_id,
      decreases.principal AS principal,
      peers.account_count AS peer_account_count,
      peers.target_principal AS target_principal,
      funding.id AS funding_id,
      funding.budget_category_id AS budget_category_id,
      funding.amount AS amount,
      funding.effect AS effect
    FROM decreases
    LEFT JOIN peer_summary peers ON peers.entry_id = decreases.id
    LEFT JOIN budget_funding_allocations funding
      ON funding.journal_entry_id = decreases.id
      AND funding.kind = ?
      AND UPPER(funding.currency) = ?
    ORDER BY decreases.id, funding.id
  `).bind(
    account.id,
    currency,
    currency,
    account.type,
    ...loanCategories,
    account.id,
    kind,
    currency,
  ).all<SettlementProgressRow>();

  const events: LoanBudgetSettlementEvent[] = [];
  for (const row of result.results ?? []) {
    let event = events.at(-1);
    if (!event || event.entryId !== row.entry_id) {
      event = {
        entryId: row.entry_id,
        principal: row.principal,
        peerAccountCount: row.peer_account_count,
        targetPrincipal: row.target_principal,
        fundingRows: [],
      };
      events.push(event);
    }
    if (row.funding_id === null) continue;
    if (row.amount === null || (row.effect !== "apply" && row.effect !== "component_only")) {
      event.fundingRows.push({
        budgetCategoryId: row.budget_category_id,
        amount: NaN,
        effect: "apply",
      });
      continue;
    }
    event.fundingRows.push({
      budgetCategoryId: row.budget_category_id,
      amount: row.amount,
      effect: row.effect,
    });
  }
  return events;
}

function replaySettlementProgress(
  events: readonly LoanBudgetSettlementEvent[],
  weights: readonly LongTermLoanBudgetWeight[],
): Pick<
  LongTermLoanBudgetDefaults,
  "settled_minor_units" | "settled_allocations" | "settled_progress_available"
> {
  let settledMinorUnits = 0n;
  let settledByCategory = new Map<number | null, bigint>();
  let available = true;
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  const reset = () => {
    settledMinorUnits = 0n;
    settledByCategory = new Map();
    available = false;
  };
  const resetKnownBoundary = () => {
    settledMinorUnits = 0n;
    settledByCategory = new Map();
    available = true;
  };

  for (const event of events) {
    if (!Number.isSafeInteger(event.principal) || event.principal <= 0) {
      reset();
      continue;
    }
    if (
      event.peerAccountCount !== 1 ||
      event.targetPrincipal !== -event.principal
    ) {
      reset();
      continue;
    }
    if (event.fundingRows.length === 0) {
      reset();
      continue;
    }

    const actualByCategory = new Map<number | null, bigint>();
    let attributedMinorUnits = 0n;
    let invalidFunding = false;
    for (const row of event.fundingRows) {
      if (!Number.isSafeInteger(row.amount) || row.amount <= 0) {
        invalidFunding = true;
        break;
      }
      const amount = BigInt(row.amount);
      actualByCategory.set(
        row.budgetCategoryId,
        (actualByCategory.get(row.budgetCategoryId) ?? 0n) + amount,
      );
      attributedMinorUnits += amount;
    }
    const principal = BigInt(event.principal);
    if (invalidFunding || attributedMinorUnits > principal) {
      reset();
      continue;
    }
    if (attributedMinorUnits < principal) {
      const remainder = principal - attributedMinorUnits;
      actualByCategory.set(
        null,
        (actualByCategory.get(null) ?? 0n) + remainder,
      );
      // A legacy or partial split cannot carry exact rounding state forward.
      reset();
      continue;
    }

    let expected: Array<{ budget_category_id: number | null; minor_units: number }>;
    try {
      expected = allocateLoanBudgetDefaultMinorUnits(
        event.principal,
        weights,
        settledMinorUnits === 0n
          ? undefined
          : {
              settled_minor_units: Number(settledMinorUnits),
              settled_allocations: [...settledByCategory].map(
                ([budget_category_id, minor_units]) => ({
                  budget_category_id,
                  minor_units: Number(minor_units),
                }),
              ),
              settled_progress_available: true,
            },
      );
    } catch {
      reset();
      continue;
    }

    const expectedByCategory = new Map<number | null, bigint>();
    for (const row of expected) {
      if (row.minor_units > 0) {
        expectedByCategory.set(row.budget_category_id, BigInt(row.minor_units));
      }
    }
    const exactMatch = expectedByCategory.size === actualByCategory.size &&
      [...expectedByCategory].every(([categoryId, amount]) => actualByCategory.get(categoryId) === amount);
    if (!exactMatch) {
      // A complete but different saved split is a known manual/old-settings
      // boundary. Begin a fresh carry sequence at the next repayment.
      resetKnownBoundary();
      continue;
    }

    settledMinorUnits += principal;
    for (const [categoryId, amount] of actualByCategory) {
      settledByCategory.set(
        categoryId,
        (settledByCategory.get(categoryId) ?? 0n) + amount,
      );
    }
    if (settledMinorUnits > maxSafe) reset();
    else available = true;
  }

  if (!available) {
    return {
      settled_minor_units: 0,
      settled_allocations: [],
      settled_progress_available: false,
    };
  }
  const settledAllocations: LongTermLoanBudgetSettledAllocation[] = [...settledByCategory]
    .filter(([, minorUnits]) => minorUnits > 0n)
    .map(([budget_category_id, minorUnits]) => ({
      budget_category_id,
      minor_units: Number(minorUnits),
    }))
    .sort((left, right) => {
      if (left.budget_category_id === null) return right.budget_category_id === null ? 0 : 1;
      if (right.budget_category_id === null) return -1;
      return left.budget_category_id - right.budget_category_id;
    });
  return {
    settled_minor_units: Number(settledMinorUnits),
    settled_allocations: settledAllocations,
    settled_progress_available: true,
  };
}

export async function getLongTermLoanBudgetDefaults(
  db: D1Database,
  accountId: number,
  currencyInput: string | null | undefined,
): Promise<LongTermLoanBudgetDefaults | null> {
  const currency = normalizeLoanBudgetCurrency(currencyInput);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const revision = await readBudgetMutationRevision(db);
    const account = await db.prepare(`
      SELECT id, type, category FROM accounts WHERE id = ?
    `).bind(accountId).first<LoanAccount>();
    if (!account || !isLongTermLoanBudgetAccount(account)) {
      if (await readBudgetMutationRevision(db) === revision) return null;
      continue;
    }

    const custom = await readCustomDefault(db, accountId, currency);
    const config = custom ?? await deriveOpeningDefault(db, account, currency);
    const events = await readLoanBudgetSettlementEvents(db, account, currency);
    const progress = replaySettlementProgress(events, config.allocations);
    const verifiedRevision = await readBudgetMutationRevision(db);
    if (verifiedRevision === revision) {
      return {
        ...config,
        ...progress,
        budget_revision: verifiedRevision,
      };
    }
  }
  throw new LoanBudgetDefaultsChangedError();
}
