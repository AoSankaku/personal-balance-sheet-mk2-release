import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const source = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("monthly trial-balance task flow", () => {
  test("stores enablement and day through server task settings", () => {
    const settings = source("src/pages/SettingsPage.tsx");

    expect(settings).toContain("taskSettings.trial_balance_enabled");
    expect(settings).toContain("trial_balance_enabled:");
    expect(settings).toContain("taskSettings.trial_balance_day");
    expect(settings).toContain("trial_balance_day: day");
    expect(settings).toContain("updateTaskSettings");
    expect(settings).toContain('t("taskTrialBalanceDayLabel")');
  });

  test("explains the month-end fallback next to the day input in every locale", () => {
    const settings = source("src/pages/SettingsPage.tsx");
    expect(settings).toContain('description={t("taskTrialBalanceDayHint")}');

    const expectedCopy: Record<string, string> = {
      en: "last day",
      es: "último día",
      fr: "dernier jour",
      ja: "月末",
      "zh-CN": "最后一天",
      "zh-TW": "最後一天",
    };

    for (const [locale, phrase] of Object.entries(expectedCopy)) {
      const translations = parse(
        source(`src/i18n/locales/${locale}.yaml`),
      ) as Record<string, string>;
      expect(translations.taskTrialBalanceDayHint).toContain(phrase);
    }
  });

  test("loads and refreshes the latest snapshot date", () => {
    const client = source("src/api/client.ts");
    const context = source("src/context/AppDataContext.tsx");
    const route = source("../worker/src/routes/trialBalance.ts");

    expect(client).toContain("getLatestSnapshotDate:");
    expect(context).toContain("latestTrialBalanceDate");
    expect(context).toContain("refreshLatestTrialBalanceDate");
    expect(route).toContain('router.get("/latest-snapshot"');
  });

  test("shows a task that opens actual-balance input", () => {
    const topNav = source("src/components/TopNav.tsx");

    expect(topNav).toContain("computeTrialBalanceTask");
    expect(topNav).toContain("taskSettings.trial_balance_enabled");
    expect(topNav).toContain("taskSettings.trial_balance_day");
    expect(topNav).toContain('navigate("/fs/tt?segment=actual")');
    expect(topNav).toContain('t("taskTrialBalanceSection")');
    expect(topNav).toContain('t("taskTrialBalanceDetail")');
  });

  test("defines localized task settings and task copy", () => {
    const keys = source("src/i18n/translationKeys.ts");
    const required = [
      "taskTrialBalanceToggle",
      "taskTrialBalanceToggleHint",
      "taskTrialBalanceDayLabel",
      "taskTrialBalanceDayHint",
      "taskTrialBalanceSection",
      "taskTrialBalanceDetail",
    ];

    for (const key of required) {
      expect(keys).toContain(`"${key}"`);
    }
  });
});
