import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const featureNames = {
  en: "Budget installment transfers",
  ja: "予算分割振替",
  fr: "Transferts budgétaires échelonnés",
  es: "Transferencias presupuestarias en cuotas",
  "zh-CN": "预算分期转账",
  "zh-TW": "預算分期轉帳",
} as const;

const featureLabelKeys = [
  "sectionDepreciableAssets",
  "budgetReconciliationDepreciationOffset",
  "budgetReconciliationHint",
  "isDepreciableLabel",
  "isDepreciableHint",
  "depreciationLabel",
  "depreciationSettingsTitle",
  "depreciationSettingsHint",
  "depreciationAssetAccountLabel",
  "depreciationExpenseAccountLabel",
  "depreciationByMonths",
  "depreciationByMonthlyAmount",
  "depreciationPreviewSummary",
  "depreciationMonthsLabel",
  "depreciationMonthlyAmountLabel",
  "depreciationCreated",
  "depreciationEntryEditWarning",
  "depreciableAssetsTotal",
  "depreciationReportTitle",
  "depreciationTotal",
  "depreciationNone",
  "budgetDepreciationRecognizedLabel",
  "budgetDepreciationOverviewTitle",
  "budgetDepreciationOverviewHint",
  "budgetDepreciationResetStatus",
  "budgetDepreciationRecognizedStatus",
  "depreciationBudgetMethodTitle",
  "depreciationBudgetMethodassignedLabel",
  "depreciationBudgetMethodassignedHint",
  "depreciationBudgetMethodspecialLabel",
  "depreciationBudgetMethodspecialHint",
  "depreciationBudgetMethodunallocatedLabel",
  "depreciationBudgetMethodunallocatedHint",
  "depreciationBudgetUnallocatedWarning",
  "depreciationBudgetMonthlySourceLabel",
  "depreciationBudgetMonthlySourceTitle",
  "depreciationBudgetExpenseAccountContext",
  "depreciationBudgetMonthlySourceHint",
  "depreciationBudgetPlanTooLarge",
  "depreciationBudgetTaskTitle",
  "depreciationBudgetRepairTitle",
  "depreciationBudgetRepairButton",
  "depreciationBudgetSchedulesTitle",
  "depreciationBudgetSchedulesHint",
  "depreciationBudgetSchedulesEmpty",
  "depreciationBudgetSchedulesLoadError",
  "depreciationBudgetApplyConfirmTitle",
  "depreciationBudgetApplied",
  "depreciationBudgetDecisionOrderBefore",
  "depreciationBudgetDecisionOrderAfter",
  "depreciationBudgetAmbiguousLegacyWarning",
  "depreciationBudgetArchiveBlockedTitle",
  "depreciationBudgetArchiveBlockedMessage",
  "depreciationBudgetOpenSchedules",
  "depreciationBudgetResetPlansTitle",
  "depreciationBudgetResetPlansError",
  "depreciationBudgetArchiveResetUnavailable",
  "jsoncDeprSectionTitle",
  "jsoncDeprNote1",
  "exportDepreciationTitle",
  "exportDepreciationNote",
  "exportDepreciationPeriod",
  "exportDepreciationAccumulated",
  "exportDepreciationNone",
] as const;
const featureKeyPrefixes = [
  "depreciation",
  "depreciableAssets",
  "budgetDepreciation",
  "jsoncDepr",
  "exportDepreciation",
] as const;

const formalDepreciationTerms =
  /depreciat(?:ion|e|ed|ing)?|depreciab(?:le|les|ility)?|d[eé]preciaci[oó]n|amort(?:ization|isation|issement|issab(?:le|les)?|ize|ise)|減価償却|償却|折旧|折舊/iu;

describe("budget installment transfer feature copy", () => {
  for (const [locale, featureName] of Object.entries(featureNames)) {
    test(`${locale} uses the agreed feature name`, () => {
      const translations = parse(
        readFileSync(join(import.meta.dir, "locales", `${locale}.yaml`), "utf8"),
      ) as Record<string, string>;

      expect(translations.depreciationLabel).toBe(featureName);
    });

    test(`${locale} labels do not describe formal depreciation`, () => {
      const translations = parse(
        readFileSync(join(import.meta.dir, "locales", `${locale}.yaml`), "utf8"),
      ) as Record<string, string>;

      const allFeatureKeys = new Set([
        ...featureLabelKeys,
        ...Object.keys(translations).filter(
          (key) =>
            featureKeyPrefixes.some((prefix) => key.startsWith(prefix)) ||
            key === "sectionDepreciableAssets" ||
            key === "budgetReconciliationDepreciationOffset" ||
            key === "budgetReconciliationHint",
        ),
      ]);
      for (const key of allFeatureKeys) {
        // Placeholder identifiers are internal translation keys and are not rendered copy.
        const visibleCopy = translations[key].replace(/\{[^}]+\}/gu, "");
        expect(visibleCopy, `${locale}.${key}`).not.toMatch(formalDepreciationTerms);
      }
    });
  }
});
