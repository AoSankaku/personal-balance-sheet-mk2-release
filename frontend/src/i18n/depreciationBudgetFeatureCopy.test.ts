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
  "depreciationLabel",
  "depreciationSettingsTitle",
  "depreciationSettingsHint",
  "depreciationExpenseAccountLabel",
  "depreciationByMonths",
  "depreciationByMonthlyAmount",
  "depreciationMonthsLabel",
  "depreciationMonthlyAmountLabel",
  "depreciationBudgetMonthlySourceLabel",
  "depreciationBudgetMonthlySourceTitle",
  "depreciationBudgetTaskTitle",
  "depreciationBudgetRepairTitle",
  "depreciationBudgetSchedulesTitle",
] as const;

const formalDepreciationTerms =
  /depreciat(?:ion|e|ed|ing)?|amort(?:ization|isation|issement|ize|ise)|depreciaci[oó]n|減価償却|償却|折旧|折舊/iu;

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

      for (const key of featureLabelKeys) {
        expect(translations[key], `${locale}.${key}`).not.toMatch(formalDepreciationTerms);
      }
    });
  }
});
