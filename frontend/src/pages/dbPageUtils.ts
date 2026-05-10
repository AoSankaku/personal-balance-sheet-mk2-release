import {
  isShortTermBorrowingCategory,
  isShortTermLendingCategory,
  type Account,
  type JournalEntry,
} from "@balance-sheet/shared";

export interface LoanEntryWithChange {
  entry: Pick<JournalEntry, "date" | "id" | "loan_settlement"> &
    Partial<Pick<JournalEntry, "description">>;
  netChange: number;
}

export interface LoanBalanceHistoryRow extends LoanEntryWithChange {
  balanceAfter: number;
}

export interface ShortTermLoanAccountWithEntries {
  account: Pick<
    Account,
    "id" | "name" | "type" | "category" | "is_completed" | "balance"
  >;
  entries: LoanEntryWithChange[];
}

export interface OverdueShortTermLoanAccount {
  account: ShortTermLoanAccountWithEntries["account"];
  daysDiff: number;
}

export function isUnsettledOpeningEntry({
  entry,
  netChange,
}: LoanEntryWithChange) {
  return netChange > 0 && entry.loan_settlement?.is_settled !== true;
}

export function isShortTermLoanAccountActive(
  account: Pick<Account, "is_completed" | "balance">,
  entries: LoanEntryWithChange[],
) {
  if (account.is_completed) return false;
  if (entries.length === 0) return true;
  if (entries.some(isUnsettledOpeningEntry)) return true;
  return Math.abs(account.balance ?? 0) > 0.001;
}

function localDateMillis(value: Date | string): number {
  if (value instanceof Date) {
    return new Date(
      value.getFullYear(),
      value.getMonth(),
      value.getDate(),
    ).getTime();
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    const parsed = new Date(value);
    return new Date(
      parsed.getFullYear(),
      parsed.getMonth(),
      parsed.getDate(),
    ).getTime();
  }

  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  ).getTime();
}

export function findOverdueShortTermLoanAccounts(
  accounts: ShortTermLoanAccountWithEntries[],
  daysThreshold: number,
  today: Date | string = new Date(),
): OverdueShortTermLoanAccount[] {
  if (!Number.isFinite(daysThreshold) || daysThreshold <= 0) return [];

  const todayMillis = localDateMillis(today);
  const dayMillis = 1000 * 60 * 60 * 24;

  return accounts.flatMap(({ account, entries }) => {
    const isShortTerm =
      isShortTermLendingCategory(account.category) ||
      isShortTermBorrowingCategory(account.category);
    if (!isShortTerm) return [];

    const daysDiff = entries
      .filter(isUnsettledOpeningEntry)
      .map(({ entry }) =>
        Math.floor((todayMillis - localDateMillis(entry.date)) / dayMillis),
      )
      .reduce((max, days) => Math.max(max, days), Number.NEGATIVE_INFINITY);

    if (daysDiff < daysThreshold) return [];
    return [{ account, daysDiff }];
  });
}

export function buildLoanBalanceHistory(
  entries: LoanEntryWithChange[],
): LoanBalanceHistoryRow[] {
  let balance = 0;
  return [...entries]
    .sort(
      (a, b) =>
        a.entry.date.localeCompare(b.entry.date) || a.entry.id - b.entry.id,
    )
    .map((item) => {
      balance += item.netChange;
      return { ...item, balanceAfter: balance };
    })
    .reverse();
}
