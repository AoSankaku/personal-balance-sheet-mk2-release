import { describe, expect, mock, test } from "bun:test";
import { MantineProvider } from "@mantine/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Account, JournalEntry } from "@balance-sheet/shared";
import { buildSimpleEntryLines } from "../lib/simpleEntryUtils";

const accounts = [
  { id: 1, name: "Credit card", type: "liability", category: "credit_card" },
  { id: 2, name: "ICOCA", type: "asset", category: "cash", include_in_allocatable: false },
  { id: 3, name: "Bank", type: "asset", category: "cash", include_in_allocatable: true },
  { id: 4, name: "Loan", type: "liability", category: "short_term_loan" },
  { id: 5, name: "Opening balance", type: "equity", category: "opening_balance" },
  { id: 6, name: "Transport", type: "expense", category: "transport" },
  { id: 7, name: "Salary", type: "income", category: "salary" },
  { id: 8, name: "Business advance", type: "asset", category: "business_advance" },
  { id: 9, name: "Legacy advance", type: "asset", category: "other" },
].map(account => ({ ...account, created_at: "2026-11-05" })) as Account[];

const budgetCategories = [
  { id: 101, name: "Daily budget", sort_order: 0, target_accounts: [{ account_id: 3, ratio: 100 }] },
  { id: 102, name: "Travel reserve", sort_order: 1, target_accounts: [] },
];

mock.module(import.meta.resolve("../i18n/LangContext.tsx"), () => ({
  LangProvider: ({ children }: { children: unknown }) => children,
  useLang: () => ({ t: (key: string) => key, locale: "en" }),
}));
mock.module(import.meta.resolve("../context/AppDataContext.tsx"), () => ({
  useAppData: () => ({
    accounts,
    budgetCategories,
    journal: [],
    enabledCurrencies: [{ code: "JPY", decimal_places: 0 }],
    displayCurrency: "JPY",
    displayCurrencySymbol: "¥",
    allocatableToday: 0,
  }),
}));
const { SimpleEntryForm } = await import("./SimpleEntryForm");
const { detectSimpleEntry } = await import("./JournalModal");

function entry(fromId: number, toId = 2, offset?: number): JournalEntry {
  return {
    id: 10,
    date: "2026-11-05",
    description: "ICOCA charge",
    created_at: "2026-11-05",
    lines: [
      { id: 11, journal_entry_id: 10, account_id: toId, account_name: accounts.find(a => a.id === toId)!.name, debit: 3_000, credit: 0, currency: "JPY" },
      { id: 12, journal_entry_id: 10, account_id: fromId, account_name: accounts.find(a => a.id === fromId)!.name, debit: 0, credit: 3_000, currency: "JPY", credit_card_billing_offset_months: offset },
    ],
  };
}

function renderTransfer(fromId: number, offset = 0, sourceBudgetCategoryId: number | null = null) {
  return renderToStaticMarkup(createElement(MantineProvider, null,
    createElement(SimpleEntryForm, {
      accounts,
      onSubmit: async () => {},
      initialDraft: {
        formValues: { entryType: "transfer", transferFromId: fromId, transferToId: 2, amount: 3_000, creditCardStatementOffsetMonths: offset, transferBudgetSourceCategoryId: sourceBudgetCategoryId },
        budgetDist: [],
        showZeroCategories: false,
      },
    }),
  ));
}

