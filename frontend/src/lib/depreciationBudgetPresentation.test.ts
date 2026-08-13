import { describe, expect, test } from "bun:test";
import type { BudgetSummary } from "@balance-sheet/shared";
import { summarizeDepreciationBudget } from "./depreciationBudgetPresentation";

function summary(
  overrides: Partial<BudgetSummary> = {},
): BudgetSummary {
  return {
    year_month: "2026-08",
    currency: "JPY",
    monthly_income: 0,
    categories: [],
    total_budget: 0,
    total_spent: 0,
    total_available: 0,
    ...overrides,
  };
}

describe("summarizeDepreciationBudget", () => {
  test("keeps post-reset depreciation visible when the purchase reserve is zero", () => {
    const result = summarizeDepreciationBudget(
      summary({
        total_depreciation_reserve: 0,
        total_depreciation_non_cash_offset: 25_834,
        categories: [
          {
            category: { id: 1, name: "Furniture" } as never,
            budget_base: 0,
            carryover: 0,
            total_budget: 0,
            spent: 5_167,
            depreciation_spent: 5_167,
            available: -5_167,
            months_with_contributions: 0,
          },
        ],
      }),
    );

    expect(result.hasActivity).toBe(true);
    expect(result.activePurchaseReserve).toBe(0);
    expect(result.recognizedThisMonth).toBe(5_167);
    expect(result.postResetNonCashOffset).toBe(25_834);
    expect(result.status).toBe("post_reset");
  });

  test("shows an active purchase reservation before it is exhausted", () => {
    const result = summarizeDepreciationBudget(
      summary({ total_depreciation_reserve: 304_833 }),
    );

    expect(result.hasActivity).toBe(true);
    expect(result.status).toBe("active");
  });

  test("stays hidden when there is no depreciation activity", () => {
    expect(summarizeDepreciationBudget(summary()).hasActivity).toBe(false);
  });
});
