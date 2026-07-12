export function shouldRefreshMonthScopedData(pathname: string): boolean {
  return pathname !== "/";
}

export function getOverviewBudgetSkeletonCategoryIds(
  categories: ReadonlyArray<{
    id: number;
    budget_group?: string | null;
  }>,
): number[] {
  return categories
    .filter((category) => category.budget_group !== "貯蓄")
    .map((category) => category.id);
}

export function getOverviewBudgetUsagePercentage(
  totalBudget: number,
  totalSpent: number,
): number | null {
  return totalBudget > 0 ? (totalSpent / totalBudget) * 100 : null;
}

export function isOverviewSummaryLoading({
  selectionKey,
  requestKey,
  requestPending,
}: {
  selectionKey: string | null;
  requestKey: string | null;
  requestPending: boolean;
}): boolean {
  if (selectionKey === null) return false;
  return requestKey !== selectionKey || requestPending;
}
