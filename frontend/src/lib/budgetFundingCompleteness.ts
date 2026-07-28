import type {
  Account,
  BudgetAdjustmentLog,
  JournalEntry,
} from "@balance-sheet/shared";

export interface BudgetResetBoundary {
  date: string;
  created_at: string;
}

const LOAN_ACCOUNT_CATEGORIES = new Set<Account["category"]>([
  "lending",
  "short_term_lending",
  "long_term_lending",
  "short_term_loan",
  "loan",
  "long_term_loan",
]);

export function findLatestBudgetResetBoundary(
  logs: BudgetAdjustmentLog[],
): BudgetResetBoundary | null {
  const latest = logs
    .filter(
      (log) => log.type === "reset" || log.adjustment_type === "reset",
    )
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        b.created_at.localeCompare(a.created_at) ||
        b.id - a.id,
    )[0];
  return latest
    ? { date: latest.date, created_at: latest.created_at }
    : null;
}

function isLoanOrLendingAccount(account: Account | undefined): boolean {
  return Boolean(account && LOAN_ACCOUNT_CATEGORIES.has(account.category));
}

function isEntryAfterBudgetReset(
  entry: JournalEntry,
  boundary: BudgetResetBoundary | null,
): boolean {
  if (!boundary) return true;
  if (entry.date !== boundary.date) return entry.date > boundary.date;
  return entry.created_at > boundary.created_at;
}

export function isLoanBudgetFundingMissing(
  entry: JournalEntry,
  accountMap: Map<number, Account>,
  boundary: BudgetResetBoundary | null,
  currency?: string,
): boolean {
  if (!isEntryAfterBudgetReset(entry, boundary)) return false;
  if ((entry.budget_funding?.allocations.length ?? 0) > 0) return false;
  const normalizedCurrency = currency?.toUpperCase();
  return entry.lines.some(
    (line) =>
      isLoanOrLendingAccount(accountMap.get(line.account_id)) &&
      (!normalizedCurrency ||
        (line.currency || "JPY").toUpperCase() === normalizedCurrency),
  );
}

export function getLoanBudgetFundingPrincipal(
  entry: JournalEntry,
  accountMap: Map<number, Account>,
  currency?: string,
): number {
  const normalizedCurrency = currency?.toUpperCase();
  const netByAccount = new Map<number, number>();
  for (const line of entry.lines) {
    if (!isLoanOrLendingAccount(accountMap.get(line.account_id))) continue;
    if (
      normalizedCurrency &&
      (line.currency || "JPY").toUpperCase() !== normalizedCurrency
    ) {
      continue;
    }
    netByAccount.set(
      line.account_id,
      (netByAccount.get(line.account_id) ?? 0) + line.debit - line.credit,
    );
  }
  return Math.max(0, ...[...netByAccount.values()].map(Math.abs));
}
