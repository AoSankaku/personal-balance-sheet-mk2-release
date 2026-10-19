import { describe, expect, test } from "bun:test";
import {
  DEPRECIATION_BUDGET_METHOD_ORDER,
  getDepreciationBudgetFormErrors,
  wouldOverdrawDepreciationPurchaseCategory,
} from "./depreciationBudgetForm";

describe("depreciation budget form rules", () => {
  test("presents assigned, special, and unallocated choices in the specified order", () => {
    expect(DEPRECIATION_BUDGET_METHOD_ORDER).toEqual([
      "assigned",
      "special",
      "unallocated",
    ]);
  });

  test("requires distinct purchase and monthly-source categories for assigned funding", () => {
    expect(
      getDepreciationBudgetFormErrors({
        method: "assigned",
        purchaseCategoryId: 4,
        monthlySourceCategoryId: 4,
      }),
    ).toEqual({ monthlySourceCategory: "must_differ" });

    expect(
      getDepreciationBudgetFormErrors({
        method: "assigned",
        purchaseCategoryId: null,
        monthlySourceCategoryId: null,
      }),
    ).toEqual({
      purchaseCategory: "required",
      monthlySourceCategory: "required",
    });
  });

  test("requires a monthly source for special funding but no purchase category", () => {
    expect(
      getDepreciationBudgetFormErrors({
        method: "special",
        purchaseCategoryId: null,
        monthlySourceCategoryId: null,
      }),
    ).toEqual({ monthlySourceCategory: "required" });

    expect(
      getDepreciationBudgetFormErrors({
        method: "special",
        purchaseCategoryId: null,
        monthlySourceCategoryId: 8,
      }),
    ).toEqual({});
  });

  test("requires explicit confirmation for unallocated funding", () => {
    expect(
      getDepreciationBudgetFormErrors({
        method: "unallocated",
        purchaseCategoryId: null,
        monthlySourceCategoryId: null,
        confirmUnallocated: false,
      }),
    ).toEqual({ confirmUnallocated: "required" });

    expect(
      getDepreciationBudgetFormErrors({
        method: "unallocated",
        purchaseCategoryId: null,
        monthlySourceCategoryId: null,
        confirmUnallocated: true,
      }),
    ).toEqual({});
  });

  test("warns when an assigned purchase would make its category negative", () => {
    expect(wouldOverdrawDepreciationPurchaseCategory(3_000, 3_001)).toBe(true);
    expect(wouldOverdrawDepreciationPurchaseCategory(3_000, 3_000)).toBe(false);
    expect(wouldOverdrawDepreciationPurchaseCategory(-500, 100)).toBe(true);
  });

  test("accepts multiple monthly sources without requiring a legacy single category", () => {
    const input = {
      method: "assigned",
      purchaseCategoryId: 4,
      monthlySourceCategoryId: null,
      monthlySourceAllocations: [
        { budget_category_id: 8, ratio: 37.5 },
        { budget_category_id: 9, ratio: 62.5 },
      ],
    } as Parameters<typeof getDepreciationBudgetFormErrors>[0];
    expect(getDepreciationBudgetFormErrors(input)).toEqual({});
  });

  test("checks every monthly source against the purchase destination", () => {
    const input = {
      method: "assigned",
      purchaseCategoryId: 4,
      monthlySourceCategoryId: 8,
      monthlySourceAllocations: [
        { budget_category_id: 8, ratio: 50 },
        { budget_category_id: 4, ratio: 50 },
      ],
    } as Parameters<typeof getDepreciationBudgetFormErrors>[0];
    expect(getDepreciationBudgetFormErrors(input)).toEqual({
      monthlySourceCategory: "must_differ",
    });
  });

  test("requires explicit consent when any monthly share uses unallocated funds", () => {
    const input = {
      method: "special",
      purchaseCategoryId: null,
      monthlySourceCategoryId: 8,
      monthlySourceAllocations: [
        { budget_category_id: 8, ratio: 75 },
        { budget_category_id: null, ratio: 25 },
      ],
      confirmMonthlyUnallocated: false,
    } as Parameters<typeof getDepreciationBudgetFormErrors>[0];
    expect(getDepreciationBudgetFormErrors(input)).toEqual({
      confirmMonthlyUnallocated: "required",
    });
  });

  test("does not silently normalize an excessive monthly source allocation", () => {
    const input = {
      method: "special",
      purchaseCategoryId: null,
      monthlySourceCategoryId: 8,
      monthlySourceAllocations: [
        { budget_category_id: 8, ratio: 80 },
        { budget_category_id: 9, ratio: 30 },
      ],
    } as Parameters<typeof getDepreciationBudgetFormErrors>[0];
    expect(getDepreciationBudgetFormErrors(input)).toEqual({
      monthlySourceAllocations: "invalid",
    });
  });
});
