import { describe, expect, test } from "bun:test";

import { refreshAfterBudgetAdjustment } from "../src/lib/budgetAdjustmentRefresh";

describe("refreshAfterBudgetAdjustment", () => {
  test("refreshes both the budget summary and allocatable budget state", async () => {
    const calls: string[] = [];

    await refreshAfterBudgetAdjustment({
      refreshBudget: () => {
        calls.push("budget");
      },
      refreshAllocatable: () => {
        calls.push("allocatable");
      },
    });

    expect(calls.sort()).toEqual(["allocatable", "budget"]);
  });
});
