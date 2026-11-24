import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import { clearD1LimitNotice, reportD1Limit } from "../src/lib/d1LimitNotice";

mock.module(import.meta.resolve("../src/i18n/LangContext.tsx"), () => ({
  LangProvider: ({ children }: { children: unknown }) => children,
  useLang: () => ({ t: (key: string) => key, locale: "en" }),
}));
const { D1LimitAlert } = await import("../src/components/D1LimitAlert");
const render = () => renderToStaticMarkup(createElement(MantineProvider, null, createElement(D1LimitAlert)));

beforeEach(clearD1LimitNotice);

describe("D1 limit alert", () => {
  test("shows a dismissible daily-limit notice with a reset hint and save guidance", () => {
    reportD1Limit({ error: "d1_limit_exceeded", limit_type: "daily_read", retry_at: "2026-11-11T00:00:00.000Z" });
    const html = render();
    for (const text of ["d1LimitTitle", "d1DailyReadLimitMessage", "d1LimitRetryAt", "d1LimitSaveWarning", 'aria-label="statusDismiss"']) expect(html).toContain(text);
    expect(html).not.toContain("hardReloadAction");
  });

  test("distinguishes write limits and request limits without false reset promises", () => {
    reportD1Limit({ error: "d1_limit_exceeded", limit_type: "daily_write", retry_at: "2026-11-11T00:00:00.000Z" });
    expect(render()).toContain("d1DailyWriteLimitMessage");
    reportD1Limit({ error: "d1_limit_exceeded", limit_type: "requests_per_invocation", retry_at: null });
    const html = render();
    expect(html).toContain("d1RequestLimitMessage");
    expect(html).not.toContain("d1LimitRetryAt");
  });

  test("hides the notice when dismissed", () => {
    reportD1Limit({ error: "d1_limit_exceeded", limit_type: "requests_per_invocation", retry_at: null });
    clearD1LimitNotice();
    expect(render()).not.toContain("d1LimitTitle");
  });
});
