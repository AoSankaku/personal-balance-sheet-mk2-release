import { beforeAll, describe, expect, mock, test } from "bun:test";
import { MantineProvider } from "@mantine/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Account } from "@balance-sheet/shared";

const accounts = [
  { id: 1, name: "Tracked bank", type: "asset", category: "cash", include_in_allocatable: true },
  { id: 2, name: "Investment holding", type: "asset", category: "investment", include_in_allocatable: false },
  { id: 3, name: "Realized gain", type: "income", category: "investment" },
  { id: 4, name: "Expense", type: "expense", category: "other" },
].map(account => ({ ...account, created_at: "2026-01-01", balances: { JPY: 0 } })) as Account[];

mock.module(import.meta.resolve("../i18n/LangContext.tsx"), () => ({
  LangProvider: ({ children }: { children: unknown }) => children,
  useLang: () => ({ t: (key: string) => key, locale: "en" }),
}));
mock.module(import.meta.resolve("../context/AppDataContext.tsx"), () => ({
  useAppData: () => ({
    accounts,
    budgetCategories: [{ id: 10, name: "Investment reserve", target_accounts: [{ account_id: 1, ratio: 100 }] }],
    enabledCurrencies: [{ code: "JPY", decimal_places: 0 }],
    displayCurrency: "JPY", displayCurrencySymbol: "¥",
  }),
}));
const { MultiLineEntryForm } = await import("./MultiLineEntryForm");
const { setMultiDraft } = await import("../utils/inputDrafts");

beforeAll(() => {
  if (typeof globalThis.localStorage === "undefined") Object.defineProperty(globalThis, "localStorage", {
    configurable: true, value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  });
});
function render(initialValues?: Parameters<typeof MultiLineEntryForm>[0]["initialValues"]) {
  return renderToStaticMarkup(createElement(MantineProvider, null,
    createElement(MultiLineEntryForm, { onSubmit: async () => {}, initialValues }),
  ));
}
const row = (account_id: number, debit: number, credit: number) => ({
  account_id, debit, credit, creditCardStatementOffsetMonths: 0,
});

describe("compound income budget controls", () => {
  test("an investment sale exposes income/principal allocation instead of expense reduction", () => {
    const html = render({
      date: new Date(2026, 9, 21), description: "Investment sale",
      rows: [row(1, 120000, 0), row(2, 0, 100000), row(3, 0, 20000)],
      budgetAllocs: { 10: 120000 },
    });
    expect(html).toContain("multiLineIncomeBudgetTitle");
    expect(html).toContain("multiLineInvestmentReturnHint");
    expect(html).not.toContain("multiLineBudgetRatios");
  });

  test("a compound receipt with a fee exposes separate income and expense controls", () => {
    const html = render({
      date: new Date(2026, 9, 21), description: "Receipt with fee",
      rows: [row(1, 19800, 0), row(4, 200, 0), row(3, 0, 20000)],
      budgetAllocs: { 10: -200 },
    });
    expect(html).toContain("multiLineIncomeBudgetTitle");
    expect(html).toContain("multiLineBudgetRatios");
  });

  test("new compound entries offer investment-sale assisted input", () => {
    setMultiDraft(null);
    expect(render()).toContain("investmentSaleInputTitle");
  });
});
