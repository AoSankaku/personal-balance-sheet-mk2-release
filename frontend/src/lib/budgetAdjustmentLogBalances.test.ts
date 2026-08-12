import { describe, expect, test } from "bun:test";
import type { BudgetAdjustmentLog } from "@balance-sheet/shared";
import {
  budgetAdjustmentLogKey,
  buildBudgetAdjustmentLogBalanceMap,
} from "./budgetAdjustmentLogBalances";
import { summarizeBudgetAdjustmentLogsByCategory } from "./budgetAdjustmentCategorySummary";

function log(
  id: number,
  amount: number,
  isReference = false,
): BudgetAdjustmentLog {
  return {
    id,
    budget_category_id: 1,
    budget_category_name: "Food",
    year_month: "2026-07",
    amount,
    currency: "JPY",
    date: `2026-07-${String(id).padStart(2, "0")}`,
    created_at: `2026-07-${String(id).padStart(2, "0")}T00:00:00Z`,
    type: "simple",
    is_reference: isReference,
  };
}

describe("reference budget adjustment logs", () => {
  test("keeps reference rows distinct while consuming the running balance", () => {
    const regular = log(1, -1_000);
    const reference = log(2, -1_180, true);
    const logs = [regular, reference];

    const balances = buildBudgetAdjustmentLogBalanceMap(logs);
    expect(balances.get(budgetAdjustmentLogKey(reference))).toBe(-2_180);
    expect(balances.get(budgetAdjustmentLogKey(regular))).toBe(-1_000);

    const [summary] = summarizeBudgetAdjustmentLogsByCategory(logs);
    expect(summary?.logs).toHaveLength(2);
    expect(summary?.adjustment_total).toBe(-2_180);
  });
});
