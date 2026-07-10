import type { PlannedExpense, PlannedExpenseStatus } from "@balance-sheet/shared";
import {
  normalizePlannedExpenseWeekFallback,
  resolveMonthlyPayday,
  resolvePlannedExpenseWeekdayInMonth,
} from "@balance-sheet/shared";

export type PlannedExpenseCalendarItem = Pick<
  PlannedExpense,
  | "kind"
  | "target_date"
  | "category_target_date"
  | "recurrence_type"
  | "recurrence_interval"
  | "recurrence_unit"
  | "recurrence_monthly_mode"
  | "recurrence_interval_months"
  | "recurrence_day"
  | "recurrence_weeks_of_month"
  | "recurrence_weekday"
  | "recurrence_week_fallback"
  | "next_due_date"
  | "end_date"
  | "recurrence_count"
  | "skipped_dates"
  | "completed_dates"
>;

export type PlannedExpenseCalendarOccurrence = {
  date: string;
  occurrenceNumber: number;
};

export type PlannedExpenseCalendarAmountItem = Pick<
  PlannedExpense,
  "estimated_amount" | "status"
>;

export function plannedExpenseCalendarShouldShowStatus(
  status: PlannedExpenseStatus,
) {
  return status === "open" || status === "cancelled" || status === "completed";
}

export function plannedExpenseCalendarAmount(
  item: PlannedExpenseCalendarAmountItem,
  skipped = false,
) {
  return item.status === "cancelled" || item.status === "completed" || skipped
    ? 0
    : item.estimated_amount;
}

export function plannedExpenseCalendarEntryIsCompleted(
  item: PlannedExpenseCalendarAmountItem,
  skipped = false,
  completed = false,
) {
  return (item.status === "completed" || completed) && !skipped;
}

export function plannedExpenseCalendarDayIsCompleted<
  T extends {
    item: PlannedExpenseCalendarAmountItem;
    skipped?: boolean;
    completed?: boolean;
  },
>(entries: T[]) {
  return (
    entries.length > 0 &&
    entries.every((entry) =>
      plannedExpenseCalendarEntryIsCompleted(
        entry.item,
        entry.skipped ?? false,
        entry.completed ?? false,
      ),
    )
  );
}

export function plannedExpenseCalendarDayIsSkipped<
  T extends {
    skipped?: boolean;
    completed?: boolean;
  },
>(entries: T[]) {
  return (
    entries.length > 0 &&
    entries.every((entry) => entry.skipped === true && entry.completed !== true)
  );
}

export function plannedExpenseCalendarDayHasCompleted<
  T extends {
    item: PlannedExpenseCalendarAmountItem;
    skipped?: boolean;
    completed?: boolean;
  },
>(entries: T[]) {
  return entries.some((entry) =>
    plannedExpenseCalendarEntryIsCompleted(
      entry.item,
      entry.skipped ?? false,
      entry.completed ?? false,
    ),
  );
}

export function plannedExpenseCalendarDayHasSkipped<
  T extends {
    skipped?: boolean;
    completed?: boolean;
  },
>(entries: T[]) {
  return entries.some(
    (entry) => entry.skipped === true && entry.completed !== true,
  );
}

export function plannedExpenseCalendarDayBackground<
  T extends {
    item: PlannedExpenseCalendarAmountItem;
    skipped?: boolean;
    completed?: boolean;
  },
>(entries: T[]): "completed" | "skipped" | null {
  if (plannedExpenseCalendarDayHasCompleted(entries)) return "completed";
  if (plannedExpenseCalendarDayIsSkipped(entries)) return "skipped";
  return null;
}

export function plannedExpenseCalendarEntryAmount<
  T extends {
    item: PlannedExpenseCalendarAmountItem;
    skipped?: boolean;
    completed?: boolean;
  },
>(entry: T) {
  return entry.completed
    ? 0
    : plannedExpenseCalendarAmount(entry.item, entry.skipped ?? false);
}

export function plannedExpenseSkippedDateList(
  value: string | null | undefined,
) {
  return Array.from(
    new Set(
      (value ?? "")
        .split(",")
        .map((date) => date.trim())
        .filter(isDateString),
    ),
  ).sort();
}

export function plannedExpenseAddSkippedDate(
  value: string | null | undefined,
  date: string,
) {
  if (!isDateString(date)) return value ?? null;
  const dates = plannedExpenseSkippedDateList(value);
  if (!dates.includes(date)) dates.push(date);
  const serialized = dates.sort().join(",");
  return serialized || null;
}

