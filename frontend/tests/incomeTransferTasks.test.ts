import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");
const source = (path: string) => readFileSync(join(root, path), "utf8");

describe("income-linked account transfer tasks", () => {
  test("income entry sends explicit destination requirements", () => {
    const form = source("src/components/SimpleEntryForm.tsx");
    expect(form).toContain("income_transfer_destinations");
    expect(form).toContain("incomeTransferDestination");
  });

  test("task page exposes completion, candidate linking, and cancellation", () => {
    const tasks = source("src/components/IncomeTransferTasks.tsx");
    expect(tasks).toContain("incomeTransferRequirements.complete");
    expect(tasks).toContain("incomeTransferRequirements.squashPreview");
    expect(tasks).toContain("incomeTransferRequirements.squash");
    expect(tasks).toContain("incomeTransferRequirements.candidates");
    expect(tasks).toContain("incomeTransferRequirements.link");
    expect(tasks).toContain("incomeTransferRequirements.cancel");
  });

  test("opens the dedicated task page from the header instead of the ledger", () => {
    const app = source("src/App.tsx");
    const nav = source("src/components/TopNav.tsx");
    const list = source("src/components/TaskList.tsx");
    const ledger = source("src/pages/LedgerPage.tsx");
    const taskPage = source("src/pages/IncomeTransferTasksPage.tsx");

    expect(app).toContain('path="/tasks/income-transfer"');
    expect(list).toContain('openTask("/tasks/income-transfer")');
    expect(taskPage).toContain("<IncomeTransferTasks");
    expect(taskPage).toContain('t("incomeTransferTasksTitle")');
    expect(ledger).not.toContain("IncomeTransferTasks");
  });

  test("shows the management link only with its remaining task count", () => {
    const list = source("src/components/TaskList.tsx");
    const taskPage = source("src/pages/TasksPage.tsx");

    expect(list).toContain("incomeTransferTasks.length > 0 &&");
    expect(taskPage).toContain("tasks.incomeTransferTasks.length > 0");
    expect(list).toContain('openTask("/tasks/income-transfer")');
  });

  test("historical income allocations are only registered after confirmation", () => {
    const tasks = source("src/components/IncomeTransferTasks.tsx");
    expect(tasks).toContain("incomeTransferRequirements.historical");
    expect(tasks).toContain("incomeTransferRequirements.register");
    expect(tasks).toContain("incomeTransferHistoricalConfirm");
  });

  test("defines squash copy in every supported locale", () => {
    for (const locale of ["en", "ja", "fr", "es", "zh-CN", "zh-TW"]) {
      const translations = source(`src/i18n/locales/${locale}.yaml`);
      expect(translations).toContain("incomeTransferSquashTitle:");
      expect(translations).toContain("incomeTransferSquashAction:");
      expect(translations).toContain("incomeTransferNettedReference:");
    }
  });
});
