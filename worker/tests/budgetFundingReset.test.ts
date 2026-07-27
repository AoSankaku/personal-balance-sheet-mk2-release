import { describe, expect, test } from "bun:test";
import {
  sumBudgetFundingAfterResetsByPeriod,
  type BudgetFundingTimelineRow,
} from "../src/lib/budgetFunding";

const ranges = new Map([
  ["2026-07", { start: "2026-07-01", end: "2026-07-31" }],
  ["2026-08", { start: "2026-08-01", end: "2026-08-31" }],
]);

function row(
  overrides: Partial<BudgetFundingTimelineRow>,
): BudgetFundingTimelineRow {
  return {
    journal_entry_id: overrides.journal_entry_id ?? 1,
    budget_category_id: overrides.budget_category_id ?? 10,
    kind: overrides.kind ?? "lend",
    amount: overrides.amount ?? 50,
    date: overrides.date ?? "2026-07-10",
    created_at: overrides.created_at ?? "2026-07-10 10:00:00",
    source_date: overrides.source_date ?? null,
    source_created_at: overrides.source_created_at ?? null,
  };
}

describe("budget funding and reset boundaries", () => {
  test("keeps borrowed and lent components separate", () => {
    const result = sumBudgetFundingAfterResetsByPeriod(
      [
        row({ kind: "borrow", amount: 10 }),
        row({ journal_entry_id: 2, kind: "lend", amount: 50 }),
      ],
      [],
      ranges,
    );

    expect(result.get("10:2026-07")).toEqual({
      net: -40,
      borrowed: 10,
      lent: 50,
    });
  });

  test("reverses an opening allocation when no reset intervenes", () => {
    const result = sumBudgetFundingAfterResetsByPeriod(
      [
        row({ kind: "lend", amount: 50 }),
        row({
          journal_entry_id: 2,
          kind: "collect",
          amount: 50,
          date: "2026-08-10",
          source_date: "2026-07-10",
          source_created_at: "2026-07-10 10:00:00",
        }),
      ],
      [],
      ranges,
    );

    expect(result.get("10:2026-07")?.net).toBe(-50);
    expect(result.get("10:2026-08")?.net).toBe(50);
  });

  test("does not restore a category when its source allocation predates a reset", () => {
    const result = sumBudgetFundingAfterResetsByPeriod(
      [
        row({ kind: "lend", amount: 50 }),
        row({
          journal_entry_id: 2,
          kind: "collect",
          amount: 50,
          date: "2026-08-10",
          source_date: "2026-07-10",
          source_created_at: "2026-07-10 10:00:00",
        }),
      ],
      [
        {
          budget_category_id: 10,
          year_month: "2026-08",
          amount: 0,
          date: "2026-08-01",
          created_at: "2026-08-01 09:00:00",
          adjustment_type: "reset",
        },
      ],
      ranges,
    );

    expect(result.get("10:2026-08")).toBeUndefined();
  });

  test("applies funding opened after a reset on the same date", () => {
    const result = sumBudgetFundingAfterResetsByPeriod(
      [
        row({
          kind: "borrow",
          amount: 20,
          date: "2026-07-10",
          created_at: "2026-07-10 11:00:00",
        }),
      ],
      [
        {
          budget_category_id: 10,
          year_month: "2026-07",
          amount: 0,
          date: "2026-07-10",
          created_at: "2026-07-10 10:00:00",
          adjustment_type: "reset",
        },
      ],
      ranges,
    );

    expect(result.get("10:2026-07")?.net).toBe(20);
  });
});
