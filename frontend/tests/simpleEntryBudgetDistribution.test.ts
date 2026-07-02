import { describe, expect, test } from "bun:test";

import {
  buildExpenseBudgetAllocations,
  computeBudgetDistributionAmounts,
  summarizeBudgetDistribution,
} from "../src/lib/simpleEntryUtils";

describe("simple entry budget distribution", () => {
  test("splits odd yen amounts without creating or dropping yen", () => {
    const amounts = computeBudgetDistributionAmounts(319, [
      { budget_category_id: 1, ratio: 50 },
      { budget_category_id: 2, ratio: 50 },
    ]);

    expect(amounts.get(1)).toBe(160);
    expect(amounts.get(2)).toBe(159);
    expect([...amounts.values()].reduce((sum, amount) => sum + amount, 0)).toBe(
      319,
    );
  });

  test("uses manually edited yen amounts when submitting", () => {
    expect(
      buildExpenseBudgetAllocations(319, [
        { budget_category_id: 1, ratio: 50, amount: 159 },
        { budget_category_id: 2, ratio: 50, amount: 160 },
      ]),
    ).toEqual([
      { budget_category_id: 1, amount: -159 },
      { budget_category_id: 2, amount: -160 },
    ]);
  });

  test("does not treat 159 yen plus 159 yen as complete for a 319 yen entry", () => {
    const summary = summarizeBudgetDistribution(319, [
      { budget_category_id: 1, ratio: 50, amount: 159 },
      { budget_category_id: 2, ratio: 50, amount: 159 },
    ]);

    expect(summary.totalRatio).toBe(100);
    expect(summary.allocatedAmount).toBe(318);
    expect(summary.targetAmount).toBe(319);
    expect(summary.displayRatio).toBe(99.7);
    expect(summary.isComplete).toBe(false);
    expect(summary.isUnderAllocated).toBe(true);
  });

  test("shows over-allocation as an effective percentage above 100", () => {
    const summary = summarizeBudgetDistribution(319, [
      { budget_category_id: 1, ratio: 50, amount: 160 },
      { budget_category_id: 2, ratio: 50, amount: 160 },
    ]);

    expect(summary.totalRatio).toBe(100);
    expect(summary.allocatedAmount).toBe(320);
    expect(summary.displayRatio).toBe(100.3);
    expect(summary.isComplete).toBe(false);
    expect(summary.isOverAllocated).toBe(true);
  });
});
