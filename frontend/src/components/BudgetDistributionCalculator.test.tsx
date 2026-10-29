import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import type { Account, BudgetCategory } from "@balance-sheet/shared";

mock.module(import.meta.resolve("../i18n/LangContext.tsx"), () => ({
  LangProvider: ({ children }: { children: unknown }) => children,
  useLang: () => ({ t: (key: string) => key, locale: "en" }),
}));
const { BudgetDistributionCalculator } = await import("./BudgetDistributionCalculator");
const accounts = [
  { id: 1, name: "Bank", type: "asset", category: "cash", include_in_allocatable: true },
  { id: 2, name: "Food", type: "expense", category: "food", budget_ratios: [
    { budget_category_id: 10, ratio: 50 }, { budget_category_id: 11, ratio: 50 },
  ] },
  { id: 3, name: "Income", type: "income", category: "other" },
].map(account => ({ ...account, created_at: "2026-01-01" })) as Account[];
const categories = [{ id: 10, name: "Living" }, { id: 11, name: "Reserve" }] as BudgetCategory[];

function render(lines: { account_id: number; debit: number; credit: number }[]) {
  return renderToStaticMarkup(createElement(MantineProvider, null,
    createElement(BudgetDistributionCalculator, {
      accounts, categories, filters: [], lines, currency: "JPY", decimalPlaces: 0,
      currencySymbol: "¥", onApply: () => {}, onClose: () => {},
    }),
  ));
}

describe("budget distribution calculator", () => {
  test("shows exact odd-yen distribution from current expense accounts", () => {
    const html = render([{ account_id: 2, debit: 965, credit: 0 }, { account_id: 1, debit: 0, credit: 965 }]);
    expect(html).toContain("Living");
    expect(html).toContain("Reserve");
    expect(html).toContain("483");
    expect(html).toContain("482");
    expect(html).toContain("budgetCalculatorApply");
    expect(html).toContain("budgetCalculatorScratchHint");
  });

  test("shows income and fee separately instead of using the gross debit total as an expense", () => {
    const html = render([
      { account_id: 1, debit: 19800, credit: 0 },
      { account_id: 2, debit: 200, credit: 0 },
      { account_id: 3, debit: 0, credit: 20000 },
    ]);
    expect(html).toContain("budgetCalculatorExpenseTotal");
    expect(html).toContain("budgetCalculatorIncomeTotal");
    expect(html).toContain("20,000");
    expect(html).toContain("budgetCalculatorRemainderCategory");
  });
});
