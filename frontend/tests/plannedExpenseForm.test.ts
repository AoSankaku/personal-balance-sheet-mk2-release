import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  plannedExpenseActionRequiresConfirmation,
  plannedExpenseDayOfMonthSelectOptions,
  plannedExpenseMonthlyDueDateFromDay,
  mergePlannedExpenseListsById,
  plannedExpenseItemNameLineClamp,
  plannedExpenseCategorySelectValue,
  plannedExpenseCompletionFeedbackKey,
  plannedExpenseCompletedScheduledGroups,
  plannedExpenseApplyScheduledSkipPolicy,
  plannedExpenseRecurrenceFinalOccurrenceDate,
  plannedExpenseRecurrencePlannedCount,
  shouldShowScheduledItemInCompletedOneTimeList,
  shouldShowScheduledItemInMainList,
  parsePlannedExpenseWeeksOfMonth,
  serializePlannedExpenseWeeksOfMonth,
  shouldShowCompletedWishlistAmountTotal,
  shouldShowWishlistItemInCompletedList,
  shouldShowWishlistItemInMainList,
  shouldShowPlannedExpenseStatusField,
} from "../src/lib/plannedExpenseForm";

describe("planned expense form helpers", () => {
  test("preselects a category when opening item creation from a category header", () => {
    expect(plannedExpenseCategorySelectValue(42)).toBe("42");
  });

  test("keeps the category blank when no category is specified", () => {
    expect(plannedExpenseCategorySelectValue(null)).toBeNull();
    expect(plannedExpenseCategorySelectValue(undefined)).toBeNull();
  });

  test("hides the status field when creating a planned expense item", () => {
    expect(shouldShowPlannedExpenseStatusField(null)).toBe(false);
    expect(shouldShowPlannedExpenseStatusField(undefined)).toBe(false);
  });

  test("shows the status field when editing an existing planned expense item", () => {
    expect(shouldShowPlannedExpenseStatusField({ id: 1 })).toBe(true);
  });

  test("allows item names to use two lines in dense mobile layouts", () => {
    expect(plannedExpenseItemNameLineClamp()).toBe(2);
  });

  test("keeps completed and cancelled wishlist items out of the main list", () => {
    expect(shouldShowWishlistItemInMainList({ status: "open" })).toBe(true);
    expect(shouldShowWishlistItemInMainList({ status: "cancelled" })).toBe(false);
    expect(shouldShowWishlistItemInMainList({ status: "completed" })).toBe(false);
  });

  test("shows completed and cancelled wishlist items in the completed accordion", () => {
    expect(shouldShowWishlistItemInCompletedList({ status: "open" })).toBe(false);
    expect(shouldShowWishlistItemInCompletedList({ status: "cancelled" })).toBe(true);
    expect(shouldShowWishlistItemInCompletedList({ status: "completed" })).toBe(true);
  });

  test("does not show amount totals for completed and cancelled wishlist groups", () => {
    expect(shouldShowCompletedWishlistAmountTotal()).toBe(false);
  });

  test("deduplicates planned expense lists fetched by overlapping status filters", () => {
    expect(
      mergePlannedExpenseListsById(
        [
          { id: 1, status: "completed", name: "fff" },
          { id: 2, status: "open", name: "rent" },
        ],
        [{ id: 1, status: "completed", name: "fff" }],
      ),
    ).toEqual([
      { id: 1, status: "completed", name: "fff" },
      { id: 2, status: "open", name: "rent" },
    ]);
  });

  test("moves completed one-time scheduled payments out of the main list", () => {
    const completedOneTime = {
      kind: "scheduled_payment",
      recurrence_type: "one_time",
      status: "completed",
    };
    const completedRecurring = {
      kind: "scheduled_payment",
      recurrence_type: "recurring",
      status: "completed",
    };

    expect(shouldShowScheduledItemInMainList(completedOneTime)).toBe(false);
    expect(shouldShowScheduledItemInCompletedOneTimeList(completedOneTime)).toBe(
      true,
    );
    expect(shouldShowScheduledItemInMainList(completedRecurring)).toBe(true);
    expect(
      shouldShowScheduledItemInCompletedOneTimeList(completedRecurring),
    ).toBe(false);
  });

  test("groups completed scheduled payments by recent completion and reached limits", () => {
    const items = [
      {
        id: 1,
        kind: "scheduled_payment",
        recurrence_type: "one_time",
        status: "completed",
        target_date: "2026-07-01",
        updated_at: "2026-07-03T00:00:00.000Z",
      },
      {
        id: 2,
        kind: "scheduled_payment",
        recurrence_type: "recurring",
        status: "open",
        end_date: "2026-07-02",
      },
      {
        id: 3,
        kind: "scheduled_payment",
        recurrence_type: "recurring",
        status: "open",
        next_due_date: "2026-06-01",
        recurrence_count: 2,
      },
      {
        id: 4,
        kind: "scheduled_payment",
        recurrence_type: "recurring",
        status: "completed",
        updated_at: "2026-07-04T00:00:00.000Z",
      },
    ];

    expect(
      plannedExpenseCompletedScheduledGroups(items, "2026-07-05").map(
        (group) => ({
          reason: group.reason,
          ids: group.items.map(({ item }) => item.id),
          dates: group.items.map(({ completedAt }) => completedAt),
        }),
      ),
    ).toEqual([
      {
        reason: "completed",
        ids: [4, 1],
        dates: ["2026-07-04", "2026-07-03"],
      },
      {
        reason: "end_date",
        ids: [2],
        dates: ["2026-07-02"],
      },
      {
        reason: "final_occurrence",
        ids: [3],
        dates: ["2026-07-01"],
      },
    ]);
  });

  test("limits each completed scheduled payment group to ten items", () => {
    const items = Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      kind: "scheduled_payment",
      recurrence_type: "one_time",
      status: "completed",
      target_date: null,
      updated_at: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    }));

    const [group] = plannedExpenseCompletedScheduledGroups(items, "2026-07-31");

    expect(group.items).toHaveLength(10);
    expect(group.items.map(({ item }) => item.id)).toEqual([
      12, 11, 10, 9, 8, 7, 6, 5, 4, 3,
    ]);
  });

  test("previews planned occurrence count from an end date", () => {
    expect(
      plannedExpenseRecurrencePlannedCount({
        kind: "scheduled_payment",
        recurrence_type: "recurring",
        recurrence_interval: 1,
        recurrence_unit: "month",
        recurrence_monthly_mode: "day_of_month",
        recurrence_day: 15,
        next_due_date: "2026-07-15",
        end_date: "2026-09-10",
      }),
    ).toBe(2);
  });

  test("previews final occurrence date from a planned count", () => {
    expect(
      plannedExpenseRecurrenceFinalOccurrenceDate({
        kind: "scheduled_payment",
        recurrence_type: "recurring",
        recurrence_interval: 1,
        recurrence_unit: "month",
        recurrence_monthly_mode: "day_of_month",
        recurrence_day: 31,
        next_due_date: "2026-07-31",
        recurrence_count: 3,
      }),
    ).toBe("2026-09-30");
  });

  test("applies skip policy by postponing a final occurrence count", () => {
    expect(
      plannedExpenseApplyScheduledSkipPolicy(
        {
          kind: "scheduled_payment",
          recurrence_type: "recurring",
          recurrence_interval: 1,
          recurrence_unit: "month",
          recurrence_monthly_mode: "day_of_month",
          recurrence_day: 1,
          next_due_date: "2026-01-01",
          recurrence_count: 5,
          skipped_dates: null,
          completed_dates: "2026-01-01,2026-02-01",
        },
        "2026-03-01",
        "postpone",
      ),
    ).toEqual({
      skipped_dates: "2026-03-01",
      recurrence_count: 6,
    });
  });

  test("applies skip policy by extending the end date to the next occurrence", () => {
    expect(
      plannedExpenseApplyScheduledSkipPolicy(
        {
          kind: "scheduled_payment",
          recurrence_type: "recurring",
          recurrence_interval: 1,
          recurrence_unit: "month",
          recurrence_monthly_mode: "day_of_month",
          recurrence_day: 31,
          next_due_date: "2026-07-31",
          end_date: "2026-09-15",
          skipped_dates: null,
        },
        "2026-08-31",
        "postpone",
      ),
    ).toEqual({
      skipped_dates: "2026-08-31",
      end_date: "2026-09-30",
    });
  });

  test("applies skip policy without unexpected shifts after setting a count later", () => {
    const updates = plannedExpenseApplyScheduledSkipPolicy(
      {
        kind: "scheduled_payment",
        recurrence_type: "recurring",
        recurrence_interval: 1,
        recurrence_unit: "month",
        recurrence_monthly_mode: "day_of_month",
        recurrence_day: 1,
        next_due_date: "2026-01-01",
        recurrence_count: 5,
        skipped_dates: null,
        completed_dates: "2026-01-01,2026-02-01",
      },
      "2026-03-01",
      "reduce",
    );

    expect(updates).toEqual({ skipped_dates: "2026-03-01" });
    expect(
      plannedExpenseRecurrenceFinalOccurrenceDate({
        kind: "scheduled_payment",
        recurrence_type: "recurring",
        recurrence_interval: 1,
        recurrence_unit: "month",
        recurrence_monthly_mode: "day_of_month",
        recurrence_day: 1,
        next_due_date: "2026-01-01",
        recurrence_count: 5,
        ...updates,
      }),
    ).toBe("2026-05-01");
  });

  test("applies skip policy without unexpected shifts after setting an end date later", () => {
    const item = {
      kind: "scheduled_payment",
      recurrence_type: "recurring",
      recurrence_interval: 1,
      recurrence_unit: "month",
      recurrence_monthly_mode: "day_of_month",
      recurrence_day: 1,
      next_due_date: "2026-01-01",
      end_date: "2026-05-15",
      skipped_dates: null,
      completed_dates: "2026-01-01,2026-02-01",
    };

    expect(
      plannedExpenseApplyScheduledSkipPolicy(item, "2026-03-01", "reduce"),
    ).toEqual({ skipped_dates: "2026-03-01" });
    expect(
      plannedExpenseApplyScheduledSkipPolicy(item, "2026-03-01", "postpone"),
    ).toEqual({
      skipped_dates: "2026-03-01",
      end_date: "2026-06-01",
    });
  });

  test("uses a distinct feedback message when source item completion also finished", () => {
    expect(plannedExpenseCompletionFeedbackKey("none")).toBe("transactionSaved");
    expect(plannedExpenseCompletionFeedbackKey("pending")).toBe("transactionSaved");
    expect(plannedExpenseCompletionFeedbackKey("completed")).toBe(
      "transactionSavedWithPlannedExpenseCompleted",
    );
    expect(plannedExpenseCompletionFeedbackKey("shopping_list_archived")).toBe(
      "transactionSavedWithShoppingListArchived",
    );
  });

  test("requires confirmation for destructive planned expense actions", () => {
    expect(plannedExpenseActionRequiresConfirmation("delete_category")).toBe(true);
    expect(plannedExpenseActionRequiresConfirmation("delete_item")).toBe(true);
    expect(plannedExpenseActionRequiresConfirmation("complete_item")).toBe(true);
  });

  test("does not expose a separate cancel item action beside delete", () => {
    const pageSource = readFileSync(
      join(import.meta.dir, "../src/pages/PlannedExpensePage.tsx"),
      "utf8",
    );

    expect(pageSource).not.toContain("requestCancelItem");
    expect(pageSource).not.toContain("cancelItemTarget");
    expect(pageSource).not.toContain('t("plannedExpenseCancel")');
  });

  test("serializes multiple monthly week positions for nth-weekday schedules", () => {
    expect(serializePlannedExpenseWeeksOfMonth(["4", "2", "2"])).toBe("2,4");
    expect(serializePlannedExpenseWeeksOfMonth(["", "6", "abc"])).toBeNull();
  });

  test("parses stored nth-weekday week positions for the form", () => {
    expect(parsePlannedExpenseWeeksOfMonth("2,4")).toEqual(["2", "4"]);
    expect(parsePlannedExpenseWeeksOfMonth("4,2,4")).toEqual(["2", "4"]);
    expect(parsePlannedExpenseWeeksOfMonth(null)).toEqual([]);
  });

  test("offers end of month before concrete day-of-month options", () => {
    const options = plannedExpenseDayOfMonthSelectOptions(
      (key) => (key === "closingDayEndOfMonth" ? "End of month" : key),
    );

    expect(options[0]).toEqual({ value: "0", label: "End of month" });
    expect(options[1]).toEqual({ value: "1", label: "1" });
    expect(options.at(-1)).toEqual({ value: "31", label: "31" });
  });

  test("resolves monthly recurrence days against the target month", () => {
    expect(plannedExpenseMonthlyDueDateFromDay("2026-04-10", 31)).toBe(
      "2026-04-30",
    );
    expect(plannedExpenseMonthlyDueDateFromDay("2028-02-01", 0)).toBe(
      "2028-02-29",
    );
  });
});
