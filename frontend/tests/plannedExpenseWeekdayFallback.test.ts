import { describe, expect, test } from "bun:test";

import {
  resolvePlannedExpenseWeekdayInMonth,
  resolvePlannedExpenseWeekdayRuleDate,
} from "@balance-sheet/shared";

describe("planned expense nth-weekday fallback", () => {
  test("returns the nth weekday when it exists in the target month", () => {
    expect(
      resolvePlannedExpenseWeekdayInMonth({
        yearMonth: "2026-05",
        weekOfMonth: 5,
        weekday: 5,
        fallback: "skip",
      }),
    ).toBe("2026-05-29");
  });

  test("can skip a missing fifth weekday", () => {
    expect(
      resolvePlannedExpenseWeekdayInMonth({
        yearMonth: "2026-02",
        weekOfMonth: 5,
        weekday: 5,
        fallback: "skip",
      }),
    ).toBeNull();
  });

  test("can fall back to the closest same-month month end", () => {
    expect(
      resolvePlannedExpenseWeekdayInMonth({
        yearMonth: "2026-02",
        weekOfMonth: 5,
        weekday: 5,
        fallback: "last_day_of_month",
      }),
    ).toBe("2026-02-28");
  });

  test("can fall back to the previous week", () => {
    expect(
      resolvePlannedExpenseWeekdayInMonth({
        yearMonth: "2026-02",
        weekOfMonth: 5,
        weekday: 5,
        fallback: "previous_week",
      }),
    ).toBe("2026-02-27");
  });

  test("can fall back to the first matching weekday of the next month", () => {
    expect(
      resolvePlannedExpenseWeekdayInMonth({
        yearMonth: "2026-02",
        weekOfMonth: 5,
        weekday: 5,
        fallback: "next_month_first_week",
      }),
    ).toBe("2026-03-06");
  });

  test("uses the earliest resolved date for multi-week monthly rules", () => {
    expect(
      resolvePlannedExpenseWeekdayRuleDate({
        date: "2026-02-10",
        weeksOfMonth: "2,5",
        weekday: 5,
        fallback: "previous_week",
      }),
    ).toBe("2026-02-13");
  });
});