describe("simple credit card transfers", () => {
  test("displays a selected budget source even though the card has no holding-account group", () => {
    expect(renderTransfer(1, 0, 102)).toContain('value="Travel reserve"');
  });

  test("keeps budget movement optional for a new card transfer", () => {
    expect(renderTransfer(1)).not.toContain('value="Travel reserve"');
    expect(renderTransfer(1)).toContain("transferBudgetNoMovementPlaceholder");
  });

  test("offers a card as the transfer source and excluded cash as the destination", () => {
    const html = renderTransfer(1);
    expect(html.includes('value="Credit card"')).toBe(true);
    expect(html.includes('value="ICOCA"')).toBe(true);
  });

  test("shows the billing offset control for card charges only", () => {
    expect(renderTransfer(1, 2).includes("creditCardStatementOffsetLabel")).toBe(true);
    expect(renderTransfer(3).includes("creditCardStatementOffsetLabel")).toBe(false);
  });

  test("increases ICOCA assets and card debt without recording an expense", () => {
    expect(buildSimpleEntryLines({
      debitAccountId: 2, creditAccountId: 1, amount: 3_000, accounts,
      creditCardStatementOffsetMonths: 2,
    })).toEqual([
      { account_id: 2, debit: 3_000, credit: 0 },
      { account_id: 1, debit: 0, credit: 3_000, credit_card_billing_offset_months: 2 },
    ]);
  });

  test("does not attach a stale card billing offset to a bank transfer", () => {
    expect(buildSimpleEntryLines({
      debitAccountId: 2, creditAccountId: 3, amount: 3_000, accounts,
      creditCardStatementOffsetMonths: 2,
    })).toEqual([
      { account_id: 2, debit: 3_000, credit: 0 },
      { account_id: 3, debit: 0, credit: 3_000 },
    ]);
  });

  test("preserves billing offsets for existing card expenses", () => {
    expect(buildSimpleEntryLines({
      debitAccountId: 6, creditAccountId: 1, amount: 3_000, accounts,
      creditCardStatementOffsetMonths: 1,
    })).toEqual([
      { account_id: 6, debit: 3_000, credit: 0 },
      { account_id: 1, debit: 0, credit: 3_000, credit_card_billing_offset_months: 1 },
    ]);
    expect(detectSimpleEntry(entry(1, 6, 1), accounts)).toMatchObject({
      entryType: "expense", expenseCategoryId: 6, expensePaidFromId: 1,
      creditCardStatementOffsetMonths: 1,
    });
  });

  test("keeps income deposits free of card billing metadata", () => {
    expect(buildSimpleEntryLines({
      debitAccountId: 3, creditAccountId: 7, amount: 3_000, accounts,
      creditCardStatementOffsetMonths: 2,
    })).toEqual([
      { account_id: 3, debit: 3_000, credit: 0 },
      { account_id: 7, debit: 0, credit: 3_000 },
    ]);
  });

  test("reopens a card charge as a transfer and preserves its billing offset", () => {
    expect(detectSimpleEntry(entry(1, 2, 2), accounts)).toMatchObject({
      entryType: "transfer", transferFromId: 1, transferToId: 2,
      amount: 3_000, creditCardStatementOffsetMonths: 2,
    });
  });

  test("treats a card charge into tracked cash as a transfer too", () => {
    expect(detectSimpleEntry(entry(1, 3), accounts)).toMatchObject({
      entryType: "transfer", transferFromId: 1, transferToId: 3,
      creditCardStatementOffsetMonths: 0,
    });
  });

  test("keeps normal asset transfers and opening balances editable", () => {
    for (const fromId of [3, 5]) {
      expect(detectSimpleEntry(entry(fromId), accounts)).toMatchObject({
        entryType: "transfer", transferFromId: fromId, transferToId: 2,
      });
    }
  });

  test("keeps ordinary borrowing in the loan form", () => {
    expect(detectSimpleEntry(entry(4), accounts)).toMatchObject({
      entryType: "loan", loanDirection: "increase", loanAccountId: 4,
      loanCounterAccountId: 2,
    });
  });

  test("restores the saved business funding category instead of the settings default", () => {
    const saved = entry(3, 8);
    saved.budget_allocations = [{ budget_category_id: 42, amount: -3000 }];
    expect(detectSimpleEntry(saved, accounts)).toMatchObject({
      entryType: "business_advance", businessRatio: 100,
      businessAdvanceBudgetCategoryId: 42,
    });
  });

  test("preserves an unallocated business transfer on edit", () => {
    expect(detectSimpleEntry(entry(3, 8), accounts)).toMatchObject({
      entryType: "business_advance", businessAdvanceBudgetCategoryId: null,
    });
  });

  test("recognizes a configured legacy business advance account on edit", () => {
    expect(detectSimpleEntry(entry(3, 9), accounts, 9)).toMatchObject({
      entryType: "business_advance", businessAdvanceAccountId: 9,
    });
  });

  test("keeps a multiple-budget business entry in the compound form", () => {
    const saved = entry(3, 8);
    saved.budget_allocations = [
      { budget_category_id: 41, amount: -1000 },
      { budget_category_id: 42, amount: -2000 },
    ];
    expect(detectSimpleEntry(saved, accounts)).toBeNull();
  });

  test("keeps a mixed business entry in the compound editor to preserve budget provenance and amounts", () => {
    const saved = entry(3, 8);
    saved.lines[0]!.debit = 1234;
    saved.lines.push({ id: 13, journal_entry_id: 10, account_id: 6,
      account_name: "Transport", debit: 1766, credit: 0, currency: "JPY" });
    saved.budget_allocations = [
      { budget_category_id: 41, amount: -1234 },
      { budget_category_id: 42, amount: -1766 },
    ];
    expect(detectSimpleEntry(saved, accounts)).toBeNull();
  });

  test("keeps an unavailable historical business budget in the compound editor", () => {
    const saved = entry(3, 8);
    saved.budget_allocations = [{ budget_category_id: 42, amount: -3000 }];
    expect(detectSimpleEntry(saved, accounts, null, new Set<number>())).toBeNull();
    expect(detectSimpleEntry(saved, accounts, null, new Set([42]))).toMatchObject({
      businessAdvanceBudgetCategoryId: 42,
    });
  });
});
