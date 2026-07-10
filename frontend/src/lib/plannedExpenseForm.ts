import { resolveMonthlyPayday } from "@balance-sheet/shared";
import {
  plannedExpenseCalendarOccurrences,
  plannedExpenseNextOccurrenceDate,
  plannedExpenseAddSkippedDate,
  type PlannedExpenseCalendarItem,
} from "./plannedExpenseCalendar";

export function plannedExpenseCategorySelectValue(
  categoryId?: number | null,
): string | null {
  return categoryId == null ? null : String(categoryId);
}

export function shouldShowPlannedExpenseStatusField(
  editingItem?: { id: number } | null,
): boolean {
  return editingItem != null;
}

export function plannedExpenseItemNameLineClamp(): number {
  return 2;
}

export function plannedExpenseDayOfMonthSelectOptions(
  t: (key: "closingDayEndOfMonth") => string,
): Array<{ value: string; label: string }> {
  return [
    { value: "0", label: t("closingDayEndOfMonth") },
    ...Array.from({ length: 31 }, (_, index) => {
      const day = String(index + 1);
      return { value: day, label: day };
    }),
  ];
}

export function plannedExpenseMonthlyDueDateFromDay(
  date: string | null,
  day: number | null,
): string | null {
  if (!date || day == null) return date;
  const month = date.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return date;
  const resolvedDay = resolveMonthlyPayday(month, day);
  return `${month}-${String(resolvedDay).padStart(2, "0")}`;
}

export function serializePlannedExpenseWeeksOfMonth(
  values: string[],
): string | null {
  const normalized = Array.from(
    new Set(
      values
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 1 && value <= 5),
    ),
  ).sort((a, b) => a - b);
  return normalized.length > 0 ? normalized.join(",") : null;
}

export function parsePlannedExpenseWeeksOfMonth(
  value?: string | null,
): string[] {
  if (!value) return [];
  const serialized = serializePlannedExpenseWeeksOfMonth(value.split(","));
  return serialized ? serialized.split(",") : [];
}

export function shouldShowWishlistItemInMainList(item: {
  status: string;
}): boolean {
  return item.status !== "completed" && item.status !== "cancelled";
}

export function shouldShowWishlistItemInCompletedList(item: {
  status: string;
}): boolean {
  return item.status === "completed" || item.status === "cancelled";
}

export function shouldShowCompletedWishlistAmountTotal(): boolean {
  return false;
}

export function shouldShowScheduledItemInCompletedOneTimeList(item: {
  kind: string;
  recurrence_type: string;
  status: string;
}): boolean {
  return (
    item.kind === "scheduled_payment" &&
    item.recurrence_type === "one_time" &&
    item.status === "completed"
  );
}

export function shouldShowScheduledItemInMainList(item: {
  kind: string;
  recurrence_type: string;
  status: string;
}): boolean {
  return !shouldShowScheduledItemInCompletedOneTimeList(item);
}

export type PlannedExpenseCompletedScheduledReason =
  | "completed"
  | "end_date"
  | "final_occurrence";

export type PlannedExpenseCompletedScheduledEntry<T> = {
  item: T;
  reason: PlannedExpenseCompletedScheduledReason;
  completedAt: string;
};

export type PlannedExpenseCompletedScheduledGroup<T> = {
  reason: PlannedExpenseCompletedScheduledReason;
  items: Array<PlannedExpenseCompletedScheduledEntry<T>>;
};

type ScheduledRecurrenceCandidate = Partial<PlannedExpenseCalendarItem> & {
  recurrence_type: string;
  target_date?: string | null;
  next_due_date?: string | null;
  end_date?: string | null;
  recurrence_count?: number | null;
};

type ScheduledCompletionCandidate = ScheduledRecurrenceCandidate & {
  id: number;
  kind: string;
  status: string;
  completed_dates?: string | null;
  updated_at?: string | null;
};

const completedScheduledReasonOrder: PlannedExpenseCompletedScheduledReason[] = [
  "completed",
  "end_date",
  "final_occurrence",
];

