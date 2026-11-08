import { describe, expect, mock, test } from "bun:test";
import { MantineProvider } from "@mantine/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Account } from "@balance-sheet/shared";
import type { SimpleFormDraft } from "./SimpleEntryForm";

const accounts = [
  { id: 1, name: "Bank", type: "asset", category: "cash", include_in_allocatable: true },
  { id: 2, name: "Long-term lending", type: "asset", category: "long_term_lending" },
  { id: 3, name: "Long-term loan", type: "liability", category: "long_term_loan", deduct_from_budget: false },
  { id: 4, name: "Interest received", type: "income", category: "other" },
  { id: 5, name: "Interest paid", type: "expense", category: "other", budget_ratios: [{ budget_category_id: 10, budget_category_name: "Living budget", ratio: 100 }] },
].map(account => ({ ...account, created_at: "2026-01-01" })) as Account[];

mock.module(import.meta.resolve("../i18n/LangContext.tsx"), () => ({
  LangProvider: ({ children }: { children: unknown }) => children,
  useLang: () => ({ t: (key: string) => key, locale: "en" }),
}));
mock.module(import.meta.resolve("../context/AppDataContext.tsx"), () => ({
  useAppData: () => ({
    accounts, budgetFilters: [], journal: [], budgetSettings: {},
    budgetCategories: [{ id: 10, name: "Living budget", target_accounts: [] }],
    enabledCurrencies: [{ code: "JPY", decimal_places: 0 }],
    displayCurrency: "JPY", displayCurrencySymbol: "¥", allocatableToday: 0,
    refresh: async () => {},
  }),
}));

const { LoanManagementEntryForm } = await import("./LoanManagementEntryForm");

function render(formValues: SimpleFormDraft["formValues"], extra: Partial<SimpleFormDraft> = {}) {
  return renderToStaticMarkup(createElement(MantineProvider, null,
    createElement(LoanManagementEntryForm, {
      draft: { formValues, budgetDist: [], showZeroCategories: false, ...extra },
      onSaved: () => {}, onCancel: () => {},
    }),
  ));
}

describe("loan management budget input", () => {
  test("offers the budget breakdown before a long-term collection amount is entered", () => {
    const html = render({ entryType: "loan", loanDirection: "collect", loanAccountId: 2, amount: 0 });
    expect(html).toContain("loanFundingBreakdownTitle");
    expect(html).toContain("Living budget");
    expect(html).toContain("loanFundingUnallocated");
  });

  test.each(["collect", "decrease"] as const)("allows category allocation for long-term %s", direction => {
    const html = render({ entryType: "loan", loanDirection: direction, loanAccountId: direction === "collect" ? 2 : 3, loanCounterAccountId: 1, amount: 10000 });
    expect(html).toContain("loanFundingBreakdownTitle");
    expect(html).toContain("Living budget");
  });

  test("includes income budget distribution for lending interest", () => {
    const html = render({ entryType: "income", incomeTypeId: 4, incomeDepositedToId: 1, amount: 500 }, {
      incomeDist: [{ budget_category_id: 10, name: "Living budget", amount: 500 }],
    });
    expect(html).toContain("budgetDistributionPreview");
    expect(html).toContain("Living budget");
  });

  test("includes expense budget distribution for borrowing interest", () => {
    const html = render({ entryType: "expense", expenseCategoryId: 5, expensePaidFromId: 1, amount: 500 });
    expect(html).toContain("budgetDistributionTotal");
    expect(html).toContain("Living budget");
  });
});
