import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const ja = parse(readFileSync(new URL("../i18n/locales/ja.yaml", import.meta.url), "utf8"));
mock.module(import.meta.resolve("../i18n/LangContext.tsx"), () => ({
  LangProvider: ({ children }: { children: unknown }) => children,
  useLang: () => ({ t: (key: string) => ja[key] ?? key, locale: "ja" }),
}));
mock.module(import.meta.resolve("../context/AppDataContext.tsx"), () => ({
  useAppData: () => ({
    budgetCategories: [
      { id: 1, name: "予算A" }, { id: 2, name: "予算B" },
      { id: 3, name: "アーカイブ予算", is_archived: true },
    ],
    allocatableToday: 20_000, allocatableTotal: 20_000,
    displayCurrency: "JPY", displayCurrencySymbol: "￥",
    enabledCurrencies: [{ code: "JPY", decimal_places: 0 }],
  }),
}));
const { BudgetAdjustForm } = await import("./BudgetAdjustForm");
const render = () => renderToStaticMarkup(createElement(MantineProvider, null,
  createElement(MemoryRouter, null, createElement(BudgetAdjustForm, { onDone: () => {} })),
));

describe("multi-budget adjustment editor", () => {
  test("starts with all active budgets and lets the user narrow to selected budgets", () => {
    const html = render();
    expect(html).toContain("すべての予算");
    expect(html).toContain("選んだ予算のみ");
    expect(html).toContain('aria-label="予算A 調整額"');
    expect(html).toContain('aria-label="予算B 調整額"');
    expect(html).not.toContain('aria-label="アーカイブ予算 調整額"');
  });

  test("distinguishes per-budget balances, signed adjustment total and projected allocatable money", () => {
    const html = render();
    for (const label of ["調整前", "調整後", "調整額の合計", "変更後の予算可能額", "調整を保存"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('data-testid="budget-adjustment-total"');
    expect(html).toContain('data-testid="budget-adjustment-allocatable-after"');
  });
});
