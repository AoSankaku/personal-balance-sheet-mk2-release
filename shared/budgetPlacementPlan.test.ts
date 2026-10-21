import { describe, expect, test } from "bun:test";
import * as placement from "../frontend/src/lib/budgetPlacement";

const plan = placement.generateBudgetPlacementPlan;
const account = (id: number, amount: number, currency = "JPY") => ({
  id, name: `Bank ${id}`, type: "asset", category: "cash", balances: { [currency]: amount },
});
const category = (id: number, available: number, ids: number[]) => ({
  category: { id, name: `Budget ${id}`, target_accounts: ids.map(account_id => ({ account_id, ratio: 1 })) }, available,
});

describe("current budget placement transfer plan", () => {
  test("nets interest and cross-account tax spending while leaving planned overspending", () => {
    const accounts = [account(1, 90), account(2, 49), account(3, 24), account(4, 31)];
    const categorySummaries = [category(1, -60, [1]), category(2, 125, [1]), category(3, 51, [2]), category(4, 20, [3]), category(5, 30, [4])];
    const result = plan({ accounts, categorySummaries, currency: "JPY", decimalPlaces: 0 });
    expect(result.transfers).toEqual([
      { from_account_id: 3, to_account_id: 2, amount: 2, currency: "JPY" },
      { from_account_id: 3, to_account_id: 1, amount: 2, currency: "JPY" },
      { from_account_id: 4, to_account_id: 1, amount: 1, currency: "JPY" },
    ]);
    expect(result.groups.map((g) => g.after_difference)).toEqual([-32, 0, 0, 0]);
    expect(result.total_difference).toBe(-32);
    expect(result.unfunded_overspending).toBe(60);
    const after = placement.calculateBudgetPlacement({ accounts: placement.applyBudgetPlacementTransfers(accounts, result.transfers, "JPY"), categorySummaries, currency: "JPY" });
    expect(after.placementGroups.map(g => g.difference)).toEqual([-32, 0, 0, 0]);
    expect(after.unfundedOverspending).toBe(60);
  });

  test("moves an unavoidable deficit to the overspending group without changing budget balances", () => {
    const result = plan({ accounts: [account(1, 100), account(2, 50)], categorySummaries: [category(1, -50, [1]), category(2, 100, [1]), category(3, 100, [2])], currency: "JPY", decimalPlaces: 0 });
    expect(result.transfers).toEqual([{ from_account_id: 1, to_account_id: 2, amount: 50, currency: "JPY" }]);
    expect(result.groups.map((g) => g.after_difference)).toEqual([-50, 0]);
  });

  test("uses only available cash and leaves a genuine funding shortage unresolved", () => {
    const result = plan({ accounts: [account(1, 10), account(2, 0)], categorySummaries: [category(1, 5, [1]), category(2, 20, [2])], currency: "JPY", decimalPlaces: 0 });
    expect(result.transfers).toEqual([{ from_account_id: 1, to_account_id: 2, amount: 5, currency: "JPY" }]);
    expect(result.total_difference).toBe(-15);
    expect(result.groups.map((g) => g.after_difference)).toEqual([0, -15]);
  });

  test("reserves unplaced budgets and never draws excluded accounts or foreign currency balances", () => {
    const result = plan({ accounts: [account(1, 0), account(2, 50), { ...account(3, 100), include_in_allocatable: false }, { ...account(4, 100), category: "investment" }, account(5, 500, "USD")], categorySummaries: [category(1, 30, [1]), category(2, 40, [])], currency: "JPY", decimalPlaces: 0 });
    expect(result.transfers).toEqual([{ from_account_id: 2, to_account_id: 1, amount: 10, currency: "JPY" }]);
    expect(result.total_difference).toBe(-20);
  });

  test("splits a grouped donor without overdrawing any of its accounts", () => {
    const result = plan({ accounts: [account(1, 3), account(2, 7), account(3, 0)], categorySummaries: [category(1, 2, [1, 2]), category(2, 8, [3])], currency: "JPY", decimalPlaces: 0 });
    expect(result.transfers.reduce((n, t) => n + t.amount, 0)).toBe(8);
    const after = placement.applyBudgetPlacementTransfers([account(1, 3), account(2, 7), account(3, 0)], result.transfers, "JPY");
    expect(after.every(a => a.balances!.JPY! >= 0)).toBe(true);
    expect(result.groups.map((g) => g.after_difference)).toEqual([0, 0]);
  });

  test("uses currency precision and reaches a fixed point after completion", () => {
    const input = { accounts: [account(1, 10.03, "USD"), account(2, 4.97, "USD")], categorySummaries: [category(1, 10, [1]), category(2, 5, [2])], currency: "USD", decimalPlaces: 2 };
    const result = plan(input);
    expect(result.transfers).toEqual([{ from_account_id: 1, to_account_id: 2, amount: 0.03, currency: "USD" }]);
    expect(plan({ ...input, accounts: placement.applyBudgetPlacementTransfers(input.accounts, result.transfers, "USD") }).transfers).toEqual([]);
  });

  test("deducts only budget liabilities in the selected currency, preserving credit balances", () => {
    const result = plan({
      accounts: [account(1, 70), { ...account(2, 10), type: "liability", category: "credit_card", deduct_from_budget: true }, { ...account(3, -2), type: "liability", category: "credit_card", deduct_from_budget: true }, { ...account(4, 100), type: "liability", category: "credit_card", deduct_from_budget: false }, { ...account(5, 500, "USD"), type: "liability", category: "credit_card", deduct_from_budget: true }],
      categorySummaries: [category(1, 100, [1])], currency: "JPY", decimalPlaces: 0,
    });
    expect(result.liabilities.map((a) => a.amount)).toEqual([10, -2]);
    expect(result.liability_total).toBe(8);
    expect(result.total_difference).toBe(-30);
    expect(result.adjusted_total_difference).toBe(-38);
  });

  test("simulating a transfer does not treat aggregate foreign balances as selected-currency cash", () => {
    const after = placement.applyBudgetPlacementTransfers([
      { ...account(1, 500, "USD"), balance: 500 }, account(2, 10),
    ], [{ from_account_id: 2, to_account_id: 1, amount: 10, currency: "JPY" }], "JPY");
    expect(after[0]!.balances).toEqual({ USD: 500, JPY: 10 });
    expect(after[1]!.balances!.JPY).toBe(0);
  });

  test("keeps conservation and a stable plan across varied balanced and underfunded cases", () => {
    for (let i = 1; i <= 100; i++) {
      const accounts = [account(1, (i * 17) % 97), account(2, (i * 31) % 83), account(3, (i * 23) % 61)];
      const categorySummaries = [category(1, -((i * 13) % 59), [1]), category(2, 50, [1]), category(3, 45, [2]), category(4, 40, [3])];
      const input = { accounts, categorySummaries, currency: "JPY", decimalPlaces: 0 };
      const result = plan(input);
      const moved = placement.applyBudgetPlacementTransfers(accounts, result.transfers, "JPY");
      expect(moved.reduce((s, a) => s + a.balances!.JPY!, 0)).toBe(accounts.reduce((s, a) => s + a.balances.JPY!, 0));
      expect(moved.every(a => a.balances!.JPY! >= 0)).toBe(true);
      const after = placement.calculateBudgetPlacement({ accounts: moved, categorySummaries, currency: "JPY" });
      expect(after.placementGroups.map(g => g.difference)).toEqual(result.groups.map((g) => g.after_difference));
      expect(plan({ ...input, accounts: moved }).transfers).toEqual([]);
    }
  });
});
