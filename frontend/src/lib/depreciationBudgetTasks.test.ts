import { describe, expect, test } from "bun:test";
import type { DepreciationSchedule } from "@balance-sheet/shared";
import { getDepreciationBudgetTaskSchedules } from "./depreciationBudgetTasks";

function schedule(
  id: number,
  budget: Partial<DepreciationSchedule["budget"]>,
): DepreciationSchedule {
  return {
    id,
    source_journal_entry_id: id,
    asset_account_id: id,
    asset_account_name: `Asset ${id}`,
    expense_account_id: id + 100,
    expense_account_name: "Depreciation expense",
    payment_account_name: "Cash",
    total_amount: 1200,
    months: 12,
    start_date: "2026-01-01",
    description: `Schedule ${id}`,
    created_at: "2026-01-01T00:00:00.000Z",
    monthly_amounts: Array.from({ length: 12 }, () => 100),
    entry_dates: Array.from({ length: 12 }, (_, month) => `2026-${String(month + 1).padStart(2, "0")}-01`),
    budget: {
      method: null,
      purchase_category_id: null,
      monthly_source_category_id: null,
      destination_category_id: null,
      target_amount: 0,
      reimbursed_amount: 0,
      remaining_amount: 0,
      ended_unreimbursed_amount: 0,
      future_amount: 0,
      status: "unset",
      currency: "JPY",
      revision: 0,
      settings: null,
      ...budget,
    },
  };
}

describe("depreciation budget task selection", () => {
  test("always includes schedules whose budget treatment is unset", () => {
    expect(getDepreciationBudgetTaskSchedules([schedule(1, {})]).map(({ id }) => id)).toEqual([1]);
  });

  test("reminds for assigned and special balances only when nothing remains in the future", () => {
    const schedules = [
      schedule(1, { method: "assigned", status: "active", remaining_amount: 500, future_amount: 0 }),
      schedule(2, { method: "special", status: "active", remaining_amount: 300, future_amount: 0 }),
      schedule(3, { method: "assigned", status: "active", remaining_amount: 500, future_amount: 100 }),
      schedule(4, { method: "unallocated", status: "active", remaining_amount: 500, future_amount: 0 }),
      schedule(5, { method: "assigned", status: "completed", remaining_amount: 500, future_amount: 0 }),
      schedule(6, { method: "special", status: "ended", remaining_amount: 500, future_amount: 0 }),
      schedule(7, { method: "assigned", status: "active", remaining_amount: 0, future_amount: 0 }),
    ];

    expect(getDepreciationBudgetTaskSchedules(schedules).map(({ id }) => id)).toEqual([1, 2]);
  });
});
