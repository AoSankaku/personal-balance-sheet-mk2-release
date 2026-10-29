import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const localeCodes = ["ja", "en", "fr", "es", "zh-CN", "zh-TW"] as const;
const localeMessages = Object.fromEntries(localeCodes.map(locale => [
  locale,
  parse(readFileSync(`frontend/src/i18n/locales/${locale}.yaml`, "utf8")) as Record<string, string>,
]));
const requiredKeys = [
  "journalHistoryTitle", "journalHistorySettingsDescription", "journalHistoryDescription", "journalHistoryRetentionLimit",
  "journalHistoryRetentionInputHint", "journalHistoryRetentionHint", "journalHistoryReduceConfirmTitle",
  "journalHistoryReduceConfirmMessage", "journalHistoryEmpty", "journalHistoryLoading",
  "journalHistoryLoadFailed", "journalHistoryRetry", "journalHistoryDeleted",
  "journalHistoryEdited", "journalHistoryArchivedAt", "journalHistoryEntryId",
  "journalHistoryLines", "journalHistoryRelatedRecords",
  "journalHistoryPage", "journalHistorySave", "journalHistorySaved", "journalHistoryAccount",
  "journalHistoryDebit", "journalHistoryCredit", "journalHistoryBudgetAllocations",
  "journalHistoryReference", "journalHistoryCount", "journalHistoryPagination",
  "journalHistoryIncomeAdjustments", "journalHistoryBudgetFunding", "journalHistoryAllocation",
  "journalHistoryReset", "journalHistoryTransfer", "journalHistoryManualAdjustment",
  "journalHistoryUnallocated", "journalHistoryBorrow", "journalHistoryRepay",
  "journalHistoryLend", "journalHistoryCollect",
];

describe("journal deletion history settings UI contract", () => {
  test("registers a privacy-gated settings route and a settings navigation tile", () => {
    const app = readFileSync("frontend/src/App.tsx", "utf8");
    const settings = readFileSync("frontend/src/pages/SettingsPage.tsx", "utf8");
    expect(app).toMatch(/path="\/settings\/journal-history"[\s\S]{0,180}privacyMode \? <PrivacyModeBlocked \/> : <JournalHistoryPage \/>/);
    expect(settings).toContain('to: "/settings/journal-history"');
    expect(settings).toContain('label: t("journalHistoryTitle")');
  });

  test("provides every journal-history string in every supported locale", () => {
    for (const locale of localeCodes) {
      for (const key of requiredKeys) {
        expect(localeMessages[locale]![key], `${locale}: ${key}`).toBeString();
        expect(localeMessages[locale]![key].trim(), `${locale}: ${key}`).not.toBe("");
      }
    }
    expect(localeMessages.ja!.journalHistoryTitle).toContain("仕訳");
    expect(localeMessages.ja!.journalHistoryReduceConfirmMessage).toContain("完全に削除");
  });
});
