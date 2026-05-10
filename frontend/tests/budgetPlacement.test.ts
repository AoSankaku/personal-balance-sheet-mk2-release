import { describe, expect, test } from "bun:test";

import {
  calculateBudgetPlacement,
  generateBudgetPlacementHints,
} from "../src/lib/budgetPlacement";

describe("calculateBudgetPlacement", () => {
  test("groups connected budget categories and accounts as one placement unit", () => {
    const result = calculateBudgetPlacement({
      accounts: [
        {
          id: 1,
          name: "Main bank",
          balance: 100_000,
          balances: { JPY: 100_000 },
          category: "cash",
          include_in_allocatable: true,
        },
        {
          id: 2,
          name: "Emergency bank",
          balance: 48,
          balances: { JPY: 48 },
          category: "cash",
          include_in_allocatable: true,
        },
      ],
      categorySummaries: [
        {
          category: {
            id: 10,
            name: "Free spending",
            target_accounts: [{ account_id: 1, ratio: 100 }],
          },
          available: 20_000,
        },
        {
          category: {
            id: 11,
            name: "Required spending",
            target_accounts: [{ account_id: 1, ratio: 100 }],
          },
          available: 50_000,
        },
        {
          category: {
            id: 12,
            name: "Travel reserve",
            target_accounts: [{ account_id: 1, ratio: 100 }],
          },
          available: 30_000,
        },
        {
          category: {
            id: 13,
            name: "Emergency savings",
            target_accounts: [
              { account_id: 1, ratio: 100 },
              { account_id: 2, ratio: 100 },
            ],
          },
          available: 48,
        },
      ],
      currency: "JPY",
    });

    expect(result.placementGroups).toEqual([
      {
        group_id: "a:1",
        account_ids: [1, 2],
        account_names: ["Main bank", "Emergency bank"],
        actual: 100_048,
        accounts: [
          { account_id: 1, account_name: "Main bank", amount: 100_000 },
          { account_id: 2, account_name: "Emergency bank", amount: 48 },
        ],
        expected: 100_048,
        difference: 0,
        categories: [
          {
            budget_category_id: 10,
            budget_category_name: "Free spending",
            amount: 20_000,
          },
          {
            budget_category_id: 11,
            budget_category_name: "Required spending",
            amount: 50_000,
          },
          {
            budget_category_id: 12,
            budget_category_name: "Travel reserve",
            amount: 30_000,
          },
          {
            budget_category_id: 13,
            budget_category_name: "Emergency savings",
            amount: 48,
          },
        ],
      },
    ]);
    expect(result.unplacedBudget).toBe(0);
  });

  test("keeps separate graphs in separate placement groups", () => {
    const result = calculateBudgetPlacement({
      accounts: [
        { id: 1, name: "Main bank", balance: 70_000, balances: { JPY: 70_000 } },
        {
          id: 2,
          name: "Investment bank",
          balance: 30_000,
          balances: { JPY: 30_000 },
        },
      ],
      categorySummaries: [
        {
          category: {
            id: 10,
            name: "Free spending",
            target_accounts: [{ account_id: 1, ratio: 100 }],
          },
          available: 20_000,
        },
        {
          category: {
            id: 11,
            name: "Required spending",
            target_accounts: [{ account_id: 1, ratio: 100 }],
          },
          available: 50_000,
        },
        {
          category: {
            id: 12,
            name: "Investment reserve",
            target_accounts: [{ account_id: 2, ratio: 100 }],
          },
          available: 30_000,
        },
      ],
      currency: "JPY",
    });

    expect(
      result.placementGroups.map((group) => ({
        account_ids: group.account_ids,
        expected: group.expected,
        actual: group.actual,
      })),
    ).toEqual([
      { account_ids: [1], expected: 70_000, actual: 70_000 },
      { account_ids: [2], expected: 30_000, actual: 30_000 },
    ]);
  });

  test("keeps budgets without target accounts as unplaced", () => {
    const result = calculateBudgetPlacement({
      accounts: [
        {
          id: 1,
          name: "Unlinked reserve account",
          balance: 3_200,
          balances: { JPY: 3_200 },
          category: "cash",
          include_in_allocatable: true,
        },
      ],
      categorySummaries: [
        {
          category: { id: 10, name: "Reserve", target_accounts: [] },
          available: 3_600,
        },
      ],
      currency: "JPY",
    });

    expect(result.placementGroups).toEqual([]);
    expect(result.unplacedBudget).toBe(3_600);
    expect(result.unplacedAccounts).toEqual([
      {
        account_id: 1,
        account_name: "Unlinked reserve account",
        amount: 3_200,
      },
    ]);
    expect(result.unplacedDifference).toBe(-400);
  });

  test("ignores non-cash or non-allocatable target accounts", () => {
    const result = calculateBudgetPlacement({
      accounts: [
        {
          id: 38,
          name: "NISA",
          balance: 232_164,
          balances: { JPY: 232_164 },
          category: "investment",
          include_in_allocatable: false,
        },
        {
          id: 59,
          name: "SBI hybrid deposit",
          balance: 537,
          balances: { JPY: 537 },
          category: "cash",
          include_in_allocatable: true,
        },
      ],
      categorySummaries: [
        {
          category: {
            id: 7,
            name: "Investment reserve",
            target_accounts: [
              { account_id: 38, ratio: 100 },
              { account_id: 59, ratio: 100 },
            ],
          },
          available: 32_700,
        },
      ],
      currency: "JPY",
    });

    expect(result.placementGroups).toHaveLength(1);
    expect(result.placementGroups[0]?.account_ids).toEqual([59]);
    expect(result.placementGroups[0]?.expected).toBe(32_700);
  });

  test("generates transfer and allocation hints from placement differences", () => {
    const hints = generateBudgetPlacementHints({
      placementGroups: [
        {
          group_id: "a:1",
          account_ids: [1],
          account_names: ["Main bank"],
          actual: 60_000,
          accounts: [{ account_id: 1, account_name: "Main bank", amount: 60_000 }],
          expected: 50_000,
          difference: 10_000,
          categories: [
            {
              budget_category_id: 10,
              budget_category_name: "Free spending",
              amount: 50_000,
            },
          ],
        },
        {
          group_id: "a:2",
          account_ids: [2],
          account_names: ["Travel bank"],
          actual: 20_000,
          accounts: [
            { account_id: 2, account_name: "Travel bank", amount: 20_000 },
          ],
          expected: 27_000,
          difference: -7_000,
          categories: [
            {
              budget_category_id: 20,
              budget_category_name: "Travel reserve",
              amount: 27_000,
            },
          ],
        },
      ],
      unplacedBudget: 3_600,
      unplacedAccounts: [
        {
          account_id: 3,
          account_name: "Tax reserve bank",
          amount: 3_200,
        },
      ],
      unplacedDifference: -400,
    });

    expect(hints).toEqual([
      {
        type: "move_cash",
        amount: 7_000,
        from: "Main bank",
        to: "Travel bank",
      },
      {
        type: "allocate_budget",
        amount: 3_000,
        target: "Free spending",
      },
      {
        type: "link_or_adjust_unplaced",
        amount: -400,
        target: "Tax reserve bank / unplaced budgets",
      },
    ]);
  });
});
