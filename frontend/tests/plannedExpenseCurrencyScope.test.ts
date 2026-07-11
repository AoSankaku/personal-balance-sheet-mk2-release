import { afterEach, describe, expect, test } from "bun:test";

import { api } from "../src/api/client";
import {
  buildPlannedExpenseInputOverride,
  categoriesForPlannedExpenseCurrency,
  plannedExpenseReferenceAmount,
  plannedExpenseJournalCurrency,
  preservePlannedExpensesAcrossCurrencies,
} from "../src/lib/plannedExpenseCurrency";

afterEach(() => {
  api.__testing.clearSessionCache();
});

describe("planned expense currency scope", () => {
  test("keeps rows from every currency visible", () => {
    const rows = [
      { id: 1, currency: "JPY" },
      { id: 2, currency: "USD" },
    ];

    expect(preservePlannedExpensesAcrossCurrencies(rows)).toEqual(rows);
  });

  test("filters category choices to the currency selected in the form", () => {
    const categories = [
      { id: 1, currency: "JPY" },
      { id: 2, currency: "USD" },
    ];

    expect(categoriesForPlannedExpenseCurrency(categories, "USD")).toEqual([
      { id: 2, currency: "USD" },
    ]);
  });

  test("converts a foreign amount into the selected reference currency", () => {
    const convert = (amount: number, from: string, to: string) =>
      from === "USD" && to === "JPY" ? amount * 150 : 0;

    expect(plannedExpenseReferenceAmount(20, "USD", "JPY", convert)).toBe(3000);
    expect(plannedExpenseReferenceAmount(20, "JPY", "JPY", convert)).toBeNull();
    expect(plannedExpenseReferenceAmount(20, "EUR", "JPY", convert)).toBeNull();
  });

  test("uses the planned source currency for the resulting journal", () => {
    expect(plannedExpenseJournalCurrency("USD", "JPY")).toBe("USD");
    expect(plannedExpenseJournalCurrency(undefined, "JPY")).toBe("JPY");
  });

  test("builds a converted input override only for a different currency", () => {
    const convert = (amount: number) => amount * 150;

    expect(
      buildPlannedExpenseInputOverride(20, "USD", "JPY", convert),
    ).toEqual({ inputAmount: 3000, inputCurrency: "JPY" });
    expect(
      buildPlannedExpenseInputOverride(20, "JPY", "JPY", convert),
    ).toBeNull();
  });

  test("rounds converted input to the target currency precision", () => {
    expect(
      buildPlannedExpenseInputOverride(1, "USD", "JPY", () => 149.6, 0),
    ).toEqual({ inputAmount: 150, inputCurrency: "JPY" });
    expect(
      buildPlannedExpenseInputOverride(1, "USD", "EUR", () => 1.234, 2),
    ).toEqual({ inputAmount: 1.23, inputCurrency: "EUR" });
  });

  test("adds currency to planned expense and category list requests", async () => {
    const originalFetch = globalThis.fetch;
    const requested: string[] = [];
    globalThis.fetch = (async (input) => {
      requested.push(String(input));
      return new Response("[]", {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      await api.plannedExpenses.list({ kind: "wishlist", currency: "USD" });
      await api.plannedExpenses.listCategories({
        kind: "wishlist",
        currency: "USD",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requested).toEqual([
      "/api/planned-expenses?kind=wishlist&currency=USD",
      "/api/planned-expenses/categories?kind=wishlist&currency=USD",
    ]);
  });
});
