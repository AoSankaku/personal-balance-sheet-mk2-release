import { describe, expect, test } from "bun:test";
import { calculateExpenseTagAmounts, matchesExpenseTags } from "./expenseTags";

const accounts = [{ id: 1, type: "expense" }, { id: 2, type: "asset" }, { id: 3, type: "income" }] as const;

describe("expense tag accounting defaults", () => {
  test("counts net expenses rather than all debits, and deducts refunds", () => {
    expect(calculateExpenseTagAmounts([
      { account_id: 1, debit: 1200, credit: 0 }, { account_id: 1, debit: 0, credit: 200 },
      { account_id: 2, debit: 5000, credit: 6000 }, { account_id: 3, debit: 500, credit: 500 },
    ], accounts)).toEqual([{ currency: "JPY", amount: 1000 }]);
  });
  test("keeps currencies separate and removes floating point addition artifacts", () => {
    expect(calculateExpenseTagAmounts([
      { account_id: 1, debit: 0.1, credit: 0, currency: "usd" },
      { account_id: 1, debit: 0.2, credit: 0, currency: "USD" },
      { account_id: 1, debit: 0.000000001, credit: 0, currency: "SOL" },
      { account_id: 1, debit: 1200, credit: 0, currency: "JPY" },
    ], accounts)).toEqual([{ currency: "JPY", amount: 1200 }, { currency: "SOL", amount: 0.000000001 }, { currency: "USD", amount: 0.3 }]);
  });
  test("allows negative net refunds and returns no fictional expense for a transfer", () => {
    expect(calculateExpenseTagAmounts([{ account_id: 1, debit: 0, credit: 500 }], accounts)).toEqual([{ currency: "JPY", amount: -500 }]);
    expect(calculateExpenseTagAmounts([{ account_id: 2, debit: 500, credit: 0 }], accounts)).toEqual([]);
    expect(calculateExpenseTagAmounts([{ account_id: null, debit: 500, credit: 0 }], accounts)).toEqual([]);
  });
  test("filters as a union without creating duplicate journals", () => {
    const entry = { expense_tags: [{ id: 1, name: "2026年秋旅行" }, { id: 2, name: "家族" }] };
    expect(matchesExpenseTags(entry, [])).toBe(true);
    expect(matchesExpenseTags(entry, [1, 2])).toBe(true);
    expect(matchesExpenseTags(entry, [3])).toBe(false);
    expect(matchesExpenseTags({}, [1])).toBe(false);
  });
});
