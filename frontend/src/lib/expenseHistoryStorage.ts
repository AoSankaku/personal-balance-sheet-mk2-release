import type { Account, JournalEntry } from "@balance-sheet/shared";

export const EXPENSE_HISTORY_STORAGE_KEY = "expense_history:v1";
export const EXPENSE_HISTORY_SCHEMA_VERSION = 1;

export type ExpenseHistoryGranularity = "month" | "year";

export interface StoredExpenseAccountBucket {
  account_id: number;
  account_name: string;
  total_by_currency: Record<string, number>;
}

export interface StoredExpensePeriodBucket {
  period: string;
  total_by_currency: Record<string, number>;
  accounts: Record<string, StoredExpenseAccountBucket>;
}

export interface StoredExpenseHistorySnapshot {
  version: typeof EXPENSE_HISTORY_SCHEMA_VERSION;
  updated_at: string;
  source: {
    journal_count: number;
    account_count: number;
    first_entry_date: string | null;
    last_entry_date: string | null;
  };
  buckets: Record<
    ExpenseHistoryGranularity,
    Record<string, StoredExpensePeriodBucket>
  >;
}

type StoredExpenseHistorySnapshotOrNull = StoredExpenseHistorySnapshot | null;

function createPeriodBucket(period: string): StoredExpensePeriodBucket {
  return {
    period,
    total_by_currency: {},
    accounts: {},
  };
}

function addCurrencyAmount(
  target: Record<string, number>,
  currency: string,
  amount: number,
) {
  target[currency] = (target[currency] ?? 0) + amount;
}

function addExpenseAmount(
  buckets: Record<string, StoredExpensePeriodBucket>,
  period: string,
  account: Account,
  currency: string,
  amount: number,
) {
  const bucket = buckets[period] ?? createPeriodBucket(period);
  buckets[period] = bucket;

  addCurrencyAmount(bucket.total_by_currency, currency, amount);

  const accountKey = String(account.id);
  const accountBucket =
    bucket.accounts[accountKey] ??
    ({
      account_id: account.id,
      account_name: account.name,
      total_by_currency: {},
    } satisfies StoredExpenseAccountBucket);
  bucket.accounts[accountKey] = accountBucket;
  addCurrencyAmount(accountBucket.total_by_currency, currency, amount);
}

function normalizeCurrency(currency: string | null | undefined) {
  return (currency || "JPY").toUpperCase();
}

export function buildExpenseHistorySnapshot(
  journal: JournalEntry[],
  accounts: Account[],
): StoredExpenseHistorySnapshot {
  const expenseAccountMap = new Map(
    accounts
      .filter((account) => account.type === "expense" && !account.is_system)
      .map((account) => [account.id, account]),
  );

  const monthBuckets: Record<string, StoredExpensePeriodBucket> = {};
  const yearBuckets: Record<string, StoredExpensePeriodBucket> = {};
  let firstEntryDate: string | null = null;
  let lastEntryDate: string | null = null;

  for (const entry of journal) {
    const entryDate = entry.date.slice(0, 10);
    if (!firstEntryDate || entryDate < firstEntryDate)
      firstEntryDate = entryDate;
    if (!lastEntryDate || entryDate > lastEntryDate) lastEntryDate = entryDate;

    const month = entryDate.slice(0, 7);
    const year = entryDate.slice(0, 4);

    for (const line of entry.lines) {
      const account = expenseAccountMap.get(line.account_id);
      if (!account) continue;

      const amount = line.debit - line.credit;
      if (amount <= 0) continue;

      const currency = normalizeCurrency(line.currency);
      addExpenseAmount(monthBuckets, month, account, currency, amount);
      addExpenseAmount(yearBuckets, year, account, currency, amount);
    }
  }

  return {
    version: EXPENSE_HISTORY_SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    source: {
      journal_count: journal.length,
      account_count: accounts.length,
      first_entry_date: firstEntryDate,
      last_entry_date: lastEntryDate,
    },
    buckets: {
      month: monthBuckets,
      year: yearBuckets,
    },
  };
}

export function saveExpenseHistorySnapshot(
  snapshot: StoredExpenseHistorySnapshot,
) {
  try {
    localStorage.setItem(EXPENSE_HISTORY_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // localStorage can be unavailable or full; the journal remains the source of truth.
  }
}

export function loadExpenseHistorySnapshot(): StoredExpenseHistorySnapshotOrNull {
  try {
    const raw = localStorage.getItem(EXPENSE_HISTORY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredExpenseHistorySnapshot;
    return parsed.version === EXPENSE_HISTORY_SCHEMA_VERSION ? parsed : null;
  } catch {
    return null;
  }
}
