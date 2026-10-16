import { describe, expect, test } from "bun:test";
import type { Account, CreateJournalLineInput } from "@balance-sheet/shared";
import { calculateMultiLineBudgetFundingImpact } from "./multiLineBudgetFunding";

function account(
  id: number,
  type: Account["type"],
  category: Account["category"],
  extra: Partial<Account> = {},
): Account {
  return {
    id,
    name: `account-${id}`,
    type,
    category,
    balance: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function borrowLines(): CreateJournalLineInput[] {
  return [
    { account_id: 1, debit: 1_000, credit: 0, currency: "JPY" },
    { account_id: 2, debit: 0, credit: 1_000, currency: "JPY" },
  ];
}

describe("multi-line loan budget funding impact", () => {
  test("borrowing against a non-deducted liability funds the received cash", () => {
    const impact = calculateMultiLineBudgetFundingImpact({
      lines: borrowLines(),
      accounts: [
        account(1, "asset", "cash", { include_in_allocatable: true }),
        account(2, "liability", "long_term_loan", {
          deduct_from_budget: false,
        }),
      ],
      currency: "JPY",
    });

    expect(impact.allocatable_asset_delta).toBe(1_000);
    expect(impact.components).toEqual([
      {
        kind: "borrow",
        principal_amount: 1_000,
        applied_amount: 1_000,
        component_only_amount: 0,
      },
    ]);
  });

  test("deducted borrowing is recorded as component-only principal", () => {
    const impact = calculateMultiLineBudgetFundingImpact({
      lines: borrowLines(),
      accounts: [
        account(1, "asset", "cash", { include_in_allocatable: true }),
        account(2, "liability", "long_term_loan", {
          deduct_from_budget: true,
        }),
      ],
      currency: "JPY",
    });

    expect(impact.allocatable_asset_delta).toBe(0);
    expect(impact.components).toEqual([
      {
        kind: "borrow",
        principal_amount: 1_000,
        applied_amount: 0,
        component_only_amount: 1_000,
      },
    ]);
  });

  test("credit-card charges do not create loan funding principal", () => {
    const impact = calculateMultiLineBudgetFundingImpact({
      lines: borrowLines(),
      accounts: [
        account(1, "asset", "cash", { include_in_allocatable: true }),
        account(2, "liability", "credit_card"),
      ],
      currency: "JPY",
    });

    expect(impact.components).toEqual([]);
  });
});
