import { describe, expect, test } from "bun:test";

import {
  buildExpenseBudgetAllocations,
  computeBudgetDistributionAmounts,
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
});
