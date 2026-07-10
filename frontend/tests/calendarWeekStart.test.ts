import { describe, expect, test } from "bun:test";
import dayjs from "dayjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  calendarGridLayout,
  calendarWeekdayColor,
  calendarWeekdayKeys,
  isCalendarToday,
  normalizeCalendarWeekStart,
  startOfCalendarWeek,
} from "../src/lib/calendarWeekStart";

const frontendDir = join(import.meta.dir, "..");

function readSource(path: string) {
  return readFileSync(join(frontendDir, path), "utf8");
}

describe("calendar week start", () => {
  test("defaults invalid settings to Sunday", () => {
    expect(normalizeCalendarWeekStart(null)).toBe(0);
    expect(normalizeCalendarWeekStart(undefined)).toBe(0);
    expect(normalizeCalendarWeekStart(-1)).toBe(0);
    expect(normalizeCalendarWeekStart(7)).toBe(0);
    expect(normalizeCalendarWeekStart(1)).toBe(1);
  });

  test("calculates calendar grid start from the configured weekday", () => {
    const date = dayjs("2026-07-01");

    expect(startOfCalendarWeek(date, 0).format("YYYY-MM-DD")).toBe(
      "2026-06-28",
    );
    expect(startOfCalendarWeek(date, 1).format("YYYY-MM-DD")).toBe(
      "2026-06-29",
    );
    expect(startOfCalendarWeek(date, 3).format("YYYY-MM-DD")).toBe(
      "2026-07-01",
    );
  });

  test("orders weekday header keys from the configured week start", () => {
    expect(calendarWeekdayKeys(0)).toEqual([
      "weekday_short_0",
      "weekday_short_1",
      "weekday_short_2",
      "weekday_short_3",
      "weekday_short_4",
      "weekday_short_5",
      "weekday_short_6",
    ]);
    expect(calendarWeekdayKeys(1)).toEqual([
      "weekday_short_1",
      "weekday_short_2",
      "weekday_short_3",
      "weekday_short_4",
      "weekday_short_5",
      "weekday_short_6",
      "weekday_short_0",
    ]);
  });

  test("colors Sundays and Saturdays consistently", () => {
    expect(calendarWeekdayColor(0)).toBe("red.6");
    expect(calendarWeekdayColor(6)).toBe("blue.6");
    expect(calendarWeekdayColor(1)).toBe("dimmed");
    expect(calendarWeekdayColor(99)).toBe("dimmed");
  });

  test("identifies the currently viewed date cell for highlighting", () => {
    expect(isCalendarToday("2026-07-04", "2026-07-04")).toBe(true);
    expect(isCalendarToday("2026-07-03", "2026-07-04")).toBe(false);
    expect(isCalendarToday("invalid", "2026-07-04")).toBe(false);
  });

  test("uses tighter calendar spacing on compact screens", () => {
    expect(calendarGridLayout(true)).toEqual({
      calendarPadding: 0,
      cellMinHeight: 44,
      cellPadding: 0,
      gridGap: 0,
      amountMarginInline: -1,
      amountTextAlign: "center",
      itemTextAlign: "center",
      showItemNames: false,
    });
    expect(calendarGridLayout(false)).toEqual({
      calendarPadding: "md",
      cellMinHeight: 72,
      cellPadding: 6,
      gridGap: 4,
      amountMarginInline: 0,
      amountTextAlign: "right",
      itemTextAlign: "right",
      showItemNames: true,
    });
  });

  test("wraps Mantine date pickers with the persisted first-day setting", () => {
    const appSource = readSource("src/App.tsx");

    expect(appSource).toContain("DatesProvider");
    expect(appSource).toContain("firstDayOfWeek: calendarWeekStart");
  });

  test("uses the same setting for the scheduled-payment calendar grid", () => {
    const pageSource = readSource("src/pages/PlannedExpensePage.tsx");

    expect(pageSource).toContain("calendarWeekStart");
    expect(pageSource).toContain("startOfCalendarWeek");
    expect(pageSource).toContain("calendarWeekdayKeys");
  });

  test("offers a today button that returns the scheduled-payment calendar to the current month", () => {
    const pageSource = readSource("src/pages/PlannedExpensePage.tsx");

    expect(pageSource).toContain('t("calendarTodayButton")');
    expect(pageSource).toContain('setCalendarMonth(dayjs().startOf("month"))');
  });
});
