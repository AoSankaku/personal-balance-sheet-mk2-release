import { describe, expect, test } from "bun:test";
import {
  buildBudgetFundingAllocations,
  fundingKindForLoanDirection,
  suggestLendingFundingSplit,
} from "../src/lib/budgetFundingAllocation";

describe("explicit budget funding allocations", () => {
  test("stores the category split and unallocated remainder explicitly", () => {
    expect(
      buildBudgetFundingAllocations(50, new Map([[10, 10]])),
    ).toEqual([
      { budget_category_id: 10, amount: 10 },
      { budget_category_id: null, amount: 40 },
    ]);
  });

  test("rejects category allocations above the principal", () => {
    expect(() =>
      buildBudgetFundingAllocations(50, new Map([[10, 60]])),
    ).toThrow("budget_funding_allocations_exceed_principal");
  });

  test("compares decimal allocations in minor units without floating-point over-allocation", () => {
    expect(buildBudgetFundingAllocations(0.3, new Map([[10, 0.1], [20, 0.2]]), 2)).toEqual([
      { budget_category_id: 10, amount: 0.1 }, { budget_category_id: 20, amount: 0.2 },
    ]);
    expect(buildBudgetFundingAllocations(0.3, new Map([[10, 0.1]]), 2)).toEqual([
      { budget_category_id: 10, amount: 0.1 }, { budget_category_id: null, amount: 0.2 },
    ]);
    expect(() => buildBudgetFundingAllocations(0.3, new Map([[10, 0.31]]), 2)).toThrow();
    expect(buildBudgetFundingAllocations(1, new Map([[10, 0.1]]), 0)).toEqual([
      { budget_category_id: null, amount: 1 },
    ]);
  });

  test("maps every loan direction to a funding kind", () => {
    expect(fundingKindForLoanDirection("increase")).toBe("borrow");
    expect(fundingKindForLoanDirection("decrease")).toBe("repay");
    expect(fundingKindForLoanDirection("lend")).toBe("lend");
    expect(fundingKindForLoanDirection("collect")).toBe("collect");
  });

  test("suggests only the portion not covered by current unallocated cash", () => {
    expect(suggestLendingFundingSplit(50, 40)).toEqual({
      absorbedByUnallocated: 40,
      suggestedCategoryConstraint: 10,
    });
  });
});
