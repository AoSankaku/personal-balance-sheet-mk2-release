import { describe, expect, test } from "bun:test";
import { buildIncomeBudgetSubmissionFields } from "../lib/incomeBudgetScope";
import { buildLoanBudgetSubmissionFields } from "./SimpleEntryForm";

describe("simple-entry budget-scope payloads", () => {
  test("does not submit stale income allocations after an excluded deposit is selected", () => {
    const fields = buildIncomeBudgetSubmissionFields({
      destinationAccount: {
        id: 22,
        type: "asset",
        category: "cash",
        include_in_allocatable: false,
      },
      incomeBudgetAllocations: [{ budget_category_id: 4, amount: 3_000 }],
      incomeTransferDestinations: [
        {
          budget_category_id: 4,
          from_account_id: 20,
          to_account_id: 21,
          amount: 3_000,
          currency: "JPY",
        },
      ],
    });

    expect(fields.income_budget_allocations).toBeUndefined();
    expect(fields.income_transfer_destinations).toEqual([]);
  });

  test("retains income allocations for a budget asset deposit", () => {
    const allocations = [{ budget_category_id: 4, amount: 3_000 }];
    const destinations = [
      {
        budget_category_id: 4,
        from_account_id: 20,
        to_account_id: 21,
        amount: 3_000,
        currency: "JPY",
      },
    ];
    const fields = buildIncomeBudgetSubmissionFields({
      destinationAccount: {
        id: 20,
        type: "asset",
        category: "cash",
        include_in_allocatable: true,
      },
      incomeBudgetAllocations: allocations,
      incomeTransferDestinations: destinations,
    });

    expect(fields.income_budget_allocations).toBe(allocations);
    expect(fields.income_transfer_destinations).toBe(destinations);
  });

  test("retains card budget allocations while suppressing physical transfers", () => {
    const allocations = [{ budget_category_id: 4, amount: 3_000 }];
    const fields = buildIncomeBudgetSubmissionFields({
      destinationAccount: {
        id: 20,
        type: "liability",
        category: "credit_card",
        deduct_from_budget: true,
      },
      incomeBudgetAllocations: allocations,
      incomeTransferDestinations: [
        {
          budget_category_id: 4,
          from_account_id: 20,
          to_account_id: 21,
          amount: 3_000,
          currency: "JPY",
        },
      ],
    });

    expect(fields.income_budget_allocations).toBe(allocations);
    expect(fields.income_transfer_destinations).toEqual([]);
  });

  test("omits all loan-funding and settlement metadata when a card participates", () => {
    expect(
      buildLoanBudgetSubmissionFields({ creditCardInvolved: true }),
    ).toEqual({});
  });

  test("keeps component-only principal bookkeeping for an ordinary loan", () => {
    const fundingComponent = {
      kind: "borrow" as const,
      principal_amount: 1_000,
      applied_amount: 0,
      component_only_amount: 1_000,
      allocations: [
        {
          budget_category_id: null,
          amount: 1_000,
          currency: "JPY",
          effect: "component_only" as const,
        },
      ],
    };
    const fields = buildLoanBudgetSubmissionFields({
      creditCardInvolved: false,
      loanSettlementOpening: undefined,
      loanSettlementJournalEntryIds: undefined,
      budgetFunding: {
        kind: "borrow",
        principal_amount: 1_000,
        allocations: [{ budget_category_id: null, amount: 1_000 }],
      },
      budgetFundingComponents: [fundingComponent],
    });

    expect(fields.budget_funding_components).toEqual([fundingComponent]);
  });
});
