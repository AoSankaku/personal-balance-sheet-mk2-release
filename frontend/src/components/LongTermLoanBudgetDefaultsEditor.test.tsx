import { describe, expect, mock, test } from "bun:test";
import { MantineProvider } from "@mantine/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module(import.meta.resolve("../i18n/LangContext.tsx"), () => ({
  LangProvider: ({ children }: { children: unknown }) => children,
  useLang: () => ({ t: (key: string) => key }),
}));
mock.module(import.meta.resolve("../context/AppDataContext.tsx"), () => ({
  useAppData: () => ({ budgetCategories: [{ id: 4, name: "Food" }] }),
}));

const { LongTermLoanBudgetDefaultsEditor } = await import(
  "./LongTermLoanBudgetDefaultsEditor"
);

describe("long-term loan budget defaults editor", () => {
  test("shows integer weight controls and explains percentage previews", () => {
    const html = renderToStaticMarkup(
      createElement(
        MantineProvider,
        null,
        createElement(LongTermLoanBudgetDefaultsEditor, {
          accountId: 7,
          currency: "JPY",
        }),
      ),
    );

    expect(html).toContain("loanBudgetDefaultsTitle");
    expect(html).toContain("loanBudgetDefaultsWeightLabel");
    expect(html).toContain("loanBudgetDefaultsRatioExample");
    expect(html).toContain("Food");
    expect(html).toContain("loanFundingUnallocated");
  });
});
