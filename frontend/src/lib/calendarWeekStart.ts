import type dayjs from "dayjs";
import type { CalendarWeekStart } from "@balance-sheet/shared";

export const calendarWeekdayTranslationKeys = [
  "weekday_short_0",
  "weekday_short_1",
  "weekday_short_2",
  "weekday_short_3",
  "weekday_short_4",
  "weekday_short_5",
  "weekday_short_6",
] as const;

export type CalendarWeekdayTranslationKey =
  (typeof calendarWeekdayTranslationKeys)[number];

export function normalizeCalendarWeekStart(
  value: unknown,
): CalendarWeekStart {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 &&
    value <= 6
    ? (value as CalendarWeekStart)
    : 0;
}

export function startOfCalendarWeek(
  date: dayjs.Dayjs,
  weekStart: unknown,
): dayjs.Dayjs {
  const normalizedWeekStart = normalizeCalendarWeekStart(weekStart);
  const daysSinceWeekStart = (date.day() - normalizedWeekStart + 7) % 7;
  return date.subtract(daysSinceWeekStart, "day").startOf("day");
}

export function calendarWeekdayKeys(
  weekStart: unknown,
): CalendarWeekdayTranslationKey[] {
  const normalizedWeekStart = normalizeCalendarWeekStart(weekStart);
  return Array.from(
    { length: 7 },
    (_, index) =>
      calendarWeekdayTranslationKeys[(normalizedWeekStart + index) % 7]!,
  );
}

export function calendarWeekdayColor(weekday: unknown): "red.6" | "blue.6" | "dimmed" {
  if (weekday === 0) return "red.6";
  if (weekday === 6) return "blue.6";
  return "dimmed";
}

export function isCalendarToday(
  dateKey: string,
  todayKey: string,
): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && dateKey === todayKey;
}

export function calendarGridLayout(isCompact: boolean) {
  return isCompact
    ? {
        calendarPadding: 0,
        cellMinHeight: 44,
        cellPadding: 0,
        gridGap: 0,
        amountMarginInline: -1,
        amountTextAlign: "center" as const,
        itemTextAlign: "center" as const,
        showItemNames: false,
      }
    : {
        calendarPadding: "md",
        cellMinHeight: 72,
        cellPadding: 6,
        gridGap: 4,
        amountMarginInline: 0,
        amountTextAlign: "right" as const,
        itemTextAlign: "right" as const,
        showItemNames: true,
      };
}
