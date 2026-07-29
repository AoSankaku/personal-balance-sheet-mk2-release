import { describe, expect, test } from "bun:test";
import type { Account } from "@balance-sheet/shared";
import {
  calculateBudgetFundingImpact,
  splitAmountByLargestRemainder,
} from "../src/lib/budgetFundingImpact";

function account(
  id: number,
  type: Account["type"],
  category: Account["category"],
  includeInAllocatable = true,
): Account {
  return {
    id,
    name: `Account ${id}`,
    type,
    category,
    currency: "JPY",
    include_in_allocatable: includeInAllocatable,
    is_depreciable: false,
    created_at: "2026-07-01 00:00:00",
  };
}

const accounts = [
  account(1, "asset", "cash"),
  account(2, "asset", "cash", false),
  account(10, "asset", "short_term_lending"),
  account(11, "liability", "short_term_loan"),
];

function impact(
  lines: Array<{
    account_id: number;
    debit: number;
    credit: number;
    currency?: string;
  }>,
) {
  return calculateBudgetFundingImpact({
    lines,
    accounts,
    currency: "JPY",
  });
}

describe("budget funding impact", () => {
  test("constrains a lending opening paid from allocatable cash", () => {
    expect(
      impact([
        { account_id: 10, debit: 50, credit: 0 },
        { account_id: 1, debit: 0, credit: 50 },
      ]),
    ).toMatchObject({
      allocatable_asset_delta: -50,
      components: [
        {
          kind: "lend",
          principal_amount: 50,
          applied_amount: 50,
          component_only_amount: 0,
        },
      ],
    });
  });

  test("does not constrain a lending opening paid from non-allocatable cash", () => {
    expect(
      impact([
        { account_id: 10, debit: 50, credit: 0 },
        { account_id: 2, debit: 0, credit: 50 },
      ]).components[0],
    ).toEqual({
      kind: "lend",
      principal_amount: 50,
      applied_amount: 0,
      component_only_amount: 50,
    });
  });

  test("restores only the collection received into allocatable cash", () => {
    expect(
      impact([
        { account_id: 1, debit: 30, credit: 0 },
        { account_id: 2, debit: 20, credit: 0 },
        { account_id: 10, debit: 0, credit: 50 },
      ]).components[0],
    ).toEqual({
      kind: "collect",
      principal_amount: 50,
      applied_amount: 30,
      component_only_amount: 20,
    });
  });

  test("retires a collection without restoring budget when received outside allocatable cash", () => {
    expect(
      impact([
        { account_id: 2, debit: 50, credit: 0 },
        { account_id: 10, debit: 0, credit: 50 },
      ]),
    ).toMatchObject({
      allocatable_asset_delta: 0,
      components: [
        {
          kind: "collect",
          principal_amount: 50,
          applied_amount: 0,
          component_only_amount: 50,
        },
      ],
    });
  });

  test("retires borrowing without reducing budget when repaid outside allocatable cash", () => {
    expect(
      impact([
        { account_id: 11, debit: 50, credit: 0 },
        { account_id: 2, debit: 0, credit: 50 },
      ]).components[0],
    ).toEqual({
      kind: "repay",
      principal_amount: 50,
      applied_amount: 0,
      component_only_amount: 50,
    });
  });

  test("ignores other asset exchanges and other currencies", () => {
    expect(
      impact([
        { account_id: 1, debit: 100, credit: 0, currency: "USD" },
        { account_id: 2, debit: 0, credit: 100, currency: "USD" },
      ]),
    ).toEqual({ allocatable_asset_delta: 0, components: [] });
  });
});

describe("largest remainder allocation", () => {
  test("keeps the exact smallest-unit total", () => {
    expect(
      splitAmountByLargestRemainder(10, [
        { key: "a", weight: 1 },
        { key: "b", weight: 1 },
        { key: "c", weight: 1 },
      ]),
    ).toEqual([
      { key: "a", amount: 4 },
      { key: "b", amount: 3 },
      { key: "c", amount: 3 },
    ]);
  });
});
