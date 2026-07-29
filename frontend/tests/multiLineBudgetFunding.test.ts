import { describe, expect, test } from "bun:test";
import { buildFundingComponentInput } from "../src/lib/multiLineBudgetFunding";

describe("multi-line funding smallest-unit allocation", () => {
  test("uses largest remainders and preserves foreign-currency totals", () => {
    const component = buildFundingComponentInput({
      component: {
        kind: "collect",
        principal_amount: 0.05,
        applied_amount: 0.03,
        component_only_amount: 0.02,
      },
      appliedAmount: 0.03,
      categoryAmounts: { 1: 0.02, 2: 0.03 },
      currency: "USD",
      decimalPlaces: 2,
    });

    expect(component.allocations).toEqual([
      {
        budget_category_id: 1,
        amount: 0.01,
        currency: "USD",
        effect: "apply",
        source_journal_entry_id: null,
      },
      {
        budget_category_id: 1,
        amount: 0.01,
        currency: "USD",
        effect: "component_only",
        source_journal_entry_id: null,
      },
      {
        budget_category_id: 2,
        amount: 0.02,
        currency: "USD",
        effect: "apply",
        source_journal_entry_id: null,
      },
      {
        budget_category_id: 2,
        amount: 0.01,
        currency: "USD",
        effect: "component_only",
        source_journal_entry_id: null,
      },
    ]);
  });
});
