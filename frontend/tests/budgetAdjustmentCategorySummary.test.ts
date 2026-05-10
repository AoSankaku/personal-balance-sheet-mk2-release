import { describe, expect, test } from "bun:test";

import type { BudgetAdjustmentLog } from "@balance-sheet/shared";
import { summarizeBudgetAdjustmentLogsByCategory } from "../src/lib/budgetAdjustmentCategorySummary";

function log(overrides: Partial<BudgetAdjustmentLog>): BudgetAdjustmentLog {
  return {
    id: overrides.id ?? 1,
    budget_category_id: overrides.budget_category_id ?? 1,
    budget_category_name: overrides.budget_category_name ?? "Category",
    year_month: overrides.year_month ?? "2026-05",
    amount: overrides.amount ?? 0,
    currency: overrides.currency ?? "JPY",
    date: overrides.date ?? "2026-05-01",
    created_at: overrides.created_at ?? "2026-05-01 00:00:00",
    type: overrides.type ?? "manual",
    journal_entry_id: overrides.journal_entry_id,
    note: overrides.note,
  };
}

describe("summarizeBudgetAdjustmentLogsByCategory", () => {
  test("groups logs by budget category and totals the adjusted value", () => {
    const summaries = summarizeBudgetAdjustmentLogsByCategory([
      log({ id: 1, budget_category_id: 10, amount: 1000 }),
      log({ id: 2, budget_category_id: 10, amount: -400 }),
      log({ id: 3, budget_category_id: 20, amount: 5000 }),
    ]);

    expect(
      summaries.map((summary) => ({
        id: summary.budget_category_id,
        total: summary.adjusted_total,
        count: summary.entry_count,
      })),
    ).toEqual([
      { id: 20, total: 5000, count: 1 },
      { id: 10, total: 600, count: 2 },
    ]);
  });

  test("uses budget summary available balance as the displayed category balance", () => {
    const summaries = summarizeBudgetAdjustmentLogsByCategory(
      [
        log({ id: 1, budget_category_id: 10, amount: 1000 }),
        log({ id: 2, budget_category_id: 10, amount: -400 }),
      ],
      [10],
      new Map([[10, 12_345]]),
    );

    expect(summaries[0]?.adjusted_total).toBe(12_345);
    expect(summaries[0]?.adjustment_total).toBe(600);
  });

  test("uses budget category settings order when provided", () => {
    const summaries = summarizeBudgetAdjustmentLogsByCategory(
      [
        log({ id: 1, budget_category_id: 10, amount: 1000 }),
        log({ id: 2, budget_category_id: 20, amount: 5000 }),
        log({ id: 3, budget_category_id: 30, amount: 2000 }),
      ],
      [30, 10, 20],
    );

    expect(summaries.map((summary) => summary.budget_category_id)).toEqual([
      30, 10, 20,
    ]);
  });

  test("keeps the latest row per category by date and input timestamp", () => {
    const summaries = summarizeBudgetAdjustmentLogsByCategory([
      log({
        id: 1,
        budget_category_id: 10,
        amount: 1000,
        date: "2026-05-03",
        created_at: "2026-05-03 09:00:00",
      }),
      log({
        id: 2,
        budget_category_id: 10,
        amount: 2000,
        date: "2026-05-03",
        created_at: "2026-05-03 12:00:00",
      }),
    ]);

    expect(summaries[0]?.latest_log.id).toBe(2);
  });

  test("provides the adjusted total after each row in newest-first order", () => {
    const summaries = summarizeBudgetAdjustmentLogsByCategory([
      log({
        id: 1,
        budget_category_id: 10,
        amount: 1000,
        date: "2026-05-01",
      }),
      log({
        id: 2,
        budget_category_id: 10,
        amount: -400,
        date: "2026-05-02",
      }),
      log({
        id: 3,
        budget_category_id: 10,
        amount: 200,
        date: "2026-05-03",
      }),
    ]);

    expect(
      summaries[0]?.log_balances.map((row) => ({
        id: row.log.id,
        balance: row.adjusted_total_after,
      })),
    ).toEqual([
      { id: 3, balance: 800 },
      { id: 2, balance: 600 },
      { id: 1, balance: 1000 },
    ]);
  });

  test("preserves optional comments on the latest adjustment log", () => {
    const summaries = summarizeBudgetAdjustmentLogsByCategory([
      log({
        id: 1,
        budget_category_id: 10,
        amount: 1000,
        note: "Moved from emergency reserve",
      }),
    ]);

    expect(summaries[0]?.latest_log.note).toBe(
      "Moved from emergency reserve",
    );
  });
});
