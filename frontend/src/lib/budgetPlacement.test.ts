import { describe, expect, test } from "bun:test";
import {
  applyBudgetPlacementTransfers,
  calculateBudgetPlacement,
} from "./budgetPlacement";

describe("applyBudgetPlacementTransfers", () => {
  test("moves group differences without changing their total", () => {
    const accounts = [
      { id: 1, name: "Main", category: "cash", balances: { JPY: 100 } },
      { id: 2, name: "Tax", category: "cash", balances: { JPY: 0 } },
    ];
    const categories = [
      {
        category: { id: 1, name: "Living", target_accounts: [{ account_id: 1, ratio: 1 }] },
        available: 80,
      },
      {
        category: { id: 2, name: "Tax", target_accounts: [{ account_id: 2, ratio: 1 }] },
        available: 20,
      },
    ];
    const before = calculateBudgetPlacement({
      accounts,
      categorySummaries: categories,
      currency: "JPY",
    });
    const after = calculateBudgetPlacement({
      accounts: applyBudgetPlacementTransfers(
        accounts,
        [{ from_account_id: 1, to_account_id: 2, amount: 20, currency: "JPY" }],
        "JPY",
      ),
      categorySummaries: categories,
      currency: "JPY",
    });

    expect(before.placementGroups.map((group) => group.difference)).toEqual([20, -20]);
    expect(after.placementGroups.map((group) => group.difference)).toEqual([0, 0]);
    expect(
      before.placementGroups.reduce((sum, group) => sum + group.difference, 0),
    ).toBe(
      after.placementGroups.reduce((sum, group) => sum + group.difference, 0),
    );
  });
});
