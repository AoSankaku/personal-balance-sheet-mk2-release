import { describe, expect, mock, test } from "bun:test";
import { MantineProvider } from "@mantine/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Account } from "@balance-sheet/shared";

const accounts = [
  { id: 1, name: "Main account", type: "asset", category: "cash", include_in_allocatable: true },
  { id: 2, name: "Business advance", type: "asset", category: "business_advance", include_in_allocatable: false },
  { id: 3, name: "Transport expense", type: "expense", category: "transport" },
  { id: 4, name: "Expense category", type: "expense", category: "other" },
  { id: 5, name: "Untracked cash", type: "asset", category: "cash", include_in_allocatable: false },
].map(account => ({ ...account, created_at: "2026-11-05", balances: { JPY: 0, USD: 0 } })) as Account[];

mock.module(import.meta.resolve("../i18n/LangContext.tsx"), () => ({
  LangProvider: ({ children }: { children: unknown }) => children,
  useLang: () => ({ t: (key: string) => key, locale: "en" }),
}));
mock.module(import.meta.resolve("../context/AppDataContext.tsx"), () => ({
  useAppData: () => ({
    accounts,
    budgetCategories: [{ id: 20, name: "Business budget", sort_order: 0, target_accounts: [] }],
    budgetSettings: {
      is_business_owner: true,
      business_advance_account_id: 2,
      business_advance_budget_category_id: 20,
      preferred_payment_account_ids: [1],
    },
    journal: [],
    displayCurrency: "JPY",
    displayCurrencySymbol: "¥",
    enabledCurrencies: [{ code: "JPY", decimal_places: 0 }],
    allocatableToday: 0,
  }),
}));
const { SimpleEntryForm } = await import("./SimpleEntryForm");
const { BusinessAdvanceProcessTab } = await import("./BusinessAdvanceProcessTab");

function renderSimple(businessRatio: number) {
  return renderToStaticMarkup(createElement(MantineProvider, null,
    createElement(SimpleEntryForm, {
      accounts,
      onSubmit: async () => {},
      initialDraft: {
        formValues: {
          entryType: "business_advance",
          expenseCategoryId: null,
          expensePaidFromId: 1,
          businessAdvanceAccountId: 2,
          businessRatio,
          amount: 2_000,
        },
        budgetDist: [],
        showZeroCategories: false,
      },
    }),
  ));
}

describe("business advance input", () => {
  test("adds a send-to-business mode with budget source guidance", () => {
    const html = renderToStaticMarkup(createElement(MantineProvider, null,
      createElement(BusinessAdvanceProcessTab, { onDone: () => {} }),
    ));
    expect(html.includes("businessAdvanceSendMode")).toBe(true);
    expect(html.includes("businessAdvanceSendFromLabel")).toBe(true);
    expect(html.includes("businessAdvanceBudgetSourceLabel")).toBe(true);
  });

  test("does not require or show a personal expense when business use is 100%", () => {
    const html = renderSimple(100);
    expect(html.includes("businessAdvanceSplitBusiness")).toBe(true);
    expect(html.includes("categoryLabel")).toBe(false);
  });

  test("keeps the expense account for a mixed personal and business purchase", () => {
    const html = renderSimple(75);
    expect(html.includes("categoryLabel")).toBe(true);
  });
});
