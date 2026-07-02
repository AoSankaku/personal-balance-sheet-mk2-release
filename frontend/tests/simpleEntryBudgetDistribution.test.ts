import { describe, expect, test } from "bun:test";

import {
  buildExpenseBudgetAllocations,
  computeBudgetDistributionAmounts,
  formatBudgetDistributionRatio,
  mergeIncomeDistributionDefaults,
  summarizeAmountDistribution,
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
    expect(summary.displayRatio).toBe(99.68);
    expect(formatBudgetDistributionRatio(summary.displayRatio)).toBe("99.68");
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
    expect(summary.displayRatio).toBe(100.32);
    expect(formatBudgetDistributionRatio(summary.displayRatio)).toBe("100.32");
    expect(summary.isComplete).toBe(false);
    expect(summary.isOverAllocated).toBe(true);
  });

  test("rounds a tiny expense over-allocation away from 100 percent", () => {
    const summary = summarizeBudgetDistribution(100_000_000, [
      { budget_category_id: 1, ratio: 10, amount: 10_000_001 },
      { budget_category_id: 2, ratio: 90, amount: 90_000_000 },
    ]);

    expect(summary.allocatedAmount).toBe(100_000_001);
    expect(summary.isComplete).toBe(false);
    expect(summary.isOverAllocated).toBe(true);
    expect(formatBudgetDistributionRatio(summary.displayRatio)).toBe("100.01");
  });

  test("rounds a tiny expense under-allocation away from 100 percent", () => {
    const summary = summarizeBudgetDistribution(100_000_000, [
      { budget_category_id: 1, ratio: 10, amount: 9_999_999 },
      { budget_category_id: 2, ratio: 90, amount: 90_000_000 },
    ]);

    expect(summary.allocatedAmount).toBe(99_999_999);
    expect(summary.isComplete).toBe(false);
    expect(summary.isUnderAllocated).toBe(true);
    expect(formatBudgetDistributionRatio(summary.displayRatio)).toBe("99.99");
  });

  test("preserves manually edited regular income distribution rows", () => {
    const rows = mergeIncomeDistributionDefaults({
      defaultRows: [
        { budget_category_id: 1, name: "Free", amount: 600 },
        { budget_category_id: 2, name: "Required", amount: 400 },
      ],
      currentRows: [
        { budget_category_id: 1, name: "Free", amount: 550 },
        { budget_category_id: 2, name: "Required", amount: 450 },
      ],
      dirtyCategoryIds: new Set([1]),
    });

    expect(rows).toEqual([
      { budget_category_id: 1, name: "Free", amount: 550 },
      { budget_category_id: 2, name: "Required", amount: 400 },
    ]);
  });

  test("recomputes unedited regular income distribution rows", () => {
    const rows = mergeIncomeDistributionDefaults({
      defaultRows: [
        { budget_category_id: 1, name: "Free", amount: 600 },
        { budget_category_id: 2, name: "Required", amount: 400 },
      ],
      currentRows: [
        { budget_category_id: 1, name: "Free", amount: 500 },
        { budget_category_id: 2, name: "Required", amount: 500 },
      ],
      dirtyCategoryIds: new Set(),
    });

    expect(rows).toEqual([
      { budget_category_id: 1, name: "Free", amount: 600 },
      { budget_category_id: 2, name: "Required", amount: 400 },
    ]);
  });

  test("shows a visible income over-allocation percentage for a one yen difference", () => {
    const summary = summarizeAmountDistribution(54321, [
      { amount: 54322 },
    ]);

    expect(summary.allocatedAmount).toBe(54322);
    expect(summary.isComplete).toBe(false);
    expect(summary.isOverAllocated).toBe(true);
    expect(formatBudgetDistributionRatio(summary.displayRatio)).toBe(
      "100.01",
    );
  });

  test("shows a visible income under-allocation percentage for a one yen difference", () => {
    const summary = summarizeAmountDistribution(54321, [
      { amount: 54320 },
    ]);

    expect(summary.allocatedAmount).toBe(54320);
    expect(summary.isComplete).toBe(false);
    expect(summary.isUnderAllocated).toBe(true);
    expect(formatBudgetDistributionRatio(summary.displayRatio)).toBe("99.99");
  });

  test("rounds a tiny income over-allocation away from 100 percent", () => {
    const summary = summarizeAmountDistribution(100_000_000, [
      { amount: 100_000_001 },
    ]);

    expect(summary.allocatedAmount).toBe(100_000_001);
    expect(summary.isComplete).toBe(false);
    expect(summary.isOverAllocated).toBe(true);
    expect(formatBudgetDistributionRatio(summary.displayRatio)).toBe("100.01");
  });

  test("rounds a tiny income under-allocation away from 100 percent", () => {
    const summary = summarizeAmountDistribution(100_000_000, [
      { amount: 99_999_999 },
    ]);

    expect(summary.allocatedAmount).toBe(99_999_999);
    expect(summary.isComplete).toBe(false);
    expect(summary.isUnderAllocated).toBe(true);
    expect(formatBudgetDistributionRatio(summary.displayRatio)).toBe("99.99");
  });
});
