import { describe, expect, test } from "bun:test";

import type { BudgetAdjustmentLog } from "@balance-sheet/shared";
import { sortBudgetAdjustmentLogs } from "../src/lib/budgetAdjustmentLogSort";

function log(overrides: Partial<BudgetAdjustmentLog>): BudgetAdjustmentLog {
  return {
    id: overrides.id ?? 1,
    budget_category_id: overrides.budget_category_id ?? 1,
    budget_category_name: overrides.budget_category_name ?? "Category",
    year_month: overrides.year_month ?? "2026-05",
    amount: overrides.amount ?? 0,
    currency: overrides.currency ?? "JPY",
    date: overrides.date ?? "2026-05-01",
    created_at: overrides.created_at ?? "2026-05-01 00:00:00",
    type: overrides.type ?? "manual",
    journal_entry_id: overrides.journal_entry_id,
  };
}

describe("sortBudgetAdjustmentLogs", () => {
  test("orders same-date rows by newest input timestamp first", () => {
    const rows = [
      log({ id: 1, date: "2026-05-01", created_at: "2026-05-01 09:00:00" }),
      log({ id: 2, date: "2026-05-01", created_at: "2026-05-01 12:00:00" }),
      log({ id: 3, date: "2026-05-02", created_at: "2026-05-02 08:00:00" }),
    ];

    expect(
      sortBudgetAdjustmentLogs(rows, { key: "date", dir: "desc" }).map(
        (r) => r.id,
      ),
    ).toEqual([3, 2, 1]);
  });

  test("orders category sort by budget category settings order", () => {
    const rows = [
      log({ id: 1, budget_category_id: 10, budget_category_name: "B" }),
      log({ id: 2, budget_category_id: 20, budget_category_name: "A" }),
      log({ id: 3, budget_category_id: 30, budget_category_name: "C" }),
    ];

    expect(
      sortBudgetAdjustmentLogs(
        rows,
        { key: "category", dir: "asc" },
        [30, 10, 20],
      ).map((row) => row.id),
    ).toEqual([3, 1, 2]);
  });
});