function dateOnly(value?: string | null): string | null {
  if (!value) return null;
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function latestDate(values: Array<string | null>): string | null {
  return values.filter((value): value is string => value != null).sort().at(-1) ??
    null;
}

function addDaysToDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addMonthsToDate(value: string, months: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function finalOccurrenceSearchEnd(
  item: ScheduledRecurrenceCandidate,
  anchorDate: string,
): string {
  const count = item.recurrence_count ?? 1;
  const interval =
    item.recurrence_interval ?? item.recurrence_interval_months ?? 1;
  const boundedInterval =
    Number.isInteger(interval) && interval > 0 ? interval : 1;
  if (item.recurrence_unit === "week") {
    return addDaysToDate(anchorDate, count * boundedInterval * 7 + 31);
  }
  if (item.recurrence_unit === "year") {
    return addMonthsToDate(anchorDate, count * boundedInterval * 12 + 24);
  }
  return addMonthsToDate(anchorDate, count * boundedInterval + 24);
}

function plannedExpenseCalendarItemFromRecurrence(
  item: ScheduledRecurrenceCandidate,
  anchorDate: string,
  recurrenceCount: number | null,
  endDate: string | null,
): PlannedExpenseCalendarItem {
  return {
    kind: "scheduled_payment",
    target_date: item.target_date ?? null,
    category_target_date: null,
    recurrence_type: "recurring",
    recurrence_interval: item.recurrence_interval ?? null,
    recurrence_unit: item.recurrence_unit ?? "month",
    recurrence_monthly_mode: item.recurrence_monthly_mode ?? "day_of_month",
    recurrence_interval_months: item.recurrence_interval_months ?? null,
    recurrence_day: item.recurrence_day ?? null,
    recurrence_weeks_of_month: item.recurrence_weeks_of_month ?? null,
    recurrence_weekday: item.recurrence_weekday ?? null,
    recurrence_week_fallback: item.recurrence_week_fallback ?? null,
    next_due_date: anchorDate,
    end_date: endDate,
    recurrence_count: recurrenceCount,
    skipped_dates: null,
    completed_dates: null,
  };
}

export function plannedExpenseRecurrenceFinalOccurrenceDate(
  item: ScheduledRecurrenceCandidate,
): string | null {
  if (item.recurrence_type !== "recurring" || item.recurrence_count == null) {
    return null;
  }
  const anchorDate = dateOnly(item.next_due_date) ?? dateOnly(item.target_date);
  if (!anchorDate) return null;
  const calendarItem = plannedExpenseCalendarItemFromRecurrence(
    item,
    anchorDate,
    item.recurrence_count,
    null,
  );
  return plannedExpenseCalendarOccurrences(
    calendarItem,
    anchorDate,
    finalOccurrenceSearchEnd(item, anchorDate),
  ).at(-1)?.date ?? null;
}

export function plannedExpenseRecurrencePlannedCount(
  item: ScheduledRecurrenceCandidate,
): number | null {
  if (item.recurrence_type !== "recurring") return null;
  const anchorDate = dateOnly(item.next_due_date) ?? dateOnly(item.target_date);
  const endDate = dateOnly(item.end_date);
  if (!anchorDate || !endDate || endDate < anchorDate) return null;
  return plannedExpenseCalendarOccurrences(
    plannedExpenseCalendarItemFromRecurrence(item, anchorDate, null, endDate),
    anchorDate,
    endDate,
  ).length;
}

export type PlannedExpenseSkipPolicy = "postpone" | "reduce";

export function plannedExpenseHasFixedRecurrenceEnd(
  item: ScheduledRecurrenceCandidate,
): boolean {
  return item.recurrence_type === "recurring" &&
    (item.recurrence_count != null || dateOnly(item.end_date) != null);
}

export function plannedExpenseApplyScheduledSkipPolicy(
  item: ScheduledRecurrenceCandidate & {
    skipped_dates?: string | null;
  },
  date: string,
  policy: PlannedExpenseSkipPolicy,
): {
  skipped_dates: string | null;
  recurrence_count?: number | null;
  end_date?: string | null;
} {
  const updates: {
    skipped_dates: string | null;
    recurrence_count?: number | null;
    end_date?: string | null;
  } = {
    skipped_dates: plannedExpenseAddSkippedDate(item.skipped_dates, date),
  };
  if (policy !== "postpone" || item.recurrence_type !== "recurring") {
    return updates;
  }
  if (item.recurrence_count != null) {
    updates.recurrence_count = item.recurrence_count + 1;
    return updates;
  }
  const endDate = dateOnly(item.end_date);
  if (endDate) {
    const nextEndDate = plannedExpenseNextOccurrenceDate(
      plannedExpenseCalendarItemFromRecurrence(item, endDate, null, null),
      endDate,
    );
    if (nextEndDate) updates.end_date = nextEndDate;
  }
  return updates;
}

function completedScheduledEntry<T extends ScheduledCompletionCandidate>(
  item: T,
  today: string,
): PlannedExpenseCompletedScheduledEntry<T> | null {
  if (item.kind !== "scheduled_payment") return null;

  const completedAt = latestDate([
    item.status === "completed" ? dateOnly(item.updated_at) : null,
    item.status === "completed" ? dateOnly(item.target_date) : null,
  ]);
  if (completedAt) {
    return { item, reason: "completed", completedAt };
  }

  const endDate = dateOnly(item.end_date);
  if (item.recurrence_type === "recurring" && endDate && endDate <= today) {
    return { item, reason: "end_date", completedAt: endDate };
  }

  const finalDate = plannedExpenseRecurrenceFinalOccurrenceDate(item);
  if (finalDate && finalDate <= today) {
    return { item, reason: "final_occurrence", completedAt: finalDate };
  }

  return null;
}

export function plannedExpenseCompletedScheduledGroups<
  T extends ScheduledCompletionCandidate,
>(items: T[], today: string, limitPerGroup = 10): Array<PlannedExpenseCompletedScheduledGroup<T>> {
  const entries = items
    .map((item) => completedScheduledEntry(item, today))
    .filter(
      (entry): entry is PlannedExpenseCompletedScheduledEntry<T> =>
        entry != null,
    );

  return completedScheduledReasonOrder
    .map((reason) => ({
      reason,
      items: entries
        .filter((entry) => entry.reason === reason)
        .sort(
          (a, b) =>
            b.completedAt.localeCompare(a.completedAt) || b.item.id - a.item.id,
        )
        .slice(0, limitPerGroup),
    }))
    .filter((group) => group.items.length > 0);
}

export function mergePlannedExpenseListsById<T extends { id: number }>(
  ...lists: T[][]
): T[] {
  const map = new Map<number, T>();
  for (const list of lists) {
    for (const item of list) {
      if (!map.has(item.id)) map.set(item.id, item);
    }
  }
  return [...map.values()];
}

export type PlannedExpenseCompletionResult =
  | "none"
  | "completed"
  | "shopping_list_archived";

export function plannedExpenseCompletionFeedbackKey(
  result: PlannedExpenseCompletionResult | "pending",
):
  | "transactionSaved"
  | "transactionSavedWithPlannedExpenseCompleted"
  | "transactionSavedWithShoppingListArchived" {
  if (result === "shopping_list_archived") {
    return "transactionSavedWithShoppingListArchived";
  }
  if (result === "completed") {
    return "transactionSavedWithPlannedExpenseCompleted";
  }
  return "transactionSaved";
}

export type PlannedExpenseConfirmableAction =
  | "delete_category"
  | "delete_item"
  | "complete_item";

export function plannedExpenseActionRequiresConfirmation(
  action: PlannedExpenseConfirmableAction,
): boolean {
  return action === "delete_category" ||
    action === "delete_item" ||
    action === "complete_item";
}
