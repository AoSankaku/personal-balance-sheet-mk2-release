import type {
  Account,
  BudgetAdjustmentLog,
  JournalEntry,
} from "@balance-sheet/shared";
import { calculateMultiLineBudgetFundingImpact } from "./multiLineBudgetFunding";

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
  budgetCategoryIds?: number[],
): BudgetResetBoundary | null {
  const resets = logs.filter(
    (log) => log.type === "reset" || log.adjustment_type === "reset",
  );
  const latestFirst = (
    left: BudgetAdjustmentLog,
    right: BudgetAdjustmentLog,
  ) =>
    right.date.localeCompare(left.date) ||
    right.created_at.localeCompare(left.created_at) ||
    right.id - left.id;
  let latest: BudgetAdjustmentLog | undefined;
  if (budgetCategoryIds && budgetCategoryIds.length > 0) {
    const latestByCategory = budgetCategoryIds.map((categoryId) =>
      resets
        .filter((log) => log.budget_category_id === categoryId)
        .sort(latestFirst)[0],
    );
    if (latestByCategory.some((reset) => reset == null)) return null;
    latest = latestByCategory
      .filter((reset): reset is BudgetAdjustmentLog => reset != null)
      .sort((left, right) => -latestFirst(left, right))[0];
  } else {
    latest = resets.sort(latestFirst)[0];
  }
  return latest
    ? { date: latest.date, created_at: latest.created_at }
    : null;
}

function isLoanOrLendingAccount(account: Account | undefined): boolean {
  return Boolean(account && LOAN_ACCOUNT_CATEGORIES.has(account.category));
}

function isAllocatableBudgetAsset(account: Account | undefined): boolean {
  return Boolean(
    account &&
      account.type === "asset" &&
      account.category === "cash" &&
      account.include_in_allocatable !== false &&
      account.is_depreciable !== true,
  );
}

export function getAllocatableAssetDelta(
  entry: JournalEntry,
  accountMap: Map<number, Account>,
  currency?: string,
): number {
  const normalizedCurrency = currency?.toUpperCase();
  return entry.lines.reduce((sum, line) => {
    if (!isAllocatableBudgetAsset(accountMap.get(line.account_id))) return sum;
    if (
      normalizedCurrency &&
      (line.currency || "JPY").toUpperCase() !== normalizedCurrency
    ) {
      return sum;
    }
    return sum + line.debit - line.credit;
  }, 0);
}

export function isEntryAfterBudgetReset(
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
  const selectedCurrency = (currency || "JPY").toUpperCase();
  const impact = calculateMultiLineBudgetFundingImpact({
    lines: entry.lines.map((line) => ({
      account_id: line.account_id,
      debit: line.debit,
      credit: line.credit,
      currency: line.currency,
    })),
    accounts: [...accountMap.values()],
    currency: selectedCurrency,
  });
  if (impact.components.length === 0) return false;

  const savedComponents = entry.budget_funding_components ?? [];
  if (savedComponents.length > 0) {
    if (savedComponents.length !== impact.components.length) return true;
    return impact.components.some((expected) => {
      const saved = savedComponents.find(
        (component) => component.kind === expected.kind,
      );
      const savedApplied = saved?.allocations
        .filter((allocation) => allocation.effect === "apply")
        .reduce((sum, allocation) => sum + allocation.amount, 0);
      const savedComponentOnly = saved?.allocations
        .filter((allocation) => allocation.effect === "component_only")
        .reduce((sum, allocation) => sum + allocation.amount, 0);
      return (
        !saved ||
        Math.abs(saved.principal_amount - expected.principal_amount) >
          0.000_001 ||
        Math.abs(saved.applied_amount - expected.applied_amount) > 0.000_001 ||
        Math.abs(
          saved.component_only_amount - expected.component_only_amount,
        ) > 0.000_001 ||
        Math.abs(
          saved.allocations.reduce(
            (sum, allocation) => sum + allocation.amount,
            0,
          ) - saved.principal_amount,
        ) > 0.000_001 ||
        Math.abs((savedApplied ?? 0) - saved.applied_amount) > 0.000_001 ||
        Math.abs(
          (savedComponentOnly ?? 0) - saved.component_only_amount,
        ) > 0.000_001
      );
    });
  }
  if ((entry.budget_funding?.allocations.length ?? 0) > 0) {
    const expectedPrincipal = impact.components.reduce(
      (sum, component) => sum + component.principal_amount,
      0,
    );
    const savedPrincipal = entry.budget_funding!.allocations.reduce(
      (sum, allocation) => sum + allocation.amount,
      0,
    );
    return Math.abs(expectedPrincipal - savedPrincipal) > 0.000_001;
  }
  return impact.components.some((component) => component.applied_amount > 0);
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
