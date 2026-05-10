import type { BudgetAdjustmentLog } from "@balance-sheet/shared";

export type BudgetAdjustmentLogSortKey =
  | "date"
  | "type"
  | "category"
  | "amount";

export interface BudgetAdjustmentLogSort {
  key: BudgetAdjustmentLogSortKey;
  dir: "asc" | "desc";
}

function latestInputFirst(a: BudgetAdjustmentLog, b: BudgetAdjustmentLog) {
  return (
    b.date.localeCompare(a.date) ||
    b.created_at.localeCompare(a.created_at) ||
    b.id - a.id
  );
}

export function sortBudgetAdjustmentLogs(
  logs: BudgetAdjustmentLog[],
  sort: BudgetAdjustmentLogSort,
  budgetCategoryOrderIds: number[] = [],
): BudgetAdjustmentLog[] {
  const sorted = [...logs];
  const { key, dir } = sort;
  const categoryOrder = new Map(
    budgetCategoryOrderIds.map((id, index) => [id, index]),
  );

  sorted.sort((a, b) => {
    let cmp = 0;
    if (key === "date") cmp = a.date.localeCompare(b.date);
    else if (key === "type") cmp = a.type.localeCompare(b.type);
    else if (key === "category") {
      const aOrder = categoryOrder.get(a.budget_category_id);
      const bOrder = categoryOrder.get(b.budget_category_id);
      if (aOrder !== undefined || bOrder !== undefined) {
        cmp =
          (aOrder ?? Number.MAX_SAFE_INTEGER) -
          (bOrder ?? Number.MAX_SAFE_INTEGER);
      }
      if (cmp === 0) {
        cmp = (a.budget_category_name ?? "").localeCompare(
          b.budget_category_name ?? "",
        );
      }
    } else if (key === "amount") cmp = a.amount - b.amount;

    if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
    return latestInputFirst(a, b);
  });

  return sorted;
}
