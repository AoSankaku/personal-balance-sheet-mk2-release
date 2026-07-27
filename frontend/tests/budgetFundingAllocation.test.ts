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
