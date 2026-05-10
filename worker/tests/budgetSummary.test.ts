import { describe, expect, test } from "bun:test";

import {
  applyBudgetBalanceCaps,
  calculateNextCarryover,
  calculateSpentFromBudgetAllocations,
  findLatestResetDateForPeriod,
  isAfterBudgetResetPoint,
  sumBudgetAdjustmentLogsAfterResetsByPeriod,
  sumBudgetAdjustmentLogsByPeriod,
} from "../src/lib/budgetSummary";

describe("sumBudgetAdjustmentLogsByPeriod", () => {
  test("includes same-day budget adjustments in an as-of summary", () => {
    const result = sumBudgetAdjustmentLogsByPeriod(
      [
        {
          budget_category_id: 1,
          year_month: "2026-05",
          amount: 400_000,
          date: "2026-05-02",
        },
        {
          budget_category_id: 1,
          year_month: "2026-05",
          amount: 50_000,
          date: "2026-05-03",
        },
      ],
      new Map([
        ["2026-05", { start: "2026-05-01", end: "2026-05-02" }],
      ]),
    );

    expect(result.get("1:2026-05")).toBe(400_000);
  });

  test("includes full prior-month adjustments for rollover", () => {
    const result = sumBudgetAdjustmentLogsByPeriod(
      [
        {
          budget_category_id: 1,
          year_month: "2026-04",
          amount: -120_000,
          date: "2026-04-30",
        },
      ],
      new Map([
        ["2026-04", { start: "2026-04-01", end: "2026-04-30" }],
        ["2026-05", { start: "2026-05-01", end: "2026-05-02" }],
      ]),
    );

    expect(result.get("1:2026-04")).toBe(-120_000);
  });
});

describe("sumBudgetAdjustmentLogsAfterResetsByPeriod", () => {
  test("ignores same-month budget adjustments before the latest reset", () => {
    const result = sumBudgetAdjustmentLogsAfterResetsByPeriod(
      [
        {
          budget_category_id: 1,
          year_month: "2026-05",
          amount: 100_000,
          date: "2026-05-01",
          created_at: "2026-05-01 09:00:00",
        },
        {
          budget_category_id: 1,
          year_month: "2026-05",
          amount: -70_000,
          date: "2026-05-02",
          adjustment_type: "reset",
          created_at: "2026-05-02 10:00:00",
        },
        {
          budget_category_id: 1,
          year_month: "2026-05",
          amount: 40_000,
          date: "2026-05-02",
          created_at: "2026-05-02 11:00:00",
        },
      ],
      new Map([
        ["2026-05", { start: "2026-05-01", end: "2026-05-31" }],
      ]),
    );

    expect(result.get("1:2026-05")).toBe(40_000);
  });
});

describe("isAfterBudgetResetPoint", () => {
  const resetPoint = {
    date: "2026-05-02",
    created_at: "2026-05-02 10:00:00",
  };

  test("excludes same-day entries created before a reset", () => {
    expect(
      isAfterBudgetResetPoint(
        { date: "2026-05-02", created_at: "2026-05-02 09:00:00" },
        resetPoint,
      ),
    ).toBe(false);
  });

  test("includes same-day entries created after a reset", () => {
    expect(
      isAfterBudgetResetPoint(
        { date: "2026-05-02", created_at: "2026-05-02 11:00:00" },
        resetPoint,
      ),
    ).toBe(true);
  });
});

describe("calculateSpentFromBudgetAllocations", () => {
  test("ignores account-ratio fallback when a journal entry has no explicit budget allocation", () => {
    expect(
      calculateSpentFromBudgetAllocations(2, [
        {
          journal_entry_id: 1191,
          budget_category_id: 2,
          amount: -20_000,
        },
      ]),
    ).toBe(20_000);
  });
});

