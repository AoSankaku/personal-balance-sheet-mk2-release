import { describe, expect, test } from "bun:test";
import { allocateLoanBudgetDefaults, normalizeLoanBudgetWeights, validateLoanBudgetWeights } from "./longTermLoanBudgetDefaults";

describe("long-term loan default ratios", () => {
  test("keeps the exact original integer ratio, including unallocated", () => {
    expect(normalizeLoanBudgetWeights([
      { budget_category_id: 20, weight: 20000 },
      { budget_category_id: 10, weight: 10000 },
      { budget_category_id: null, weight: 5000 },
    ])).toEqual([
      { budget_category_id: 10, weight: 2 },
      { budget_category_id: 20, weight: 4 },
      { budget_category_id: null, weight: 1 },
    ]);
  });
  test("merges portions whose deleted categories became unallocated", () => {
    expect(normalizeLoanBudgetWeights([{ budget_category_id: null, weight: 3 }, { budget_category_id: null, weight: 2 }]))
      .toEqual([{ budget_category_id: null, weight: 1 }]);
  });
  test("allocates whole yen by exact remainders with stable category tie breaking", () => {
    expect(allocateLoanBudgetDefaults(100, [
      { budget_category_id: null, weight: 1 }, { budget_category_id: 20, weight: 1 }, { budget_category_id: 10, weight: 1 },
    ], 0)).toEqual([
      { budget_category_id: 10, amount: 34 }, { budget_category_id: 20, amount: 33 }, { budget_category_id: null, amount: 33 },
    ]);
  });
  test("retains very small ratios instead of rounding them to zero", () => {
    expect(allocateLoanBudgetDefaults(10001, [{ budget_category_id: 10, weight: 1 }, { budget_category_id: null, weight: 10000 }], 0))
      .toEqual([{ budget_category_id: 10, amount: 1 }, { budget_category_id: null, amount: 10000 }]);
  });
  test.each([0, 2, 8, 9])("conserves currency minor units at precision %s", precision => {
    const scale = 10 ** precision;
    for (const units of [0, 1, 2, 3, 99, 100, 101, 10001]) {
      const rows = allocateLoanBudgetDefaults(units / scale, [
        { budget_category_id: 10, weight: 17 }, { budget_category_id: 20, weight: 23 }, { budget_category_id: null, weight: 31 },
      ], precision);
      expect(rows.reduce((sum, row) => sum + Math.round(row.amount * scale), 0)).toBe(units);
      expect(rows.every(row => row.amount >= 0)).toBe(true);
    }
  });
  test("uses exact products beyond floating-point multiplication precision", () => {
    const total = Number.MAX_SAFE_INTEGER;
    const weights = [{ budget_category_id: 10, weight: total - 1 }, { budget_category_id: null, weight: 1 }];
    expect(allocateLoanBudgetDefaults(total, weights, 0)).toEqual([
      { budget_category_id: 10, amount: total - 1 }, { budget_category_id: null, amount: 1 },
    ]);
  });
  test.each([[], [{ budget_category_id: 1, weight: 0 }], [{ budget_category_id: 1, weight: -1 }], [{ budget_category_id: 1, weight: 0.5 }], [{ budget_category_id: 1, weight: Infinity }], [{ budget_category_id: 0, weight: 1 }], [{ budget_category_id: 1, weight: 1 }, { budget_category_id: 1, weight: 2 }]])("rejects malformed saved ratios", rows => {
    expect(validateLoanBudgetWeights(rows)).not.toBeNull();
  });
});
