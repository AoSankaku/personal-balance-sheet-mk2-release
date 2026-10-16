import { describe, expect, mock, test } from "bun:test";
import { MantineProvider } from "@mantine/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { HouseholdForm } from "../SimpleEntryForm";

mock.module("../../i18n", () => ({
  useLang: () => ({ t: (key: string) => key }),
}));
mock.module("../../context/AppDataContext", () => ({
  useAppData: () => ({ displayCurrencySymbol: "¥" }),
}));

const { IncomeSection } = await import("./IncomeSection");

function render(canAllocateIncome: boolean) {
  const form = {
    values: {
      incomeTypeId: 10,
      incomeDepositedToId: 1,
      amount: 3_000,
    },
    errors: {},
    getInputProps: () => ({}),
    setFieldValue: () => {},
  } as unknown as Parameters<typeof IncomeSection>[0]["form"];
  const props = {
    form,
    isMobile: false,
    incomeOptions: [],
    incomeDepositOptions: [],
    activeFilterOptions: [{ value: "1", label: "Monthly" }],
    budgetCategories: [{ id: 1, name: "Food" }],
    isRegularIncome: true,
    setIsRegularIncome: () => {},
    selectedFilterId: "1",
    setSelectedFilterId: () => {},
    setIncomeDist: () => {},
    displayIncomeDist: [{ budget_category_id: 1, name: "Food", amount: 3_000 }],
    filterStepPreview: [],
    incomeDistributionSummary: {
      totalAmount: 3_000,
      displayRatio: 100,
      isOverAllocated: false,
      isUnderAllocated: false,
    },
    totalIncomeDist: 3_000,
    showManualIncomeDist: false,
    handleIncomeDistChange: () => {},
    handleIncomeTypeChange: () => {},
    canAllocateIncome,
    onIncomeDepositChange: () => {},
  } as unknown as Parameters<typeof IncomeSection>[0];

  return renderToStaticMarkup(
    createElement(
      MantineProvider,
      null,
      createElement(IncomeSection, props),
    ),
  );
}

describe("IncomeSection budget scope", () => {
  test("hides filter and manual allocation controls outside budget assets", () => {
    const html = render(false);

    expect(html).toContain("incomeOutsideBudgetHint");
    expect(html).not.toContain("applyBudgetFilterLabel");
    expect(html).not.toContain("budgetFilterTitle");
    expect(html).not.toContain("budgetDistributionPreview");
  });

  test("keeps allocation controls for budget asset deposits", () => {
    const html = render(true);

    expect(html).not.toContain("incomeOutsideBudgetHint");
    expect(html).toContain("applyBudgetFilterLabel");
    expect(html).toContain("budgetFilterTitle");
    expect(html).toContain("budgetDistributionPreview");
  });
});
