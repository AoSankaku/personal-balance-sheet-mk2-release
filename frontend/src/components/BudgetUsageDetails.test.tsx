import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { BudgetUsagePresentation } from "../lib/budgetUsagePresentation";

const ja = parse(readFileSync(new URL("../i18n/locales/ja.yaml", import.meta.url), "utf8"));
mock.module(import.meta.resolve("../i18n/LangContext.tsx"), () => ({
  LangProvider: ({ children }: { children: unknown }) => children,
  useLang: () => ({ t: (key: string) => ja[key] ?? key, locale: "ja" }),
}));
const { BudgetUsageDetails } = await import("./BudgetUsageDetails");

const usage: BudgetUsagePresentation = {
  spending: 500, fundingOut: 2_362, fundingIn: 1_000, used: 2_862,
  beforeUsage: 10_000, available: 7_138, reference: 2_500, percentage: 28.62,
};
const render = (value: BudgetUsagePresentation) => renderToStaticMarkup(
  createElement(MantineProvider, null, createElement(BudgetUsageDetails, { usage: value, locale: "ja", currency: "JPY" })),
);

describe("budget usage breakdown", () => {
  test("labels spending, monthly funding out and receipts separately", () => {
    const html = render(usage);
    for (const text of ["支出による使用", "月次補填への使用", "月次補填の受入", "2,362", "1,000", "500"]) {
      expect(html).toContain(text);
    }
  });

  test("shows reference records outside usage, including reference refunds", () => {
    const html = render({ ...usage, reference: -250 });
    expect(html).toContain("参考記録（使用額の外）");
    expect(html).toContain("250");
    expect(html).not.toContain("うち参考支出");
  });

  test("does not show a redundant breakdown when no funding or reference record exists", () => {
    expect(render({ ...usage, fundingOut: 0, fundingIn: 0, reference: 0 })).not.toContain("支出による使用");
    expect(render({ ...usage, fundingOut: 0, fundingIn: 0, reference: 0 })).not.toContain("月次補填");
  });
});
