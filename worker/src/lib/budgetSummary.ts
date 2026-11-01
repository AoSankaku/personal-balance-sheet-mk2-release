export interface BudgetAdjustmentLogForPeriod {
  budget_category_id: number;
  year_month: string;
  amount: number;
  date: string;
  adjustment_type?: string;
  created_at?: string | null;
}

export interface ManagedMonthlyDepreciationFundingLogForPeriod
  extends BudgetAdjustmentLogForPeriod {
  depreciation_schedule_id?: number | null;
  depreciation_event_key?: string | null;
  depreciation_event_side?: string | null;
}

export interface MonthlyDepreciationFundingAmounts {
  out: number;
  in: number;
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

export interface BudgetResetPointLookup {
  (
  budgetCategoryId: number,
  dateRange: DateRange,
  ): BudgetResetPoint | null;
  beforeEvent(
    budgetCategoryId: number,
    event: BudgetTimelineEvent,
  ): BudgetResetPoint | null;
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

/** Builds a request-local, category-indexed reset lookup for repeated periods. */
export function createBudgetResetPointLookup(
  rows: BudgetAdjustmentLogForPeriod[],
): BudgetResetPointLookup {
  const resetsByCategory = new Map<number, BudgetResetPoint[]>();
  for (const row of rows) {
    if (row.adjustment_type !== "reset") continue;
    let resets = resetsByCategory.get(row.budget_category_id);
    if (!resets) {
      resets = [];
      resetsByCategory.set(row.budget_category_id, resets);
    }
    resets.push({ date: row.date, created_at: row.created_at ?? null });
  }

  for (const resets of resetsByCategory.values()) {
    resets.sort((a, b) => compareDateAndCreation(a, b));
  }

  const lookup: BudgetResetPointLookup = (budgetCategoryId, dateRange) => {
    const resets = resetsByCategory.get(budgetCategoryId);
    if (!resets) return null;

    // Find the last reset at or before the range end.
    let low = 0;
    let high = resets.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (resets[middle]!.date <= dateRange.end) low = middle + 1;
      else high = middle;
    }
    const candidate = resets[low - 1];
    return candidate && candidate.date >= dateRange.start ? candidate : null;
  };
  lookup.beforeEvent = (budgetCategoryId, event) => {
    const resets = resetsByCategory.get(budgetCategoryId);
    if (!resets) return null;
    let firstSameDay = 0;
    let afterEarlierDates = resets.length;
    while (firstSameDay < afterEarlierDates) {
      const middle = (firstSameDay + afterEarlierDates) >>> 1;
      if (resets[middle]!.date < event.date) firstSameDay = middle + 1;
      else afterEarlierDates = middle;
    }
    const earlier = resets[firstSameDay - 1];
    if (!event.created_at) return earlier ?? null;
    let latestSameDay: BudgetResetPoint | null = null;
    for (let index = firstSameDay; index < resets.length; index++) {
      const reset = resets[index]!;
      if (reset.date !== event.date) break;
      if (!reset.created_at || !(event.created_at > reset.created_at)) continue;
      if (
        !latestSameDay ||
        reset.created_at.localeCompare(latestSameDay.created_at ?? "") >= 0
      ) latestSameDay = reset;
    }
    return latestSameDay ?? earlier ?? null;
  };
  return lookup;
}

function compareDateAndCreation(a: BudgetResetPoint, b: BudgetResetPoint) {
  return (
    a.date.localeCompare(b.date) ||
    (a.created_at ?? "").localeCompare(b.created_at ?? "")
  );
}

export function sumBudgetAdjustmentLogsAfterResetsByPeriod(
  rows: BudgetAdjustmentLogForPeriod[],
  dateRangesByYearMonth: Map<string, DateRange>,
  resetPointFor: BudgetResetPointLookup = createBudgetResetPointLookup(rows),
): Map<string, number> {
  const sums = new Map<string, number>();

  for (const row of rows) {
    const range = dateRangesByYearMonth.get(row.year_month);
    if (!range) continue;
    if (row.date < range.start || row.date > range.end) continue;

    const key = `${row.budget_category_id}:${row.year_month}`;
    const resetPoint = resetPointFor(row.budget_category_id, range);

    if (row.adjustment_type === "reset") continue;
    if (!isAfterBudgetResetPoint(row, resetPoint)) {
      continue;
    }

    sums.set(key, (sums.get(key) ?? 0) + row.amount);
  }

  return sums;
}

export function sumManagedMonthlyDepreciationFundingAfterResetsByPeriod(
  rows: ManagedMonthlyDepreciationFundingLogForPeriod[],
  dateRangesByYearMonth: Map<string, DateRange>,
  resetPointFor: BudgetResetPointLookup = createBudgetResetPointLookup(rows),
): Map<string, MonthlyDepreciationFundingAmounts> {
  const sums = new Map<string, MonthlyDepreciationFundingAmounts>();

  for (const row of rows) {
    const range = dateRangesByYearMonth.get(row.year_month);
    if (!range || row.date < range.start || row.date > range.end) continue;
    if (
      !Number.isInteger(row.depreciation_schedule_id) ||
      (row.depreciation_schedule_id ?? 0) <= 0 ||
      row.adjustment_type !== "transfer" ||
      !isManagedMonthlyDepreciationEventKey(row.depreciation_event_key)
    ) {
      continue;
    }

    const direction =
      row.depreciation_event_side === "source" && row.amount < 0
        ? "out"
        : row.depreciation_event_side === "destination" && row.amount > 0
          ? "in"
          : null;
    if (!direction) continue;

    const key = `${row.budget_category_id}:${row.year_month}`;
    const resetPoint = resetPointFor(row.budget_category_id, range);
    if (!isAfterBudgetResetPoint(row, resetPoint)) {
      continue;
    }

    const totals = sums.get(key) ?? { out: 0, in: 0 };
    totals[direction] += direction === "out" ? -row.amount : row.amount;
    sums.set(key, totals);
  }

  return sums;
}

function isManagedMonthlyDepreciationEventKey(
  eventKey: string | null | undefined,
): boolean {
  return (
    typeof eventKey === "string" &&
    /^monthly:\d+(?::(?:category:\d+|unallocated))?$/.test(eventKey)
  );
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
  is_reference?: boolean | number;
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

/** Indexes period events once, retaining input order within each bucket. */
export function groupBudgetEventsByCategoryAndMonth<
  T extends { budget_category_id: number; date: string },
>(
  rows: T[],
  dateRangesByYearMonth: Map<string, DateRange>,
): Map<string, Map<number, T[]>> {
  const grouped = new Map<string, Map<number, T[]>>();
  for (const row of rows) {
    const yearMonth = row.date.slice(0, 7);
    const range = dateRangesByYearMonth.get(yearMonth);
    if (!range || row.date < range.start || row.date > range.end) continue;
    let byCategory = grouped.get(yearMonth);
    if (!byCategory) {
      byCategory = new Map();
      grouped.set(yearMonth, byCategory);
    }
    let events = byCategory.get(row.budget_category_id);
    if (!events) {
      events = [];
      byCategory.set(row.budget_category_id, events);
    }
    events.push(row);
  }
  return grouped;
}

export function calculateSpentFromBudgetAllocations(
  budgetCategoryId: number,
  entryAllocs: BudgetEntryAllocationForSpent[],
): number {
  const allocatedAmount = entryAllocs
    .filter(
      (entryAlloc) =>
        entryAlloc.budget_category_id === budgetCategoryId &&
        entryAlloc.is_reference !== true &&
        entryAlloc.is_reference !== 1,
    )
    .reduce((sum, entryAlloc) => sum + entryAlloc.amount, 0);

  return -allocatedAmount;
}

export function calculateReferenceSpentFromBudgetAllocations(
  budgetCategoryId: number,
  entryAllocs: BudgetEntryAllocationForSpent[],
): number {
  const allocatedAmount = entryAllocs
    .filter(
      (entryAlloc) =>
        entryAlloc.budget_category_id === budgetCategoryId &&
        (entryAlloc.is_reference === true || entryAlloc.is_reference === 1),
    )
    .reduce((sum, entryAlloc) => sum + entryAlloc.amount, 0);

  return -allocatedAmount;
}

export interface DepreciationBudgetReservationEvent
  extends BudgetTimelineEvent {
  budget_category_id: number;
  schedule_id: number;
  amount: number;
}

export interface DepreciationBudgetAllocationEvent
  extends BudgetTimelineEvent {
  budget_category_id: number;
  amount: number;
  depreciation_schedule_id?: number | null;
  is_reference?: boolean | number;
}

export interface DepreciationBudgetMonthResult {
  spent: number;
  cash_basis_spent: number;
  recognized_depreciation: number;
  reservation_added: number;
  uncovered_depreciation: number;
  reservation_remaining: number;
}

/**
 * Applies one month's spending to the budget-side depreciation reservation.
 * A purchase reserves the full cash outflow immediately. Later depreciation
 * consumes that reservation without consuming the category twice. A reset
 * clears old reservations; depreciation on or after the reset date then
 * becomes an uncovered, non-cash budget expense.
 */
export function calculateDepreciationBudgetMonth({
  budgetCategoryId,
  resetPoint,
  reservations,
  allocations,
  activeReservations,
}: {
  budgetCategoryId: number;
  resetPoint: BudgetResetPoint | null;
  reservations: DepreciationBudgetReservationEvent[];
  allocations: DepreciationBudgetAllocationEvent[];
  activeReservations: Map<number, number>;
}): DepreciationBudgetMonthResult {
  if (resetPoint) activeReservations.clear();

  let reservationAdded = 0;
  for (const reservation of reservations) {
    if (
      reservation.budget_category_id !== budgetCategoryId ||
      !isAfterBudgetResetPoint(reservation, resetPoint)
    ) {
      continue;
    }
    reservationAdded += reservation.amount;
    activeReservations.set(reservation.schedule_id, reservation.amount);
  }

  let ordinarySpent = 0;
  let uncoveredDepreciation = 0;
  let recognizedDepreciation = 0;
  for (const allocation of allocations) {
    if (allocation.budget_category_id !== budgetCategoryId) continue;
    const amount = -allocation.amount;
    if (allocation.depreciation_schedule_id == null) {
      if (allocation.is_reference === true || allocation.is_reference === 1) {
        continue;
      }
      if (isAfterBudgetResetPoint(allocation, resetPoint)) {
        ordinarySpent += amount;
      }
      continue;
    }

    // Depreciation entries are pre-created with the schedule. Their economic
    // date, not created_at, determines whether they survive a same-day reset.
    if (resetPoint && allocation.date < resetPoint.date) continue;
    recognizedDepreciation += amount;
    const scheduleId = allocation.depreciation_schedule_id;
    const remaining = activeReservations.get(scheduleId);
    if (remaining == null) {
      uncoveredDepreciation += amount;
    } else {
      activeReservations.set(scheduleId, Math.max(remaining - amount, 0));
    }
  }

  return {
    spent: ordinarySpent + reservationAdded + uncoveredDepreciation,
    cash_basis_spent: ordinarySpent + reservationAdded,
    recognized_depreciation: recognizedDepreciation,
    reservation_added: reservationAdded,
    uncovered_depreciation: uncoveredDepreciation,
    reservation_remaining: [...activeReservations.values()].reduce(
      (sum, amount) => sum + amount,
      0,
    ),
  };
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
