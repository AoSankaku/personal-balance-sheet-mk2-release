import { expect, test } from "bun:test";
import {
  resolveDepreciationMonthlySourceAllocations,
  splitDepreciationMonthlySourceAllocations,
  validateDepreciationMonthlySourceAllocations,
} from "./depreciationBudgetAllocation";

test("legacy single source resolves to 100% while explicit allocations win", () => {
  expect(resolveDepreciationMonthlySourceAllocations({ monthly_source_category_id: 12 })).toEqual([
    { budget_category_id: 12, ratio: 100 },
  ]);
  expect(resolveDepreciationMonthlySourceAllocations({
    monthly_source_category_id: 12,
    monthly_source_allocations: [
      { budget_category_id: null, ratio: 10 },
      { budget_category_id: 9, ratio: 45 },
      { budget_category_id: 3, ratio: 45 },
    ],
  })).toEqual([
    { budget_category_id: 3, ratio: 45 },
    { budget_category_id: 9, ratio: 45 },
    { budget_category_id: null, ratio: 10 },
  ]);
});

for (const currency of ["JPY", "USD"]) {
  test(`${currency}: an odd five-minor-unit split favors the lower category ID on a tie`, () => {
    const split = splitDepreciationMonthlySourceAllocations(5, [
      { budget_category_id: 9, ratio: 50 },
      { budget_category_id: 3, ratio: 50 },
    ]);
    expect(split).toEqual([
      { budget_category_id: 3, ratio: 50, amount: 3 },
      { budget_category_id: 9, ratio: 50, amount: 2 },
    ]);
    expect(split.reduce((sum, row) => sum + row.amount, 0)).toBe(5);
  });
}

test("manual fractional percentages are kept and unallocated receives tied remainder last", () => {
  const allocations = [
    { budget_category_id: null, ratio: 33.333333333 },
    { budget_category_id: 9, ratio: 33.333333333 },
    { budget_category_id: 3, ratio: 33.333333333 },
  ];
  expect(validateDepreciationMonthlySourceAllocations(allocations)).toBeNull();
  expect(splitDepreciationMonthlySourceAllocations(2, allocations)).toEqual([
    { budget_category_id: 3, ratio: 33.333333333, amount: 1 },
    { budget_category_id: 9, ratio: 33.333333333, amount: 1 },
    { budget_category_id: null, ratio: 33.333333333, amount: 0 },
  ]);
});

test.each([
  ["empty", []],
  ["sum below 100", [{ budget_category_id: 1, ratio: 99 }]],
  ["sum above 100", [{ budget_category_id: 1, ratio: 101 }]],
  ["duplicate category", [
    { budget_category_id: 1, ratio: 50 },
    { budget_category_id: 1, ratio: 50 },
  ]],
  ["unsafe ID", [{ budget_category_id: Number.MAX_SAFE_INTEGER + 1, ratio: 100 }]],
  ["non-finite ratio", [{ budget_category_id: 1, ratio: Number.NaN }]],
])("invalid allocation shape (%s) is rejected", (_name, allocations) => {
  expect(validateDepreciationMonthlySourceAllocations(allocations)).not.toBeNull();
});