export function plannedExpenseRemoveSkippedDate(
  value: string | null | undefined,
  date: string,
) {
  const serialized = plannedExpenseSkippedDateList(value)
    .filter((currentDate) => currentDate !== date)
    .join(",");
  return serialized || null;
}

export function plannedExpenseCompletedDateList(
  value: string | null | undefined,
) {
  return plannedExpenseSkippedDateList(value);
}

export function plannedExpenseAddCompletedDate(
  value: string | null | undefined,
  date: string,
) {
  return plannedExpenseAddSkippedDate(value, date);
}

export function plannedExpenseRemoveCompletedDate(
  value: string | null | undefined,
  date: string,
) {
  return plannedExpenseRemoveSkippedDate(value, date);
}

function isDateString(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseDateParts(value: string) {
  return {
    year: Number(value.slice(0, 4)),
    month: Number(value.slice(5, 7)),
    day: Number(value.slice(8, 10)),
  };
}

function dateFromString(value: string) {
  const { year, month, day } = parseDateParts(value);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(date: Date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function addDays(value: string, days: number) {
  const date = dateFromString(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

function monthIndex(yearMonth: string) {
  return Number(yearMonth.slice(0, 4)) * 12 + Number(yearMonth.slice(5, 7)) - 1;
}

function yearMonthFromIndex(index: number) {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function normalizedInterval(item: PlannedExpenseCalendarItem) {
  const value = item.recurrence_interval ?? item.recurrence_interval_months ?? 1;
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function normalizedRecurrenceCount(item: PlannedExpenseCalendarItem) {
  return item.recurrence_count != null &&
    Number.isInteger(item.recurrence_count) &&
    item.recurrence_count > 0
    ? item.recurrence_count
    : null;
}

function selectedWeeks(value: string | null | undefined) {
  return Array.from(
    new Set(
      (value ?? "")
        .split(",")
        .map((week) => Number(week.trim()))
        .filter((week) => Number.isInteger(week) && week >= 1 && week <= 5),
    ),
  ).sort((a, b) => a - b);
}

function addDate(
  dates: Set<string>,
  date: string | null,
  anchorDate: string,
  rangeStart: string,
  rangeEnd: string,
  endDate: string | null,
) {
  if (!date) return;
  if (date < anchorDate) return;
  if (date < rangeStart || date > rangeEnd) return;
  if (endDate && date > endDate) return;
  dates.add(date);
}

function expandWeekly(
  item: PlannedExpenseCalendarItem,
  anchorDate: string,
  rangeStart: string,
  rangeEnd: string,
  endDate: string | null,
) {
  const dates = new Set<string>();
  const stepDays = normalizedInterval(item) * 7;
  let date = anchorDate;
  while (date < rangeStart) {
    date = addDays(date, stepDays);
  }
  while (date <= rangeEnd && (!endDate || date <= endDate)) {
    addDate(dates, date, anchorDate, rangeStart, rangeEnd, endDate);
    date = addDays(date, stepDays);
  }
  return dates;
}

function expandMonthly(
  item: PlannedExpenseCalendarItem,
  anchorDate: string,
  rangeStart: string,
  rangeEnd: string,
  endDate: string | null,
) {
  const dates = new Set<string>();
  const interval = normalizedInterval(item);
  const anchorMonthIndex = monthIndex(anchorDate.slice(0, 7));
  const rangeStartMonthIndex = monthIndex(rangeStart.slice(0, 7));
  const rangeEndMonthIndex = monthIndex(rangeEnd.slice(0, 7));
  const isWeekdayRule = item.recurrence_monthly_mode === "week_of_month";
  const searchStartMonthIndex = Math.max(
    anchorMonthIndex,
    rangeStartMonthIndex - (isWeekdayRule ? 1 : 0),
  );
  const offset = (searchStartMonthIndex - anchorMonthIndex) % interval;
  const firstMonthIndex =
    offset === 0 ? searchStartMonthIndex : searchStartMonthIndex + interval - offset;

  for (
    let currentMonthIndex = firstMonthIndex;
    currentMonthIndex <= rangeEndMonthIndex;
    currentMonthIndex += interval
  ) {
    const yearMonth = yearMonthFromIndex(currentMonthIndex);
    if (isWeekdayRule) {
      if (item.recurrence_weekday == null) continue;
      for (const week of selectedWeeks(item.recurrence_weeks_of_month)) {
        addDate(
          dates,
          resolvePlannedExpenseWeekdayInMonth({
            yearMonth,
            weekOfMonth: week,
            weekday: item.recurrence_weekday,
            fallback: normalizePlannedExpenseWeekFallback(
              item.recurrence_week_fallback,
            ),
          }),
          anchorDate,
          rangeStart,
          rangeEnd,
          endDate,
        );
      }
      continue;
    }

    const anchorDay = parseDateParts(anchorDate).day;
    const day = item.recurrence_day ?? anchorDay;
    const resolvedDay = resolveMonthlyPayday(yearMonth, day);
    addDate(
      dates,
      `${yearMonth}-${String(resolvedDay).padStart(2, "0")}`,
      anchorDate,
      rangeStart,
      rangeEnd,
      endDate,
    );
  }

  return dates;
}

function expandYearly(
  item: PlannedExpenseCalendarItem,
  anchorDate: string,
  rangeStart: string,
  rangeEnd: string,
  endDate: string | null,
) {
  const dates = new Set<string>();
  const interval = normalizedInterval(item);
  const anchor = parseDateParts(anchorDate);
  const startYear = Math.max(anchor.year, Number(rangeStart.slice(0, 4)));
  const endYear = Number(rangeEnd.slice(0, 4));
  const offset = (startYear - anchor.year) % interval;
  const firstYear = offset === 0 ? startYear : startYear + interval - offset;

  for (let year = firstYear; year <= endYear; year += interval) {
    const yearMonth = `${year}-${String(anchor.month).padStart(2, "0")}`;
    const resolvedDay = resolveMonthlyPayday(yearMonth, anchor.day);
    addDate(
      dates,
      `${yearMonth}-${String(resolvedDay).padStart(2, "0")}`,
      anchorDate,
      rangeStart,
      rangeEnd,
      endDate,
    );
  }

  return dates;
}

export function plannedExpenseCalendarDates(
  item: PlannedExpenseCalendarItem,
  rangeStart: string,
  rangeEnd: string,
): string[] {
  if (!isDateString(rangeStart) || !isDateString(rangeEnd) || rangeEnd < rangeStart) {
    return [];
  }

  if (item.kind === "shopping_list") {
    const date = item.category_target_date;
    return isDateString(date) && date >= rangeStart && date <= rangeEnd ? [date] : [];
  }

  if (item.recurrence_type !== "recurring") {
    const date = item.target_date;
    return isDateString(date) && date >= rangeStart && date <= rangeEnd ? [date] : [];
  }

  const currentAnchorDate = item.next_due_date ?? item.target_date;
  if (!isDateString(currentAnchorDate)) return [];
  const recurrenceCount = normalizedRecurrenceCount(item);
  const anchorDate = recurrenceCount == null
    ? currentAnchorDate
    : recurrenceScheduleAnchor(
        item,
        plannedExpenseCompletedDateList(item.completed_dates),
      ) ?? currentAnchorDate;
  const endDate = isDateString(item.end_date) ? item.end_date : null;
  if (endDate && endDate < rangeStart) return [];

  const unit = item.recurrence_unit ?? "month";
  if (recurrenceCount != null) {
    const boundedDates =
      unit === "week"
        ? expandWeekly(item, anchorDate, anchorDate, rangeEnd, endDate)
        : unit === "year"
          ? expandYearly(item, anchorDate, anchorDate, rangeEnd, endDate)
          : expandMonthly(item, anchorDate, anchorDate, rangeEnd, endDate);

    return [...boundedDates]
      .sort()
      .slice(0, recurrenceCount)
      .filter((date) => date >= rangeStart && date <= rangeEnd);
  }

  const dates =
    unit === "week"
      ? expandWeekly(item, anchorDate, rangeStart, rangeEnd, endDate)
      : unit === "year"
        ? expandYearly(item, anchorDate, rangeStart, rangeEnd, endDate)
        : expandMonthly(item, anchorDate, rangeStart, rangeEnd, endDate);

  return [...dates].sort();
}

export function plannedExpenseCalendarOccurrences(
  item: PlannedExpenseCalendarItem,
  rangeStart: string,
  rangeEnd: string,
): PlannedExpenseCalendarOccurrence[] {
  if (!isDateString(rangeStart) || !isDateString(rangeEnd) || rangeEnd < rangeStart) {
    return [];
  }

  if (item.kind === "shopping_list") {
    const date = item.category_target_date;
    return isDateString(date) && date >= rangeStart && date <= rangeEnd
      ? [{ date, occurrenceNumber: 1 }]
      : [];
  }

  if (item.recurrence_type !== "recurring") {
    const date = item.target_date;
    return isDateString(date) && date >= rangeStart && date <= rangeEnd
      ? [{ date, occurrenceNumber: 1 }]
      : [];
  }

  const anchorDate = item.next_due_date ?? item.target_date;
  if (!isDateString(anchorDate)) return [];

  return plannedExpenseCalendarDates(item, anchorDate, rangeEnd)
    .map((date, index) => ({ date, occurrenceNumber: index + 1 }))
    .filter(({ date }) => date >= rangeStart && date <= rangeEnd);
}

export function plannedExpenseCalendarCompletedOccurrences(
  _item: PlannedExpenseCalendarItem,
  _rangeStart: string,
  _rangeEnd: string,
): PlannedExpenseCalendarOccurrence[] {
  return [];
}

export function plannedExpenseNextOccurrenceDate(
  item: PlannedExpenseCalendarItem,
  afterDate: string,
): string | null {
  if (!isDateString(afterDate) || item.recurrence_type !== "recurring") {
    return null;
  }

  const searchStart = addDays(afterDate, 1);
  const searchEnd = isDateString(item.end_date)
    ? item.end_date
    : `${Number(afterDate.slice(0, 4)) + 10}-${afterDate.slice(5, 10)}`;
  if (searchEnd < searchStart) return null;

  return plannedExpenseCalendarDates(item, searchStart, searchEnd)[0] ?? null;
}

export type PlannedExpenseOccurrenceCompletionUpdates = {
  completed_dates: string | null;
  next_due_date: string | null;
  status: "open" | "completed";
};

function recurrenceScheduleAnchor(
  item: PlannedExpenseCalendarItem,
  completedDates: string[],
) {
  return [
    item.next_due_date,
    ...completedDates,
    ...plannedExpenseSkippedDateList(item.skipped_dates),
  ]
    .filter(isDateString)
    .sort()[0] ?? null;
}

function finiteRecurrenceSearchEnd(
  item: PlannedExpenseCalendarItem,
  anchorDate: string,
) {
  if (isDateString(item.end_date)) return item.end_date;

  const count = normalizedRecurrenceCount(item);
  if (count == null) return null;

  const interval = normalizedInterval(item);
  if (item.recurrence_unit === "week") {
    return addDays(anchorDate, count * interval * 7 + 7);
  }
  if (item.recurrence_unit === "year") {
    return `${parseDateParts(anchorDate).year + count * interval + 1}-12-31`;
  }

  // A fifth-weekday rule can skip many months, so leave a full year per count.
  const endMonthIndex = monthIndex(anchorDate.slice(0, 7)) + count * interval * 12 + 12;
  return `${yearMonthFromIndex(endMonthIndex)}-31`;
}

export function plannedExpenseCompleteOccurrenceUpdates(
  item: PlannedExpenseCalendarItem,
  occurrenceDate: string,
): PlannedExpenseOccurrenceCompletionUpdates {
  const completedDates = plannedExpenseCompletedDateList(
    plannedExpenseAddCompletedDate(item.completed_dates, occurrenceDate),
  );
  const completed_dates = completedDates.join(",") || null;

  if (item.recurrence_type !== "recurring" || !isDateString(occurrenceDate)) {
    return { completed_dates, next_due_date: null, status: "completed" };
  }

  const anchorDate = recurrenceScheduleAnchor(item, completedDates);
  if (!anchorDate) {
    return { completed_dates, next_due_date: null, status: "open" };
  }

  const resolvedDates = new Set([
    ...completedDates,
    ...plannedExpenseSkippedDateList(item.skipped_dates),
  ]);
  const searchEnd = finiteRecurrenceSearchEnd(item, anchorDate);

  if (searchEnd) {
    const scheduledDates = plannedExpenseCalendarDates(
      { ...item, next_due_date: anchorDate },
      anchorDate,
      searchEnd,
    );
    const nextDueDate = scheduledDates.find((date) => !resolvedDates.has(date)) ?? null;
    return {
      completed_dates,
      next_due_date: nextDueDate,
      status: scheduledDates.length > 0 && nextDueDate == null ? "completed" : "open",
    };
  }

  let nextDueDate = isDateString(item.next_due_date)
    ? item.next_due_date
    : anchorDate;
  while (resolvedDates.has(nextDueDate)) {
    const followingDate = plannedExpenseNextOccurrenceDate(
      { ...item, next_due_date: nextDueDate, recurrence_count: null },
      nextDueDate,
    );
    if (!followingDate) break;
    nextDueDate = followingDate;
  }

  return { completed_dates, next_due_date: nextDueDate, status: "open" };
}
