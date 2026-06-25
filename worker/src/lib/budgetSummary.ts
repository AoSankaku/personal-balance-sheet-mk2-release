export interface BudgetAdjustmentLogForPeriod {
  budget_category_id: number;
  year_month: string;
  amount: number;
  date: string;
  adjustment_type?: string;
  created_at?: string | null;
}

export interface DateRange {
  start: string;
  end: string;
}

export function sumBudgetAdjustmentLogsByPeriod(
  rows: BudgetAdjustmentLogForPeriod[],
  dateRangesByYearMonth: Map<string, DateRange>,
): Map<string, number> {
  const sums = new Map<string, number>();

  for (const row of rows) {
    const range = dateRangesByYearMonth.get(row.year_month);
    if (!range) continue;
    if (row.date < range.start || row.date > range.end) continue;

    const key = `${row.budget_category_id}:${row.year_month}`;
    sums.set(key, (sums.get(key) ?? 0) + row.amount);
  }

  return sums;
}

export interface BudgetResetPoint {
  date: string;
  created_at?: string | null;
}

export interface BudgetTimelineEvent {
  date: string;
  created_at?: string | null;
}

export function isAfterBudgetResetPoint(
  event: BudgetTimelineEvent,
  resetPoint: BudgetResetPoint | null,
): boolean {
  if (!resetPoint) return true;
  if (event.date > resetPoint.date) return true;
  if (event.date < resetPoint.date) return false;
  if (!event.created_at || !resetPoint.created_at) return false;
  return event.created_at > resetPoint.created_at;
}

export function findLatestResetPointForPeriod(
  rows: BudgetAdjustmentLogForPeriod[],
  budgetCategoryId: number,
  dateRange: DateRange,
): BudgetResetPoint | null {
  const resetPoints = rows
    .filter(
      (row) =>
        row.budget_category_id === budgetCategoryId &&
        row.adjustment_type === "reset" &&
        row.date >= dateRange.start &&
        row.date <= dateRange.end,
    )
    .map((row) => ({
      date: row.date,
      created_at: row.created_at ?? null,
    }))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.created_at ?? "").localeCompare(b.created_at ?? ""),
    );

  return resetPoints.at(-1) ?? null;
}

export function sumBudgetAdjustmentLogsAfterResetsByPeriod(
  rows: BudgetAdjustmentLogForPeriod[],
  dateRangesByYearMonth: Map<string, DateRange>,
): Map<string, number> {
  const sums = new Map<string, number>();
  const resetPointByKey = new Map<string, BudgetResetPoint | null>();

  for (const row of rows) {
    const range = dateRangesByYearMonth.get(row.year_month);
    if (!range) continue;
    if (row.date < range.start || row.date > range.end) continue;

    const key = `${row.budget_category_id}:${row.year_month}`;
    if (!resetPointByKey.has(key)) {
      resetPointByKey.set(
        key,
        findLatestResetPointForPeriod(
          rows,
          row.budget_category_id,
          range,
        ),
      );
    }

    if (row.adjustment_type === "reset") continue;
    if (!isAfterBudgetResetPoint(row, resetPointByKey.get(key) ?? null)) {
      continue;
    }

    sums.set(key, (sums.get(key) ?? 0) + row.amount);
  }

  return sums;
}

export interface CarryoverInput {
  budgetBase: number;
  carryover: number;
  spent: number;
  isInPositiveRolloverWindow: boolean;
}

export interface BudgetEntryAllocationForSpent {
  journal_entry_id: number;
  budget_category_id: number;
  amount: number;
}

export interface BudgetEntryAllocationForPeriod
  extends BudgetEntryAllocationForSpent {
  date: string;
  created_at: string;
}

export function groupBudgetEntryAllocationsByMonth<
  T extends BudgetEntryAllocationForPeriod,
>(
  rows: T[],
  dateRangesByYearMonth: Map<string, DateRange>,
): Map<string, T[]> {
  const grouped = new Map(
    [...dateRangesByYearMonth.keys()].map((yearMonth) => [yearMonth, [] as T[]]),
  );

  for (const row of rows) {
    const yearMonth = row.date.slice(0, 7);
    const range = dateRangesByYearMonth.get(yearMonth);
    if (!range || row.date < range.start || row.date > range.end) continue;
    grouped.get(yearMonth)?.push(row);
  }

  return grouped;
}

export function calculateSpentFromBudgetAllocations(
  budgetCategoryId: number,
  entryAllocs: BudgetEntryAllocationForSpent[],
): number {
  const allocatedAmount = entryAllocs
    .filter((entryAlloc) => entryAlloc.budget_category_id === budgetCategoryId)
    .reduce((sum, entryAlloc) => sum + entryAlloc.amount, 0);

  return -allocatedAmount;
}

export function calculateNextCarryover({
  budgetBase,
  carryover,
  spent,
}: CarryoverInput): number {
  return budgetBase + carryover - spent;
}

export interface BudgetCapCategory {
  id: number;
  sort_order: number;
  balance_cap?: number | null;
  overflow_budget_category_id?: number | null;
}

export interface BudgetCapSummary {
  category: BudgetCapCategory;
  carryover: number;
  total_budget: number;
  available: number;
}

export function applyBudgetBalanceCaps<T extends BudgetCapSummary>(
  summaries: T[],
): T[] {
  const byId = new Map(summaries.map((summary) => [summary.category.id, summary]));
  const ordered = [...summaries].sort(
    (a, b) =>
      a.category.sort_order - b.category.sort_order ||
      a.category.id - b.category.id,
  );

  for (let pass = 0; pass < ordered.length; pass++) {
    let moved = false;
    for (const summary of ordered) {
      const cap = summary.category.balance_cap;
      const targetId = summary.category.overflow_budget_category_id;
      if (cap == null || targetId == null || summary.available <= cap) {
        continue;
      }

      const target = byId.get(targetId);
      if (!target || target === summary) continue;

      const excess = summary.available - cap;
      summary.carryover -= excess;
      summary.total_budget -= excess;
      summary.available -= excess;
      target.carryover += excess;
      target.total_budget += excess;
      target.available += excess;
      moved = true;
    }
    if (!moved) break;
  }

  return summaries;
}

export function findLatestResetDateForPeriod(
  rows: BudgetAdjustmentLogForPeriod[],
  budgetCategoryId: number,
  dateRange: DateRange,
): string | null {
  return (
    findLatestResetPointForPeriod(rows, budgetCategoryId, dateRange)?.date ??
    null
  );
}

export function shouldShowCarryoverForPeriod(
  rows: BudgetAdjustmentLogForPeriod[],
  budgetCategoryId: number,
  dateRange: DateRange,
): boolean {
  return (
    findLatestResetDateForPeriod(rows, budgetCategoryId, dateRange) === null
  );
}
