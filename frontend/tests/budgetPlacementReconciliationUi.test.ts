import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const root = join(import.meta.dir, "..");
const source = (path: string) => readFileSync(join(root, path), "utf8");

describe("budget placement reconciliation UI", () => {
  test("loads the authoritative preview and posts completion with its revision token", () => {
    const client = source("src/api/client.ts");
    const hook = source("src/hooks/useBudgetPlacementReconciliation.ts");
    const panel = source("src/components/BudgetPlacementReconciliationPanel.tsx");

    expect(client).toContain("/income-transfer-requirements/placement-preview?currency=");
    expect(client).toContain("/income-transfer-requirements/placement-complete");
    expect(hook).toContain("api.incomeTransferRequirements.placementPreview(currency)");
    expect(hook).toContain("setPlan(null)");
    expect(panel).toContain("placementComplete({");
    expect(panel).toContain("token: snapshot.token");
    expect(panel).toContain("cause.status === 409");
    expect(panel).toContain("setSelectedPlan(null)");
  });

  test("filters completed placement requirements and refreshes legacy task history", () => {
    const tasks = source("src/components/IncomeTransferTasks.tsx");
    const panel = source("src/components/BudgetPlacementReconciliationPanel.tsx");
    const taskCollection = source("src/hooks/useTaskCollection.ts");

    expect(tasks).toContain("filterUncoveredIncomeTransfers(groups, reconciliation.plan?.requirement_ids");
    expect(tasks).toContain("onCompleted={refresh}");
    expect(taskCollection).toContain("filterUncoveredIncomeTransfers(groups, coveredRequirementIds)");
    expect(taskCollection).toContain("placementLoading || placementReconciliation.error != null ? []");
    expect(taskCollection).toContain("splitBudgetPlacementTransfersByDeferral");
    expect(taskCollection).toContain("deferredBudgetPlacementTasks");
    expect(panel).toContain("api.incomeTransferRequirements.defer(id, !isDeferred)");
    expect(source("src/pages/TasksPage.tsx")).toContain("tasks.deferredBudgetPlacementTasks");
  });

  test("shows the reconciliation panel above consistency findings and has both adjustment columns", () => {
    const section = source("src/components/tt/BudgetCheckSection.tsx");
    const table = source("src/components/BudgetPlacementTable.tsx");

    expect(section.indexOf("<BudgetPlacementReconciliationPanel />")).toBeLessThan(
      section.indexOf('t("budgetConsistencyTitle")'),
    );
    expect(table).toContain('t("budgetPlacementAfterTransfers")');
    expect(table).toContain('t("budgetPlacementAfterCardDebt")');
    expect(table).toContain("plan.adjusted_total_difference");
    expect(table).toContain("t(\"budgetPlacementCardDebtTotalOnly\")");
  });

  test("defines all new copy in each supported locale and the typed key list", () => {
    const keys = [
      "budgetPlacementAfterTransfers",
      "budgetPlacementAfterCardDebt",
      "budgetPlacementCardDebtTotalOnly",
      "budgetPlacementCardDebtAdjustmentHint",
      "budgetPlacementReconciliationTitle",
      "budgetPlacementPlanLoading",
      "budgetPlacementPlanUnavailable",
      "budgetPlacementPlanUnavailableHint",
      "budgetPlacementPlanAsOf",
      "budgetPlacementPlanCurrentGap",
      "budgetPlacementPlanAfterTransfers",
      "budgetPlacementPlanAfterCardDebt",
      "budgetPlacementPendingIncomeTitle",
      "budgetPlacementExpenseEvidenceTitle",
      "budgetPlacementExpenseEvidenceHint",
      "budgetPlacementPlanGroupLabel",
      "budgetPlacementPlanTransfersTitle",
      "budgetPlacementNoCashTransfers",
      "budgetPlacementPlanTotalsHint",
      "budgetPlacementRetainedOverspendingHint",
      "budgetPlacementTransferJournalDescription",
      "budgetPlacementTransferRecorded",
      "budgetPlacementPlanStale",
      "budgetPlacementTransferConfirmTitle",
      "budgetPlacementTransferConfirmHint",
      "budgetPlacementTransferRecordAction",
      "budgetPlacementUnresolvedIncomeTransferHint",
      "budgetPlacementDeferredTitle",
      "budgetPlacementDeferredHint",
      "ttPlacementPendingCurrentHint",
    ];
    const typedKeys = source("src/i18n/translationKeys.ts");
    const localeTranslations = new Map(
      ["en", "ja", "fr", "es", "zh-CN", "zh-TW"].map(locale => [
        locale, parse(source(`src/i18n/locales/${locale}.yaml`)),
      ]),
    );

    for (const key of keys) {
      expect(typedKeys).toContain(`"${key}"`);
      for (const [locale, translations] of localeTranslations) {
        expect(translations[key], `${locale}.${key}`).toBeTruthy();
      }
    }
  });
});
