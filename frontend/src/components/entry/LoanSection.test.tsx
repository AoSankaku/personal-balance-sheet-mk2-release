import { describe, expect, mock, test } from "bun:test";
import type { Account } from "@balance-sheet/shared";
import { MantineProvider } from "@mantine/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { HouseholdForm } from "../SimpleEntryForm";

mock.module(import.meta.resolve("../../i18n/LangContext.tsx"), () => ({
  LangProvider: ({ children }: { children: unknown }) => children,
  useLang: () => ({ t: (key: string) => key }),
}));

const { LoanSection } = await import("./LoanSection");

function account(
  id: number,
  type: Account["type"],
  category: Account["category"],
  extra: Partial<Account> = {},
): Account {
  return {
    id,
    name: `account-${id}`,
    type,
    category,
    balance: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function render(
  accounts: Account[],
  loanAccountId: number,
  loanCounterAccountId = 1,
) {
  const form = {
    values: {
      loanAccountId,
      loanCounterAccountId,
      loanDirection: "increase",
      loanDifferenceAccountId: null,
      amount: 1_000,
    },
    errors: {},
    getInputProps: () => ({}),
    setFieldValue: () => {},
  } as unknown as Parameters<typeof LoanSection>[0]["form"];
  const props = {
    form,
    isMobile: false,
    loanCounterOptions: [],
    liabilityOptions: [],
    lendingOptions: [],
    expenseOnlyOptions: [],
    incomeOnlyOptions: [],
    accounts,
    budgetCategories: [{ id: 1, name: "Food" }],
    locale: "en",
    selectedCurrency: "JPY",
    currencySymbol: "¥",
    unsettledEntries: [],
    setUnsettledEntries: () => {},
    settledEntryIds: [],
    setSettledEntryIds: () => {},
    isLoadingUnsettled: false,
    diffBudgetDist: [],
    setDiffBudgetDist: () => {},
    loanCounterBudgetDist: [],
    setLoanCounterBudgetDist: () => {},
    loanFundingCategoryAmounts: {},
    setLoanFundingCategoryAmounts: () => {},
    currentUnallocatedFunding: 0,
    showFundingSuggestion: false,
    handleLoanCounterAccountChange: () => {},
  } as unknown as Parameters<typeof LoanSection>[0];

  return renderToStaticMarkup(
    createElement(MantineProvider, null, createElement(LoanSection, props)),
  );
}

describe("LoanSection budget funding controls", () => {
  test("hides funding allocation for a credit-card account", () => {
    const html = render(
      [
        account(1, "asset", "cash", { include_in_allocatable: true }),
        account(2, "liability", "credit_card"),
      ],
      2,
    );

    expect(html).not.toContain("loanFundingBreakdownTitle");
  });

  test("hides funding allocation when the counter account is a credit card", () => {
    const html = render(
      [
        account(1, "asset", "cash", { include_in_allocatable: true }),
        account(2, "liability", "long_term_loan", {
          deduct_from_budget: false,
        }),
        account(3, "liability", "credit_card"),
      ],
      2,
      3,
    );

    expect(html).not.toContain("loanFundingBreakdownTitle");
  });

  test("shows no-impact hint instead of allocation for deducted borrowing", () => {
    const html = render(
      [
        account(1, "asset", "cash", { include_in_allocatable: true }),
        account(2, "liability", "long_term_loan", {
          deduct_from_budget: true,
        }),
      ],
      2,
    );

    expect(html).toContain("loanFundingNoBudgetImpactHint");
    expect(html).not.toContain("loanFundingBreakdownTitle");
  });

  test("shows funding allocation for borrowing that adds budget resources", () => {
    const html = render(
      [
        account(1, "asset", "cash", { include_in_allocatable: true }),
        account(2, "liability", "long_term_loan", {
          deduct_from_budget: false,
        }),
      ],
      2,
    );

    expect(html).toContain("loanFundingBreakdownTitle");
    expect(html).not.toContain("loanFundingNoBudgetImpactHint");
  });
});