describe("calculateNextCarryover", () => {
  test("keeps old negative overruns even outside the positive rollover window", () => {
    expect(
      calculateNextCarryover({
        budgetBase: 0,
        carryover: 0,
        spent: 253_123,
        isInPositiveRolloverWindow: false,
      }),
    ).toBe(-253_123);
  });

  test("keeps old positive surplus because budget balances roll over fully", () => {
    expect(
      calculateNextCarryover({
        budgetBase: 300_000,
        carryover: 0,
        spent: 0,
        isInPositiveRolloverWindow: false,
      }),
    ).toBe(300_000);
  });

  test("tracks corrective adjustments as ordinary full-rollover balances", () => {
    const feb = calculateNextCarryover({
      budgetBase: 0,
      carryover: 0,
      spent: 253_123,
      isInPositiveRolloverWindow: false,
    });
    const mar = calculateNextCarryover({
      budgetBase: 32_000,
      carryover: feb,
      spent: 59_499,
      isInPositiveRolloverWindow: true,
    });
    const apr = calculateNextCarryover({
      budgetBase: 52_286,
      carryover: mar,
      spent: 98_849,
      isInPositiveRolloverWindow: true,
    });
    const may = calculateNextCarryover({
      budgetBase: 362_071,
      carryover: apr,
      spent: 2_886,
      isInPositiveRolloverWindow: true,
    });

    expect(may).toBe(32_000);
  });
});

describe("applyBudgetBalanceCaps", () => {
  test("moves balances above a category cap to the configured overflow category", () => {
    const summaries = applyBudgetBalanceCaps([
      {
        category: {
          id: 1,
          sort_order: 0,
          balance_cap: 50_000,
          overflow_budget_category_id: 2,
        },
        carryover: 80_000,
        total_budget: 80_000,
        available: 80_000,
      },
      {
        category: {
          id: 2,
          sort_order: 1,
          balance_cap: null,
          overflow_budget_category_id: null,
        },
        carryover: 10_000,
        total_budget: 10_000,
        available: 10_000,
      },
    ]);

    expect(summaries[0]?.available).toBe(50_000);
    expect(summaries[0]?.total_budget).toBe(50_000);
    expect(summaries[1]?.available).toBe(40_000);
    expect(summaries[1]?.total_budget).toBe(40_000);
  });

  test("does nothing when a category has no cap", () => {
    const summaries = applyBudgetBalanceCaps([
      {
        category: {
          id: 1,
          sort_order: 0,
          balance_cap: null,
          overflow_budget_category_id: 2,
        },
        carryover: 80_000,
        total_budget: 80_000,
        available: 80_000,
      },
      {
        category: {
          id: 2,
          sort_order: 1,
          balance_cap: null,
          overflow_budget_category_id: null,
        },
        carryover: 10_000,
        total_budget: 10_000,
        available: 10_000,
      },
    ]);

    expect(summaries[0]?.available).toBe(80_000);
    expect(summaries[1]?.available).toBe(10_000);
  });
});

describe("findLatestResetDateForPeriod", () => {
  test("returns the latest reset date in the visible period", () => {
    expect(
      findLatestResetDateForPeriod(
        [
          {
            budget_category_id: 1,
            year_month: "2026-05",
            amount: -80_000,
            date: "2026-05-15",
            adjustment_type: "reset",
          },
          {
            budget_category_id: 1,
            year_month: "2026-05",
            amount: -20_000,
            date: "2026-05-20",
            adjustment_type: "reset",
          },
        ],
        1,
        { start: "2026-05-01", end: "2026-05-20" },
      ),
    ).toBe("2026-05-20");
  });

  test("returns null before the reset date", () => {
    expect(
      findLatestResetDateForPeriod(
        [
          {
            budget_category_id: 1,
            year_month: "2026-05",
            amount: -80_000,
            date: "2026-05-15",
            adjustment_type: "reset",
          },
        ],
        1,
        { start: "2026-05-01", end: "2026-05-14" },
      ),
    ).toBeNull();
  });
});
