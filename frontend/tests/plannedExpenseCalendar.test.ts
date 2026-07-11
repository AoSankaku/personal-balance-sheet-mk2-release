import { describe, expect, test } from "bun:test";

import {
  plannedExpenseAddSkippedDate,
  plannedExpenseAddCompletedDate,
  plannedExpenseCalendarAmount,
  plannedExpenseCalendarDayBackground,
  plannedExpenseCalendarCompletedOccurrences,
  plannedExpenseCalendarDates,
  plannedExpenseCalendarDayIsCompleted,
  plannedExpenseCalendarDayIsSkipped,
  plannedExpenseCalendarEntryAmount,
  plannedExpenseCalendarShouldShowStatus,
  plannedExpenseCompleteOccurrenceUpdates,
  plannedExpenseRemoveCompletedDate,
  plannedExpenseRemoveSkippedDate,
  plannedExpenseNextOccurrenceDate,
  plannedExpenseCalendarOccurrences,
  plannedExpenseCompletedDateList,
  type PlannedExpenseCalendarItem,
} from "../src/lib/plannedExpenseCalendar";

function item(
  overrides: Partial<PlannedExpenseCalendarItem>,
): PlannedExpenseCalendarItem {
  return {
    kind: "scheduled_payment",
    target_date: null,
    category_target_date: null,
    recurrence_type: "recurring",
    recurrence_interval: 1,
    recurrence_unit: "month",
    recurrence_monthly_mode: "day_of_month",
    recurrence_interval_months: null,
    recurrence_day: null,
    recurrence_weeks_of_month: null,
    recurrence_weekday: null,
    recurrence_week_fallback: "previous_week",
    next_due_date: "2026-07-31",
    end_date: null,
    recurrence_count: null,
    skipped_dates: null,
    completed_dates: null,
    ...overrides,
  };
}

