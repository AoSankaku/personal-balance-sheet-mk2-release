import { describe, expect, test } from "bun:test";

import {
  computeAllocatableBudget,
  isAllocatableCashAccount,
  sumBudgetClaims,
  sumAllocatableCashBalances,
} from "../src/lib/allocatableBudget";
import type { Account } from "@balance-sheet/shared";

function account(overrides: Partial<Account>): Account {
  return {
    id: overrides.id ?? 1,
    name: overrides.name ?? "Account",
    type: overrides.type ?? "asset",
    category: overrides.category ?? "cash",
    created_at: overrides.created_at ?? "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("allocatable budget cash balance", () => {
  test("includes only non-depreciable cash asset accounts", () => {
    const accounts: Account[] = [
      account({ id: 1, name: "Checking", category: "cash", balance: 100_000 }),
      account({ id: 2, name: "Wallet", category: "cash", balance: 5_000 }),
      account({ id: 3, name: "BTC", category: "crypto", balance: 2_000_000 }),
      account({
        id: 4,
        name: "Brokerage",
        category: "investment",
        balance: 300_000,
      }),
      account({
        id: 5,
        name: "Car",
        category: "property",
        balance: 800_000,
        is_depreciable: true,
      }),
      account({
        id: 6,
        name: "Loan",
        type: "liability",
        category: "loan",
        balance: 50_000,
      }),
    ];

    expect(sumAllocatableCashBalances(accounts, "JPY")).toBe(105_000);
  });

  test("uses the selected currency balance for cash accounts", () => {
    const accounts: Account[] = [
      account({
        id: 1,
        name: "JPY Bank",
        balances: { JPY: 100_000, USD: 0 },
      }),
      account({
        id: 2,
        name: "USD Bank",
        balances: { JPY: 0, USD: 250 },
      }),
      account({
        id: 3,
        name: "ETH",
        category: "crypto",
        balances: { JPY: 1_000_000, USD: 6_500 },
      }),
    ];

    expect(sumAllocatableCashBalances(accounts, "USD")).toBe(250);
  });

  test("excludes depreciable cash accounts defensively", () => {
    expect(
      isAllocatableCashAccount(
        account({ category: "cash", is_depreciable: true }),
      ),
    ).toBe(false);
  });

  test("excludes cash accounts that are not budget allocation sources", () => {
    expect(
      isAllocatableCashAccount(
        account({ category: "cash", include_in_allocatable: false }),
      ),
    ).toBe(false);
  });

  test("does not turn negative budget overruns into a second claim", () => {
    expect(sumBudgetClaims([100_000, -40_000, 0, 25_000])).toBe(125_000);
  });

  test("counts overspending once through the lower cash balance", () => {
    expect(computeAllocatableBudget(40_000, [30_000, 0])).toBe(10_000);
    expect(computeAllocatableBudget(20_000, [30_000, -20_000])).toBe(-10_000);
  });
});
