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

  test("ledger exposes completion, candidate linking, and cancellation", () => {
    const tasks = source("src/components/IncomeTransferTasks.tsx");
    expect(tasks).toContain("incomeTransferRequirements.complete");
    expect(tasks).toContain("incomeTransferRequirements.candidates");
    expect(tasks).toContain("incomeTransferRequirements.link");
    expect(tasks).toContain("incomeTransferRequirements.cancel");
  });

  test("historical income allocations are only registered after confirmation", () => {
    const tasks = source("src/components/IncomeTransferTasks.tsx");
    expect(tasks).toContain("incomeTransferRequirements.historical");
    expect(tasks).toContain("incomeTransferRequirements.register");
    expect(tasks).toContain("incomeTransferHistoricalConfirm");
  });
});
