import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { pageTitleKeyForPathname } from "../src/i18n/documentTitle";
import type { BottomNotificationHistoryItem } from "../src/lib/bottomNotificationHistory";

mock.module(import.meta.resolve("../src/i18n/LangContext.tsx"), () => ({
  LangProvider: ({ children }: { children: unknown }) => children,
  useLang: () => ({ t: (key: string) => key, locale: "en" }),
}));
const { NotificationHistoryEntries } = await import("../src/pages/BottomNotificationHistoryPage");

function render(items: BottomNotificationHistoryItem[]) {
  return renderToStaticMarkup(createElement(MantineProvider, null,
    createElement(MemoryRouter, null, createElement(NotificationHistoryEntries, { items })),
  ));
}

const item: BottomNotificationHistoryItem = {
  id: "warning", occurredAt: "2026-10-30T05:00:00.000Z", color: "yellow",
  message: "Journal saved; card statement completion failed.",
  screen: "Input / Bulk entry", path: "/input",
  action: "Complete Card A / 2026-08", details: "statement_not_ready",
};

describe("notification history page", () => {
  test("shows timestamp, message, source screen, action and available error details", () => {
    const html = render([item]);
    for (const text of [item.occurredAt, item.message, item.screen, item.action!, item.details!, "notificationHistoryWarning"]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('href="/input"');
    expect(html).toContain("<li");
  });

  test("renders stored notification text safely and preserves multiline content", () => {
    const html = render([{ ...item, message: "<script>attack()</script>\nSecond line" }]);
    expect(html).toContain("&lt;script&gt;attack()&lt;/script&gt;");
    expect(html).not.toContain("<script>attack()");
    expect(html).toContain("white-space:pre-wrap");
  });

  test("uses the requested URL, Settings button, page title, and privacy guard", () => {
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    const settings = readFileSync(new URL("../src/pages/SettingsPage.tsx", import.meta.url), "utf8");
    expect(app).toContain('path="/bottom-notification-history"');
    expect(app).toContain("privacyMode ? <PrivacyModeBlocked /> : <BottomNotificationHistoryPage />");
    expect(settings).toContain('to: "/bottom-notification-history"');
    expect(settings).toContain('label: t("notificationHistoryTitle")');
    expect(pageTitleKeyForPathname("/bottom-notification-history")).toBe("notificationHistoryTitle");
  });
});
