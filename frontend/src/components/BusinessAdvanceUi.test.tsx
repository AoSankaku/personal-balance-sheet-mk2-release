import { beforeEach, describe, expect, mock, test } from "bun:test";
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
let journalEntries: {
  id: number;
  date: string;
  description: string;
  created_at: string;
  lines: { account_id: number; debit: number; credit: number; currency: string }[];
}[] = [];

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
    journal: journalEntries,
    displayCurrency: "USD",
    displayCurrencySymbol: "$",
    enabledCurrencies: [{ code: "USD", decimal_places: 2 }],
    allocatableToday: 0,
  }),
}));
const { SimpleEntryForm } = await import("./SimpleEntryForm");
const { BusinessAdvanceProcessTab } = await import("./BusinessAdvanceProcessTab");

beforeEach(() => {
  journalEntries = [];
});

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

  test("keeps same-day advance history balances chronological when API entries are newest first", () => {
    journalEntries = [
      {
        id: 102,
        date: "2026-11-04",
        description: "Recover funds",
        created_at: "2026-11-04T12:00:00.000Z",
        lines: [
          { account_id: 1, debit: 0.2, credit: 0, currency: "USD" },
          { account_id: 2, debit: 0, credit: 0.2, currency: "USD" },
        ],
      },
      {
        id: 101,
        date: "2026-11-04",
        description: "Send funds",
        created_at: "2026-11-04T11:00:00.000Z",
        lines: [
          { account_id: 2, debit: 0.3, credit: 0, currency: "USD" },
          { account_id: 1, debit: 0, credit: 0.3, currency: "USD" },
        ],
      },
    ];

    const html = renderToStaticMarkup(createElement(MantineProvider, null,
      createElement(BusinessAdvanceProcessTab, { onDone: () => {} }),
    ));
    const rows = [...html.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)]
      .map((match) => match[1] ?? "")
      .filter((row) => row.includes("Send funds") || row.includes("Recover funds"));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("Recover funds");
    expect(rows[0]).toContain("0.10");
    expect(rows[1]).toContain("Send funds");
    expect(rows[1]).toContain("0.30");
  });
});
