import { describe, expect, test } from "bun:test";
import { budgetAccountDelta, sumBudgetResourceBalances } from "./budgetScope";

describe("budget net resources", () => {
  const accounts = [
    { id: 1, type: "asset", category: "cash", balances: { JPY: 10000, USD: 100 } },
    { id: 2, type: "asset", category: "cash", include_in_allocatable: false, balances: { JPY: 3000 } },
    { id: 3, type: "liability", category: "credit_card", balances: { JPY: 3000, USD: 25 } },
    { id: 4, type: "liability", category: "long_term_loan", deduct_from_budget: false, balances: { JPY: 50000 } },
  ];
  test("subtracts selected debts without admitting excluded cash", () => {
    expect(sumBudgetResourceBalances(accounts, "JPY")).toBe(7000);
    expect(sumBudgetResourceBalances(accounts, "USD")).toBe(75);
    expect(sumBudgetResourceBalances(accounts.map((a) => a.id === 4 ? { ...a, deduct_from_budget: true } : a), "JPY")).toBe(-43000);
  });
  test("card settlement changes neither total resources nor budget principal", () => {
    expect(budgetAccountDelta([
      { account_id: 3, debit: 3000, credit: 0 },
      { account_id: 1, debit: 0, credit: 3000 },
    ], accounts, "JPY")).toBe(0);
  });
  test("keeps excluded receipt and later deposit distinct", () => {
    expect(budgetAccountDelta([{ account_id: 2, debit: 3000, credit: 0 }], accounts, "JPY")).toBe(0);
    expect(budgetAccountDelta([{ account_id: 2, debit: 0, credit: 3000 }, { account_id: 1, debit: 3000, credit: 0 }], accounts, "JPY")).toBe(3000);
  });
});
