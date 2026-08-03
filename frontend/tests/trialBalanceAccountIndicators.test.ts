import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type {
  IncomeTransferRequirement,
  JournalEntry,
} from "@balance-sheet/shared";
import { summarizePendingIncomeTransfers } from "../src/lib/pendingIncomeTransferSummary";

function requirement(
  overrides: Partial<IncomeTransferRequirement> &
    Pick<IncomeTransferRequirement, "id" | "source_income_journal_entry_id">,
): IncomeTransferRequirement {
  return {
    budget_category_id: 1,
    budget_category_name: "Living",
    from_account_id: 10,
    to_account_id: 20,
    amount: 1000,
    currency: "JPY",
    transfer_journal_entry_id: null,
    completion_source: null,
    created_at: "2026-08-01 12:00:00",
    completed_at: null,
    ...overrides,
  };
}

function entry(
  id: number,
  requirements: IncomeTransferRequirement[],
): JournalEntry {
  return {
    id,
    date: "2026-08-01",
    description: "Income",
    source: "manual",
    created_at: "2026-08-01 12:00:00",
    lines: [],
    income_transfer_requirements: requirements,
  };
}

describe("summarizePendingIncomeTransfers", () => {
  test("groups pending requirements using the task route and counts both accounts", () => {
    const summary = summarizePendingIncomeTransfers([
      entry(1, [
        requirement({ id: 1, source_income_journal_entry_id: 1 }),
        requirement({ id: 2, source_income_journal_entry_id: 1 }),
      ]),
      entry(2, [
        requirement({
          id: 3,
          source_income_journal_entry_id: 2,
          from_account_id: 20,
          to_account_id: 30,
        }),
      ]),
    ]);

    expect(summary.taskCount).toBe(2);
    expect(summary.taskCountByAccount.get(10)).toBe(1);
    expect(summary.taskCountByAccount.get(20)).toBe(2);
    expect(summary.taskCountByAccount.get(30)).toBe(1);
  });

  test("ignores completed requirements", () => {
    const summary = summarizePendingIncomeTransfers([
      entry(1, [
        requirement({
          id: 1,
          source_income_journal_entry_id: 1,
          completion_source: "created",
          transfer_journal_entry_id: 99,
          completed_at: "2026-08-02 12:00:00",
        }),
      ]),
    ]);

    expect(summary.taskCount).toBe(0);
    expect(summary.taskCountByAccount.size).toBe(0);
  });
});

describe("trial-balance account indicators", () => {
  test("renders CSV and pending-transfer chips with a task warning action", () => {
    const source = readFileSync(
      new URL("../src/components/tt/DeviationSection.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('t("ttCsvLastRecordedChip")');
    expect(source).toContain('t("ttIncomeTransferPendingChip")');
    expect(source).toContain('t("ttIncomeTransferWarningTitle")');
    expect(source).toContain('navigate("/tasks/income-transfer")');
  });
});
