import { describe, expect, test } from "bun:test";
import {
  buildIncomeBudgetSubmissionFields,
  buildLoanBudgetSubmissionFields,
} from "./SimpleEntryForm";

describe("simple-entry budget-scope payloads", () => {
  test("does not submit stale income allocations after an excluded deposit is selected", () => {
    const fields = buildIncomeBudgetSubmissionFields({
      canAllocateIncome: false,
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
    expect(fields.income_transfer_destinations).toBeUndefined();
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
      canAllocateIncome: true,
      incomeBudgetAllocations: allocations,
      incomeTransferDestinations: destinations,
    });

    expect(fields.income_budget_allocations).toBe(allocations);
    expect(fields.income_transfer_destinations).toBe(destinations);
  });

  test("omits all loan-funding and settlement metadata when a card participates", () => {
    expect(
      buildLoanBudgetSubmissionFields({ creditCardInvolved: true }),
    ).toEqual({});
  });
});
