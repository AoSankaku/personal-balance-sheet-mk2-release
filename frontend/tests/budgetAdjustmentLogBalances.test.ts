import { describe, expect, test } from "bun:test";

import type { BudgetAdjustmentLog } from "@balance-sheet/shared";
import { buildBudgetAdjustmentLogBalanceMap } from "../src/lib/budgetAdjustmentLogBalances";

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
    adjustment_type: overrides.adjustment_type,
    journal_entry_id: overrides.journal_entry_id,
    note: overrides.note,
  };
}

describe("buildBudgetAdjustmentLogBalanceMap", () => {
  test("returns the budget balance after each log per category", () => {
    const balances = buildBudgetAdjustmentLogBalanceMap([
      log({
        id: 1,
        budget_category_id: 10,
        amount: 1000,
        date: "2026-05-01",
      }),
      log({
        id: 2,
        budget_category_id: 10,
        amount: -400,
        date: "2026-05-02",
      }),
      log({
        id: 3,
        budget_category_id: 10,
        amount: 200,
        date: "2026-05-03",
      }),
    ]);

    expect([...balances.entries()]).toEqual([
      ["manual:3", 800],
      ["manual:2", 600],
      ["manual:1", 1000],
    ]);
  });

  test("calculates categories independently", () => {
    const balances = buildBudgetAdjustmentLogBalanceMap([
      log({ id: 1, budget_category_id: 10, amount: 1000 }),
      log({ id: 2, budget_category_id: 20, amount: 500 }),
      log({
        id: 3,
        budget_category_id: 10,
        amount: -250,
        date: "2026-05-02",
      }),
    ]);

    expect(balances.get("manual:3")).toBe(750);
    expect(balances.get("manual:1")).toBe(1000);
    expect(balances.get("manual:2")).toBe(500);
  });

  test("uses type and id together so journal and adjustment rows cannot collide", () => {
    const balances = buildBudgetAdjustmentLogBalanceMap([
      log({ id: 1, type: "manual", amount: 1000 }),
      log({ id: 1, type: "simple", amount: -300, date: "2026-05-02" }),
    ]);

    expect(balances.get("simple:1")).toBe(700);
    expect(balances.get("manual:1")).toBe(1000);
  });
});
