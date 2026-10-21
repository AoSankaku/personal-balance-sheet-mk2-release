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
  { id: 5, name: "Second tracked bank", type: "asset", category: "cash", include_in_allocatable: true },
  { id: 6, name: "Third bank", type: "asset", category: "cash", include_in_allocatable: true },
  { id: 7, name: "Excluded bank", type: "asset", category: "cash", include_in_allocatable: false },
].map(account => ({ ...account, created_at: "2026-01-01", balances: { JPY: 0 } })) as Account[];

mock.module(import.meta.resolve("../i18n/LangContext.tsx"), () => ({
  LangProvider: ({ children }: { children: unknown }) => children,
  useLang: () => ({ t: (key: string) => key, locale: "en" }),
}));
mock.module(import.meta.resolve("../context/AppDataContext.tsx"), () => ({
  useAppData: () => ({
    accounts,
    budgetCategories: [{ id: 10, name: "Investment reserve", target_accounts: [{ account_id: 6, ratio: 100 }] }],
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

  test("splits a transfer plan by the actual amounts received in multiple tracked banks", () => {
    const html = render({
      date: new Date(2026, 9, 21), description: "Investment sale",
      rows: [row(1, 60000, 0), row(5, 60000, 0), row(2, 0, 100000), row(3, 0, 20000)],
      incomeBudgetAllocs: { 10: 120000 },
      incomeTransferTargets: { 10: 6 },
    });
    expect(html).toContain("Tracked bank");
    expect(html).toContain("Second tracked bank");
    expect(html.match(/60,000/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("keeps stale allocations visible when the new deposit account has no budget capacity", () => {
    const html = render({
      date: new Date(2026, 9, 21), description: "Nontracked deposit",
      rows: [row(7, 0, 0), row(3, 0, 2000)],
      incomeBudgetAllocs: { 10: 2000 },
    });
    expect(html).toContain("multiline-income-budget");
    expect(html).toContain("incomeBudgetCapacityError");
  });

  test("keeps nontracked income reference allocations in the expense-side history", () => {
    const html = render({
      date: new Date(2026, 9, 21), description: "Excluded reward",
      rows: [row(7, 100, 0), row(3, 0, 100)],
      budgetAllocs: { 10: 100 },
    });
    expect(html).toContain("multiLineBudgetRatios");
    expect(html).not.toContain("multiline-income-budget");
  });
});