describe("planned expense calendar virtual recurrence expansion", () => {
  test("expands monthly day-of-month rules and clamps missing days", () => {
    expect(
      plannedExpenseCalendarDates(
        item({ recurrence_day: 31 }),
        "2026-08-01",
        "2026-09-30",
      ),
    ).toEqual(["2026-08-31", "2026-09-30"]);
  });

  test("expands every selected nth weekday in a monthly rule", () => {
    expect(
      plannedExpenseCalendarDates(
        item({
          recurrence_monthly_mode: "week_of_month",
          recurrence_weeks_of_month: "2,4",
          recurrence_weekday: 3,
          next_due_date: "2026-07-08",
        }),
        "2026-08-01",
        "2026-08-31",
      ),
    ).toEqual(["2026-08-12", "2026-08-26"]);
  });

  test("applies fifth-weekday fallback choices during expansion", () => {
    const fifthFriday = item({
      recurrence_monthly_mode: "week_of_month",
      recurrence_weeks_of_month: "5",
      recurrence_weekday: 5,
      next_due_date: "2026-01-30",
    });

    expect(
      plannedExpenseCalendarDates(
        { ...fifthFriday, recurrence_week_fallback: "previous_week" },
        "2026-02-01",
        "2026-02-28",
      ),
    ).toEqual(["2026-02-27"]);

    expect(
      plannedExpenseCalendarDates(
        { ...fifthFriday, recurrence_week_fallback: "skip" },
        "2026-02-01",
        "2026-02-28",
      ),
    ).toEqual([]);
  });

  test("expands weekly rules by the configured interval", () => {
    expect(
      plannedExpenseCalendarDates(
        item({
          recurrence_interval: 2,
          recurrence_unit: "week",
          next_due_date: "2026-07-03",
        }),
        "2026-07-10",
        "2026-07-31",
      ),
    ).toEqual(["2026-07-17", "2026-07-31"]);
  });

  test("does not expand beyond the recurrence end date", () => {
    expect(
      plannedExpenseCalendarDates(
        item({ recurrence_day: 15, next_due_date: "2026-07-15", end_date: "2026-08-20" }),
        "2026-07-01",
        "2026-09-30",
      ),
    ).toEqual(["2026-07-15", "2026-08-15"]);
  });

  test("does not expand beyond the final occurrence count", () => {
    const limited = item({
      recurrence_day: 15,
      next_due_date: "2026-07-15",
      recurrence_count: 3,
    });

    expect(
      plannedExpenseCalendarOccurrences(limited, "2026-07-01", "2026-12-31"),
    ).toEqual([
      { date: "2026-07-15", occurrenceNumber: 1 },
      { date: "2026-08-15", occurrenceNumber: 2 },
      { date: "2026-09-15", occurrenceNumber: 3 },
    ]);
    expect(
      plannedExpenseCalendarDates(limited, "2026-10-01", "2026-12-31"),
    ).toEqual([]);
  });

  test("does not move the final occurrence when the next due date advances", () => {
    expect(
      plannedExpenseCalendarDates(
        item({
          recurrence_day: 15,
          next_due_date: "2026-08-15",
          recurrence_count: 3,
          completed_dates: "2026-07-15",
        }),
        "2026-08-01",
        "2026-12-31",
      ),
    ).toEqual(["2026-08-15", "2026-09-15"]);
  });

  test("expands yearly rules from the anchored month and clamps leap day", () => {
    expect(
      plannedExpenseCalendarDates(
        item({
          recurrence_unit: "year",
          next_due_date: "2024-02-29",
        }),
        "2025-01-01",
        "2026-12-31",
      ),
    ).toEqual(["2025-02-28", "2026-02-28"]);
  });

  test("returns occurrence numbers for detail views", () => {
    expect(
      plannedExpenseCalendarOccurrences(
        item({
          recurrence_monthly_mode: "week_of_month",
          recurrence_weeks_of_month: "2,4",
          recurrence_weekday: 3,
          next_due_date: "2026-07-08",
        }),
        "2026-08-01",
        "2026-08-31",
      ),
    ).toEqual([
      { date: "2026-08-12", occurrenceNumber: 3 },
      { date: "2026-08-26", occurrenceNumber: 4 },
    ]);
  });

  test("counts only scheduled occurrences when a fifth weekday is skipped", () => {
    expect(
      plannedExpenseCalendarOccurrences(
        item({
          recurrence_monthly_mode: "week_of_month",
          recurrence_weeks_of_month: "5",
          recurrence_weekday: 5,
          recurrence_week_fallback: "skip",
          next_due_date: "2026-01-30",
        }),
        "2026-03-01",
        "2026-05-31",
      ),
    ).toEqual([{ date: "2026-05-29", occurrenceNumber: 2 }]);
  });

  test("finds the next occurrence after a selected payment date", () => {
    expect(
      plannedExpenseNextOccurrenceDate(
        item({ recurrence_day: 31 }),
        "2026-08-31",
      ),
    ).toBe("2026-09-30");
  });

  test("returns null when there is no next occurrence after the end date", () => {
    expect(
      plannedExpenseNextOccurrenceDate(
        item({
          recurrence_day: 15,
          next_due_date: "2026-07-15",
          end_date: "2026-08-20",
        }),
        "2026-08-15",
      ),
    ).toBeNull();
  });

  test("keeps a fixed recurrence open when only its final occurrence is completed", () => {
    expect(
      plannedExpenseCompleteOccurrenceUpdates(
        item({
          recurrence_day: 15,
          next_due_date: "2026-07-15",
          recurrence_count: 3,
        }),
        "2026-09-15",
      ),
    ).toEqual({
      completed_dates: "2026-09-15",
      next_due_date: "2026-07-15",
      status: "open",
    });
  });

  test("completes a fixed recurrence only after every occurrence is resolved", () => {
    expect(
      plannedExpenseCompleteOccurrenceUpdates(
        item({
          recurrence_day: 15,
          next_due_date: "2026-08-15",
          recurrence_count: 3,
          completed_dates: "2026-07-15,2026-09-15",
        }),
        "2026-08-15",
      ),
    ).toEqual({
      completed_dates: "2026-07-15,2026-08-15,2026-09-15",
      next_due_date: null,
      status: "completed",
    });
  });

  test("treats skipped occurrences as resolved when completing a fixed recurrence", () => {
    expect(
      plannedExpenseCompleteOccurrenceUpdates(
        item({
          recurrence_day: 15,
          next_due_date: "2026-09-15",
          recurrence_count: 3,
          completed_dates: "2026-07-15",
          skipped_dates: "2026-08-15",
        }),
        "2026-09-15",
      ),
    ).toEqual({
      completed_dates: "2026-07-15,2026-09-15",
      next_due_date: null,
      status: "completed",
    });
  });

  test("keeps an end-dated recurrence open while earlier occurrences remain unresolved", () => {
    expect(
      plannedExpenseCompleteOccurrenceUpdates(
        item({
          recurrence_day: 15,
          next_due_date: "2026-07-15",
          end_date: "2026-09-20",
        }),
        "2026-09-15",
      ),
    ).toEqual({
      completed_dates: "2026-09-15",
      next_due_date: "2026-07-15",
      status: "open",
    });
  });

  test("keeps the earliest unresolved date when a future ongoing occurrence is completed", () => {
    expect(
      plannedExpenseCompleteOccurrenceUpdates(
        item({
          recurrence_day: 15,
          next_due_date: "2026-07-15",
        }),
        "2026-09-15",
      ),
    ).toEqual({
      completed_dates: "2026-09-15",
      next_due_date: "2026-07-15",
      status: "open",
    });
  });

  test("does not infer completed history from the next due date", () => {
    expect(
      plannedExpenseCalendarCompletedOccurrences(
        item({
          target_date: "2026-07-31",
          next_due_date: "2026-09-30",
          recurrence_day: 31,
        }),
        "2026-07-01",
        "2026-09-30",
      ),
    ).toEqual([]);
    expect(
      plannedExpenseCalendarCompletedOccurrences(
        item({
          target_date: null,
          next_due_date: "2026-09-06",
          recurrence_day: 6,
        }),
        "2026-08-01",
        "2026-08-31",
      ),
    ).toEqual([]);
  });

  test("uses persisted completed dates as completed calendar entries", () => {
    expect(plannedExpenseCompletedDateList("2026-08-06, 2026-08-06")).toEqual([
      "2026-08-06",
    ]);
    expect(plannedExpenseAddCompletedDate(null, "2026-08-06")).toBe(
      "2026-08-06",
    );
    expect(
      plannedExpenseAddCompletedDate("2026-09-06", "2026-08-06"),
    ).toBe("2026-08-06,2026-09-06");
    expect(
      plannedExpenseRemoveCompletedDate(
        "2026-08-06,2026-09-06",
        "2026-08-06",
      ),
    ).toBe("2026-09-06");
  });

  test("keeps cancelled and completed payments visible as zero amount calendar entries", () => {
    expect(plannedExpenseCalendarShouldShowStatus("open")).toBe(true);
    expect(plannedExpenseCalendarShouldShowStatus("cancelled")).toBe(true);
    expect(plannedExpenseCalendarShouldShowStatus("completed")).toBe(true);
    expect(
      plannedExpenseCalendarAmount({
        status: "cancelled",
        estimated_amount: 123456,
      }),
    ).toBe(0);
    expect(
      plannedExpenseCalendarAmount({
        status: "open",
        estimated_amount: 123456,
      }),
    ).toBe(123456);
    expect(
      plannedExpenseCalendarAmount({
        status: "open",
        estimated_amount: 123456,
      }, true),
    ).toBe(0);
    expect(
      plannedExpenseCalendarAmount({
        status: "completed",
        estimated_amount: 123456,
      }),
    ).toBe(0);
    expect(
      plannedExpenseCalendarDayIsCompleted([
        { item: { status: "completed", estimated_amount: 123456 }, skipped: false },
      ]),
    ).toBe(true);
    expect(
      plannedExpenseCalendarDayIsCompleted([
        { item: { status: "completed", estimated_amount: 123456 }, skipped: false },
        { item: { status: "open", estimated_amount: 5000 }, skipped: false },
      ]),
    ).toBe(false);
    expect(
      plannedExpenseCalendarDayIsCompleted([
        { item: { status: "completed", estimated_amount: 123456 }, skipped: true },
      ]),
    ).toBe(false);
    expect(
      plannedExpenseCalendarDayIsCompleted([
        {
          item: { status: "open", estimated_amount: 123456 },
          skipped: false,
          completed: true,
        },
      ]),
    ).toBe(true);
    expect(
      plannedExpenseCalendarEntryAmount({
        item: { status: "open", estimated_amount: 123456 },
        skipped: false,
        completed: true,
      }),
    ).toBe(0);
    expect(
      plannedExpenseCalendarDayIsSkipped([
        { item: { status: "open", estimated_amount: 123456 }, skipped: true },
      ]),
    ).toBe(true);
    expect(
      plannedExpenseCalendarDayIsSkipped([
        { item: { status: "open", estimated_amount: 123456 }, skipped: true },
        { item: { status: "open", estimated_amount: 5000 }, skipped: false },
      ]),
    ).toBe(false);
    expect(
      plannedExpenseCalendarDayIsSkipped([
        {
          item: { status: "open", estimated_amount: 123456 },
          skipped: true,
          completed: true,
        },
      ]),
    ).toBe(false);
    expect(
      plannedExpenseCalendarDayBackground([
        {
          item: { status: "open", estimated_amount: 123456 },
          skipped: false,
          completed: true,
        },
        {
          item: { status: "open", estimated_amount: 5000 },
          skipped: true,
          completed: false,
        },
      ]),
    ).toBe("completed");
    expect(
      plannedExpenseCalendarDayBackground([
        { item: { status: "open", estimated_amount: 123456 }, skipped: true },
      ]),
    ).toBe("skipped");
    expect(plannedExpenseAddSkippedDate(null, "2026-07-31")).toBe(
      "2026-07-31",
    );
    expect(
      plannedExpenseAddSkippedDate("2026-08-31", "2026-07-31"),
    ).toBe("2026-07-31,2026-08-31");
    expect(
      plannedExpenseRemoveSkippedDate(
        "2026-07-31,2026-08-31",
        "2026-07-31",
      ),
    ).toBe("2026-08-31");
  });
});
