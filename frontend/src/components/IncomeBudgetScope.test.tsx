import { beforeAll, describe, expect, mock, test } from "bun:test";
import { MantineProvider } from "@mantine/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Account } from "@balance-sheet/shared";

const accounts = [
  { id: 1, name: "Tracked bank", type: "asset", category: "cash", include_in_allocatable: true },
  { id: 2, name: "Deducted card", type: "liability", category: "credit_card", deduct_from_budget: true },
  { id: 3, name: "Untracked cash", type: "asset", category: "cash", include_in_allocatable: false },
  { id: 4, name: "Excluded card", type: "liability", category: "credit_card", deduct_from_budget: false },
  { id: 5, name: "Discount income", type: "income", category: "other" },
  { id: 6, name: "Other tracked bank", type: "asset", category: "cash", include_in_allocatable: true },
].map((a) => ({ ...a, created_at: "2026-01-01", balances: { JPY: 0 } })) as Account[];

mock.module(import.meta.resolve("../i18n/LangContext.tsx"), () => ({
  LangProvider: ({ children }: { children: unknown }) => children,
  useLang: () => ({ t: (key: string) => key, locale: "en" }),
}));
mock.module(import.meta.resolve("../context/AppDataContext.tsx"), () => ({
  useAppData: () => ({
    accounts,
    budgetCategories: [{ id: 10, name: "Living budget", target_accounts: [{ account_id: 6, ratio: 100 }] }],
    budgetSettings: {},
    displayCurrency: "JPY",
    displayCurrencySymbol: "¥",
    enabledCurrencies: [{ code: "JPY", decimal_places: 0 }],
    allocatableToday: 0,
  }),
}));

const { SimpleEntryForm } = await import("./SimpleEntryForm");
const { BulkExpenseTab } = await import("./BulkExpenseTab");
const { setBulkDraft } = await import("../utils/inputDrafts");

beforeAll(() => {
  if (typeof globalThis.localStorage === "undefined") {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    });
  }
});

function renderSimple(accountId: number) {
  return renderToStaticMarkup(createElement(MantineProvider, null,
    createElement(SimpleEntryForm, {
      accounts,
      onSubmit: async () => {},
      initialDraft: {
        formValues: { entryType: "income", incomeTypeId: 5, incomeDepositedToId: accountId, amount: 3000 },
        budgetDist: [],
        showZeroCategories: false,
        incomeDist: [{ budget_category_id: 10, name: "Living budget", amount: 3000 }],
      },
    }),
  ));
}

function renderBulk(accountId: number) {
  setBulkDraft({
    paymentAccountId: String(accountId),
    rows: [{ type: "discount", date: new Date(2026, 9, 20), discountType: "Gift card", amount: 3000, incomeAccountId: "5", budgetCategoryId: "10" }],
    billingRows: [{ label: "", amount: "" }],
    statementCompletion: null,
  });
  return renderToStaticMarkup(createElement(MantineProvider, null,
    createElement(BulkExpenseTab, { onPosted: () => {} }),
  ));
}

describe("income budget scope in real input components", () => {
  test("normal income retains manual budget allocation for a deducted card", () => {
    const html = renderSimple(2);
    expect(html.includes("budgetDistributionPreview")).toBe(true);
    expect(html.includes("incomeOutsideBudgetHint")).toBe(false);
    expect(html.includes("incomeTransferRequiredTitle")).toBe(false);
  });

  test("tracked cash income keeps its physical transfer guidance", () => {
    const html = renderSimple(1);
    expect(html.includes("budgetDistributionPreview")).toBe(true);
    expect(html.includes("incomeTransferRequiredTitle")).toBe(true);
  });

  test.each([3, 4])("normal income excludes destination %s", (accountId) => {
    const html = renderSimple(accountId);
    expect(html.includes("incomeOutsideBudgetHint")).toBe(true);
    expect(html.includes("budgetDistributionPreview")).toBe(false);
  });

  test.each([1, 2])("bulk discounts allow a separate budget selection for destination %s", (accountId) => {
    const html = renderBulk(accountId);
    expect(html.includes("Living budget")).toBe(true);
    expect(html.includes("incomeOutsideBudgetHint")).toBe(false);
  });

  test.each([3, 4])("bulk discounts explain why destination %s cannot fund budgets", (accountId) => {
    expect(renderBulk(accountId).includes("incomeOutsideBudgetHint")).toBe(true);
  });
});
