import { describe, expect, test } from "bun:test";
import {
  splitDepreciationMonthlySourceAllocations,
  validateDepreciationMonthlySourceAllocations,
} from "@balance-sheet/shared";
import {
  buildDepreciationMonthlySourceDefaults,
  calculateBudgetedDepreciationMonthlyAmounts,
  calculateDepreciationMonthlyAmounts,
  getDepreciationMonthlyPreviewIndex,
  getDepreciationMonthlySourceAllocations,
  snapshotDepreciationMonthlySourceSettings,
} from "./depreciationMonthlySources";

const categories = [
  { id: 1002 },
  { id: 1003 },
  { id: 1004 },
];

describe("depreciation monthly source allocations", () => {
  test("selects the earliest saved month on or after today, or the latest valid month when finished", () => {
    const dates = ["2026-12-01", "2026-10-01", "2026-11-01"];
    expect(getDepreciationMonthlyPreviewIndex(dates, "2026-10-19")).toBe(2);
    expect(getDepreciationMonthlyPreviewIndex(dates, "2027-01-01")).toBe(0);
    expect(getDepreciationMonthlyPreviewIndex(["bad-date", "2026-08-01"], "2026-10-19")).toBe(1);
    expect(getDepreciationMonthlyPreviewIndex([], "2026-10-19")).toBeNull();
  });

  test("starts from expense-account ratios, omits zero rows, and fills the unallocated remainder", () => {
    expect(
      buildDepreciationMonthlySourceDefaults(categories, [
        { budget_category_id: 1002, ratio: 60 },
        { budget_category_id: 1003, ratio: 30 },
      ]),
    ).toEqual([
      { budget_category_id: 1002, ratio: 60 },
      { budget_category_id: 1003, ratio: 30 },
      { budget_category_id: null, ratio: 10 },
    ]);
  });

  test("does not normalize account defaults that exceed 100 percent", () => {
    const defaults = buildDepreciationMonthlySourceDefaults(categories, [
      { budget_category_id: 1002, ratio: 75 },
      { budget_category_id: 1003, ratio: 35 },
    ]);
    expect(defaults).toEqual([
      { budget_category_id: 1002, ratio: 75 },
      { budget_category_id: 1003, ratio: 35 },
    ]);
    expect(validateDepreciationMonthlySourceAllocations(defaults)).toBe(
      "monthly_source_ratios_must_total_100",
    );
  });

  test("snapshots account defaults on submit while preserving legacy single-source plans", () => {
    const defaultsSnapshot = snapshotDepreciationMonthlySourceSettings(
      { method: "assigned", purchase_category_id: 1004 },
      categories,
      [
        { budget_category_id: 1002, ratio: 60 },
        { budget_category_id: 1003, ratio: 40 },
      ],
    );
    expect(defaultsSnapshot.monthly_source_allocations).toEqual([
      { budget_category_id: 1002, ratio: 60 },
      { budget_category_id: 1003, ratio: 40 },
    ]);

    expect(
      getDepreciationMonthlySourceAllocations(
        {
          method: "special",
          monthly_source_category_id: 1003,
        },
        categories,
        [{ budget_category_id: 1002, ratio: 100 }],
      ),
    ).toEqual([{ budget_category_id: 1003, ratio: 100 }]);
  });

  test("prorates and apportionment use currency minor units and the backend month tie break", () => {
    expect(
      calculateDepreciationMonthlyAmounts({
        totalAmount: 5,
        months: 3,
        purchaseDate: "2026-05-01",
        decimalPlaces: 0,
      }),
    ).toEqual([3, 1, 1]);

    expect(
      calculateBudgetedDepreciationMonthlyAmounts({
        monthlyAmounts: [1, 1, 1],
        budgetedPurchaseAmount: 1,
        depreciationTotal: 3,
        decimalPlaces: 0,
      }),
    ).toEqual([1, 0, 0]);
  });

  test("manual source amounts round-trip to stable ratios for JPY minor units", () => {
    const original = [
      { budget_category_id: 1002, ratio: 60 },
      { budget_category_id: 1003, ratio: 40 },
    ];
    const changed = [
      { budget_category_id: 1002, ratio: 40 },
      { budget_category_id: 1003, ratio: 60 },
    ];
    expect(
      splitDepreciationMonthlySourceAllocations(5, original).map((row) => row.amount),
    ).toEqual([3, 2]);
    expect(
      splitDepreciationMonthlySourceAllocations(5, changed).map((row) => row.amount),
    ).toEqual([2, 3]);
  });
});
