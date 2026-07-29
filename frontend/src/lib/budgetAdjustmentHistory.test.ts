import { describe, expect, it } from "bun:test";
import type { BudgetAdjustmentLog } from "@balance-sheet/shared";
import {
  buildLatestBudgetResetByCategory,
  filterBudgetAdjustmentHistory,
} from "./budgetAdjustmentHistory";

function log(
  id: number,
  budgetCategoryId: number,
  date: string,
  createdAt: string,
  type: BudgetAdjustmentLog["type"] = "manual",
): BudgetAdjustmentLog {
  return {
    id,
    budget_category_id: budgetCategoryId,
    budget_category_name: `Budget ${budgetCategoryId}`,
    year_month: date.slice(0, 7),
    amount: type === "reset" ? -100 : 10,
    currency: "JPY",
    date,
    created_at: createdAt,
    type,
    adjustment_type: type === "reset" ? "reset" : "allocation",
  };
}

describe("budget adjustment history reset boundaries", () => {
  const logs = [
    log(1, 10, "2026-01-10", "2026-01-10T08:00:00.000Z"),
    log(2, 10, "2026-02-01", "2026-02-01T08:00:00.000Z", "reset"),
    log(3, 10, "2026-02-01", "2026-02-01T09:00:00.000Z"),
    log(4, 10, "2026-03-01", "2026-03-01T08:00:00.000Z", "reset"),
    log(5, 10, "2026-03-01", "2026-03-01T07:00:00.000Z"),
    log(6, 10, "2026-03-02", "2026-03-02T08:00:00.000Z"),
    log(7, 20, "2026-01-15", "2026-01-15T08:00:00.000Z"),
    log(8, 10, "2026-03-01", "2026-03-01T08:00:00.000Z"),
  ];

  it("finds the latest reset independently for each budget category", () => {
    const boundaries = buildLatestBudgetResetByCategory(logs);

    expect(boundaries.get(10)).toEqual({
      id: 4,
      date: "2026-03-01",
      created_at: "2026-03-01T08:00:00.000Z",
    });
    expect(boundaries.has(20)).toBe(false);
  });

  it("hides entries before the latest reset for the same category by default", () => {
    const filtered = filterBudgetAdjustmentHistory(logs, {
      from: "2026-01-01",
      to: "2026-03-31",
      showBeforeLatestReset: false,
    });

    expect(filtered.map((item) => item.id)).toEqual([4, 6, 7]);
  });

  it("shows pre-reset entries when requested while still applying the date range", () => {
    const filtered = filterBudgetAdjustmentHistory(logs, {
      from: "2026-02-01",
      to: "2026-02-28",
      showBeforeLatestReset: true,
    });

    expect(filtered.map((item) => item.id)).toEqual([2, 3]);
  });
});
