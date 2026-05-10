import { describe, expect, test } from "bun:test";

import {
  buildTransferBudgetAdjustments,
  getTransferBudgetCategoryOptions,
} from "../src/lib/transferBudgetMovement";

const categories = [
  {
    id: 1,
    name: "Free spending",
    sort_order: 0,
    target_accounts: [{ account_id: 10, ratio: 100 }],
  },
  {
    id: 2,
    name: "Required spending",
    sort_order: 1,
    target_accounts: [{ account_id: 10, ratio: 100 }],
  },
  {
    id: 3,
    name: "Emergency savings",
    sort_order: 2,
    target_accounts: [
      { account_id: 10, ratio: 100 },
      { account_id: 11, ratio: 100 },
    ],
  },
  {
    id: 4,
    name: "Investment reserve",
    sort_order: 3,
    target_accounts: [{ account_id: 20, ratio: 100 }],
  },
];

describe("getTransferBudgetCategoryOptions", () => {
  test("returns categories in the connected budget-account group for each transfer account", () => {
    expect(
      getTransferBudgetCategoryOptions({
        budgetCategories: categories,
        fromAccountId: 11,
        toAccountId: 20,
      }),
    ).toEqual({
      sourceOptions: [
        { value: "1", label: "Free spending" },
        { value: "2", label: "Required spending" },
        { value: "3", label: "Emergency savings" },
      ],
      destinationOptions: [{ value: "4", label: "Investment reserve" }],
    });
  });

  test("returns no destination options when the transfer destination has no budget target", () => {
    expect(
      getTransferBudgetCategoryOptions({
        budgetCategories: categories,
        fromAccountId: 20,
        toAccountId: 99,
      }),
    ).toEqual({
      sourceOptions: [{ value: "4", label: "Investment reserve" }],
      destinationOptions: [],
    });
  });
});

describe("buildTransferBudgetAdjustments", () => {
  test("moves budget from one category to another", () => {
    expect(
      buildTransferBudgetAdjustments({
        amount: 50_000,
        sourceBudgetCategoryId: 3,
        destinationBudgetCategoryId: 4,
      }),
    ).toEqual([
      { budget_category_id: 3, amount: -50_000, adjustment_type: "transfer" },
      { budget_category_id: 4, amount: 50_000, adjustment_type: "transfer" },
    ]);
  });

  test("consumes budget when no destination category is selected", () => {
    expect(
      buildTransferBudgetAdjustments({
        amount: 50_000,
        sourceBudgetCategoryId: 4,
        destinationBudgetCategoryId: null,
      }),
    ).toEqual([
      { budget_category_id: 4, amount: -50_000, adjustment_type: "transfer" },
    ]);
  });

  test("does not create an adjustment when source and destination are the same category", () => {
    expect(
      buildTransferBudgetAdjustments({
        amount: 50_000,
        sourceBudgetCategoryId: 4,
        destinationBudgetCategoryId: 4,
      }),
    ).toEqual([]);
  });
});
