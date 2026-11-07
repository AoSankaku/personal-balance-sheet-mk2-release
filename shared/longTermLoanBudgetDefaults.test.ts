import { describe, expect, test } from "bun:test";
import { allocateLoanBudgetDefaults, allocateLoanBudgetDefaultMinorUnits, normalizeLoanBudgetWeights, validateLoanBudgetWeights } from "./longTermLoanBudgetDefaults";

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
  test.each([[90071992547409.9, 2], [9007199.25474099, 9]])("rejects a numeric split that cannot preserve minor units", (amount, precision) => {
    expect(() => allocateLoanBudgetDefaults(amount, [{ budget_category_id: 10, weight: 1 }, { budget_category_id: null, weight: 1 }], precision))
      .toThrow("unrepresentable_loan_budget_amount");
  });
  test("limits saved weight totals so deleted categories can always merge exactly", () => {
    expect(validateLoanBudgetWeights([{ budget_category_id: 10, weight: Number.MAX_SAFE_INTEGER }, { budget_category_id: null, weight: 1 }]))
      .toBe("loan_budget_weight_total_out_of_range");
  });
  test("carries the first yen's remainder to the next collection", () => {
    const weights = [{ budget_category_id: 10, weight: 1 }, { budget_category_id: 20, weight: 1 }];
    expect(allocateLoanBudgetDefaults(1, weights, 0, {
      settled_progress_available: true, settled_minor_units: 1,
      settled_allocations: [{ budget_category_id: 10, minor_units: 1 }],
    })).toEqual([{ budget_category_id: 10, amount: 0 }, { budget_category_id: 20, amount: 1 }]);
  });
  test("installments finish at the exact original category split without negative allocations", () => {
    const weights = [15, 15, 9, 5, 5, 2].map((weight, index) => ({ budget_category_id: index + 1, weight }));
    let settled = 0;
    const totals = new Map<number | null, number>();
    for (const units of [1, 3, 7, 2, 1, 25, 12]) {
      const rows = allocateLoanBudgetDefaultMinorUnits(units, weights, {
        settled_progress_available: true, settled_minor_units: settled,
        settled_allocations: [...totals].map(([budget_category_id, minor_units]) => ({ budget_category_id, minor_units })),
      });
      expect(rows.reduce((sum, row) => sum + row.minor_units, 0)).toBe(units);
      expect(rows.every(row => row.minor_units >= 0)).toBe(true);
      for (const row of rows) totals.set(row.budget_category_id, (totals.get(row.budget_category_id) ?? 0) + row.minor_units);
      settled += units;
    }
    expect([...totals.values()]).toEqual(weights.map(row => row.weight));
  });
  test("rejects inconsistent or unavailable progress", () => {
    const weights = [{ budget_category_id: 10, weight: 1 }];
    expect(() => allocateLoanBudgetDefaultMinorUnits(1, weights, { settled_progress_available: false, settled_minor_units: 0, settled_allocations: [] })).toThrow();
    expect(() => allocateLoanBudgetDefaultMinorUnits(1, weights, { settled_minor_units: 2, settled_allocations: [{ budget_category_id: 10, minor_units: 1 }] })).toThrow();
  });
  test.each([[], [{ budget_category_id: 1, weight: 0 }], [{ budget_category_id: 1, weight: -1 }], [{ budget_category_id: 1, weight: 0.5 }], [{ budget_category_id: 1, weight: Infinity }], [{ budget_category_id: 0, weight: 1 }], [{ budget_category_id: 1, weight: 1 }, { budget_category_id: 1, weight: 2 }]].map(rows => [rows]))("rejects malformed saved ratios", rows => {
    expect(validateLoanBudgetWeights(rows)).not.toBeNull();
  });
});
