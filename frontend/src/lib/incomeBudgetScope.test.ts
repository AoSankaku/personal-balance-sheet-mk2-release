import { describe, expect, test } from "bun:test";
import { buildIncomeBudgetSubmissionFields } from "./incomeBudgetScope";

const allocation = [{ budget_category_id: 4, amount: 3_000 }];
const transfer = [
  {
    budget_category_id: 4,
    from_account_id: 20,
    to_account_id: 21,
    amount: 3_000,
    currency: "JPY",
  },
];

describe("income budget scope submission fields", () => {
  test.each([
    {
      label: "tracked cash asset",
      destinationAccount: {
        id: 1,
        type: "asset",
        category: "cash",
        include_in_allocatable: true,
      },
      allowAllocation: true,
      expectedTransfers: transfer,
    },
    {
      label: "excluded cash asset",
      destinationAccount: {
        id: 2,
        type: "asset",
        category: "cash",
        include_in_allocatable: false,
      },
      allowAllocation: false,
      expectedTransfers: [],
    },
    {
      label: "budget-deducted card liability",
      destinationAccount: {
        id: 3,
        type: "liability",
        category: "credit_card",
        deduct_from_budget: true,
      },
      allowAllocation: true,
      expectedTransfers: [],
    },
    {
      label: "excluded card liability",
      destinationAccount: {
        id: 4,
        type: "liability",
        category: "credit_card",
        deduct_from_budget: false,
      },
      allowAllocation: false,
      expectedTransfers: [],
    },
    {
      label: "explicitly included other liability",
      destinationAccount: {
        id: 5,
        type: "liability",
        category: "loan",
        deduct_from_budget: true,
      },
      allowAllocation: true,
      expectedTransfers: [],
    },
    {
      label: "missing destination account",
      destinationAccount: undefined,
      allowAllocation: false,
      expectedTransfers: [],
    },
  ])("applies eligibility rules to $label", ({
    destinationAccount,
    allowAllocation,
    expectedTransfers,
  }) => {
    const fields = buildIncomeBudgetSubmissionFields({
      destinationAccount,
      incomeBudgetAllocations: allocation,
      incomeTransferDestinations: transfer,
    });

    expect(fields.income_budget_allocations).toBe(
      allowAllocation ? allocation : undefined,
    );
    expect(fields.income_transfer_destinations).toEqual(
      expectedTransfers,
    );
  });

  test("explicitly clears stale physical transfer tasks for a deducted liability", () => {
    const fields = buildIncomeBudgetSubmissionFields({
      destinationAccount: {
        id: 6,
        type: "liability",
        category: "credit_card",
        deduct_from_budget: true,
      },
      incomeBudgetAllocations: allocation,
      incomeTransferDestinations: transfer,
    });

    expect(fields.income_budget_allocations).toBe(allocation);
    expect(fields.income_transfer_destinations).toEqual([]);
  });
});
