import { describe, expect, test } from "bun:test";
import type { BudgetAdjustmentLog } from "@balance-sheet/shared";
import {
  budgetAdjustmentLogKey,
  buildBudgetAdjustmentLogBalanceMap,
} from "./budgetAdjustmentLogBalances";
import { summarizeBudgetAdjustmentLogsByCategory } from "./budgetAdjustmentCategorySummary";
import { filterBudgetAdjustmentHistory } from "./budgetAdjustmentHistory";
import { replayBudgetHistory } from "../../../shared/budgetHistory";

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
  test("keeps reference rows distinct without consuming the running balance", () => {
    const regular = log(1, -1_000);
    const reference = log(2, -1_180, true);
    const logs = [regular, reference];

    const balances = buildBudgetAdjustmentLogBalanceMap(logs);
    expect(balances.get(budgetAdjustmentLogKey(reference))).toBe(-1_000);
    expect(balances.get(budgetAdjustmentLogKey(regular))).toBe(-1_000);

    const [summary] = summarizeBudgetAdjustmentLogsByCategory(logs);
    expect(summary?.logs).toHaveLength(2);
    expect(
      summary?.log_balances.find(({ log: row }) => row.is_reference)
        ?.adjusted_total_after,
    ).toBe(-1_000);
    expect(summary?.adjusted_total).toBe(-1_000);
  });

  test("carries full-history balances into date-filtered adjustment history", () => {
    const priorIncome = log(1, 500);
    const visibleExpense = {
      ...log(3, -100),
      date: "2026-07-10",
      created_at: "2026-07-10T00:00:00Z",
    };
    const fullHistory = replayBudgetHistory([priorIncome, visibleExpense]);
    const visibleLogs = filterBudgetAdjustmentHistory(fullHistory.logs, {
      from: "2026-07-10",
      showBeforeLatestReset: true,
    });

    const [summary] = summarizeBudgetAdjustmentLogsByCategory(
      visibleLogs,
      [],
      new Map(),
      fullHistory.balances,
    );

    expect(visibleLogs).toHaveLength(1);
    expect(
      fullHistory.balances.get(budgetAdjustmentLogKey(visibleExpense)),
    ).toBe(400);
    expect(summary?.log_balances[0]?.adjusted_total_after).toBe(400);
    expect(summary?.adjusted_total).toBe(400);
  });
});
