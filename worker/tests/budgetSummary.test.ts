import { describe, expect, test } from "bun:test";

import {
  applyBudgetBalanceCaps,
  calculateDepreciationBudgetMonth,
  calculateNextCarryover,
  calculateReferenceSpentFromBudgetAllocations,
  calculateSpentFromBudgetAllocations,
  createBudgetResetPointLookup,
  findLatestResetDateForPeriod,
  findLatestResetPointForPeriod,
  groupBudgetEventsByCategoryAndMonth,
  groupBudgetEntryAllocationsByMonth,
  isAfterBudgetResetPoint,
  sumBudgetAdjustmentLogsAfterResetsByPeriod,
  sumBudgetAdjustmentLogsByPeriod,
} from "../src/lib/budgetSummary";

describe("calculateDepreciationBudgetMonth", () => {
  test("reserves the purchase immediately and recognizes depreciation without double spending", () => {
    const activeReservations = new Map<number, number>();
    const purchaseMonth = calculateDepreciationBudgetMonth({
      budgetCategoryId: 1,
      resetPoint: null,
      reservations: [
        {
          budget_category_id: 1,
          schedule_id: 10,
          amount: 600,
          date: "2026-05-01",
          created_at: "2026-05-01 10:00:00",
        },
      ],
      allocations: [
        {
          budget_category_id: 1,
          amount: -100,
          date: "2026-05-31",
          created_at: "2026-05-01 10:00:00",
          depreciation_schedule_id: 10,
        },
      ],
      activeReservations,
    });

    expect(purchaseMonth).toEqual({
      spent: 600,
      cash_basis_spent: 600,
      recognized_depreciation: 100,
      reservation_added: 600,
      uncovered_depreciation: 0,
      reservation_remaining: 500,
    });

    const nextMonth = calculateDepreciationBudgetMonth({
      budgetCategoryId: 1,
      resetPoint: null,
      reservations: [],
      allocations: [
        {
          budget_category_id: 1,
          amount: -100,
          date: "2026-06-30",
          created_at: "2026-05-01 10:00:00",
          depreciation_schedule_id: 10,
        },
      ],
      activeReservations,
    });

    expect(nextMonth.spent).toBe(0);
    expect(nextMonth.recognized_depreciation).toBe(100);
    expect(nextMonth.reservation_remaining).toBe(400);
  });

  test("clears a pre-reset reservation but keeps same-day depreciation as non-cash spending", () => {
    const activeReservations = new Map([[10, 500]]);
    const result = calculateDepreciationBudgetMonth({
      budgetCategoryId: 1,
      resetPoint: {
        date: "2026-06-01",
        created_at: "2026-06-01 12:00:00",
      },
      reservations: [],
      allocations: [
        {
          budget_category_id: 1,
          amount: -100,
          date: "2026-06-01",
          created_at: "2026-05-01 10:00:00",
          depreciation_schedule_id: 10,
        },
      ],
      activeReservations,
    });

    expect(result.spent).toBe(100);
    expect(result.cash_basis_spent).toBe(0);
    expect(result.uncovered_depreciation).toBe(100);
    expect(result.reservation_remaining).toBe(0);
  });
});

describe("groupBudgetEntryAllocationsByMonth", () => {
  test("groups one range-query result into every requested month", () => {
    const rows = [
      {
        journal_entry_id: 1,
        budget_category_id: 10,
        amount: -1_000,
        date: "2026-03-31",
        created_at: "2026-03-31 12:00:00",
      },
      {
        journal_entry_id: 2,
        budget_category_id: 10,
        amount: -2_000,
        date: "2026-05-02",
        created_at: "2026-05-02 12:00:00",
      },
    ];

    const grouped = groupBudgetEntryAllocationsByMonth(
      rows,
      new Map([
        ["2026-03", { start: "2026-03-01", end: "2026-03-31" }],
        ["2026-04", { start: "2026-04-01", end: "2026-04-30" }],
        ["2026-05", { start: "2026-05-01", end: "2026-05-02" }],
      ]),
    );

    expect(grouped.get("2026-03")).toEqual([rows[0]]);
    expect(grouped.get("2026-04")).toEqual([]);
    expect(grouped.get("2026-05")).toEqual([rows[1]]);
  });

  test("excludes rows after the current as-of date", () => {
    const grouped = groupBudgetEntryAllocationsByMonth(
      [
        {
          journal_entry_id: 3,
          budget_category_id: 10,
          amount: -3_000,
          date: "2026-05-03",
          created_at: "2026-05-03 12:00:00",
        },
      ],
      new Map([
        ["2026-05", { start: "2026-05-01", end: "2026-05-02" }],
      ]),
    );

    expect(grouped.get("2026-05")).toEqual([]);
  });
});

describe("groupBudgetEventsByCategoryAndMonth", () => {
  test("preserves source order while applying actual date ranges and partial cutoffs", () => {
    const rows = [
      { budget_category_id: 2, date: "2026-05-02", id: 1 },
      { budget_category_id: 1, date: "2026-05-03", id: 2 },
      { budget_category_id: 2, date: "2026-05-03", id: 3 },
      { budget_category_id: 2, date: "2026-04-30", id: 4 },
    ];
    const grouped = groupBudgetEventsByCategoryAndMonth(rows, new Map([
      ["2026-05", { start: "2026-05-01", end: "2026-05-02" }],
      ["2026-04", { start: "2026-04-01", end: "2026-04-30" }],
    ]));
    expect(grouped.get("2026-05")?.get(2)).toEqual([rows[0]]);
    expect(grouped.get("2026-05")?.get(1)).toBeUndefined();
    expect(grouped.get("2026-04")?.get(2)).toEqual([rows[3]]);
  });
});

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

  test("excludes reference allocations from budget consumption while reporting them", () => {
    const allocations = [
      {
        journal_entry_id: 1,
        budget_category_id: 2,
        amount: -1_000,
      },
      {
        journal_entry_id: 2,
        budget_category_id: 2,
        amount: -1_180,
        is_reference: 1,
      },
    ];

    expect(calculateSpentFromBudgetAllocations(2, allocations)).toBe(1_000);
    expect(
      calculateReferenceSpentFromBudgetAllocations(2, allocations),
    ).toBe(1_180);
  });

  test("keeps reference amounts from deepening an existing negative budget", () => {
    const allocations = [
      { journal_entry_id: 1, budget_category_id: 2, amount: -500 },
      {
        journal_entry_id: 2,
        budget_category_id: 2,
        amount: -1_000,
        is_reference: true,
      },
    ];

    expect(calculateSpentFromBudgetAllocations(2, allocations)).toBe(500);
    expect(calculateReferenceSpentFromBudgetAllocations(2, allocations)).toBe(
      1_000,
    );
  });

  test("does not let a reference refund restore a negative budget", () => {
    const allocations = [
      { journal_entry_id: 1, budget_category_id: 2, amount: -500 },
      {
        journal_entry_id: 2,
        budget_category_id: 2,
        amount: 100,
        is_reference: true,
      },
    ];

    expect(calculateSpentFromBudgetAllocations(2, allocations)).toBe(500);
    expect(calculateReferenceSpentFromBudgetAllocations(2, allocations)).toBe(
      -100,
    );
  });
});

describe("ordinary reference allocations in depreciation-aware budget months", () => {
  test("reports ordinary references without spending or reserving budget", () => {
    const result = calculateDepreciationBudgetMonth({
      budgetCategoryId: 2,
      resetPoint: null,
      reservations: [],
      allocations: [
        {
          budget_category_id: 2,
          amount: -1_000,
          date: "2026-05-03",
          created_at: "2026-05-03 10:00:00",
          is_reference: true,
        },
      ],
      activeReservations: new Map(),
    });

    expect(result.spent).toBe(0);
    expect(result.cash_basis_spent).toBe(0);
    expect(result.reservation_remaining).toBe(0);
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

describe("createBudgetResetPointLookup", () => {
  test("matches the range scan across same-day times, null timestamps, and date bounds", () => {
    const rows = [
      { budget_category_id: 1, year_month: "2026-04", amount: 0, date: "2026-05-02", created_at: null, adjustment_type: "reset" },
      { budget_category_id: 1, year_month: "2026-07", amount: 0, date: "2026-05-15", created_at: "2026-05-15 09:00:00", adjustment_type: "reset" },
      { budget_category_id: 1, year_month: "2026-07", amount: 0, date: "2026-05-15", created_at: "2026-05-15 11:00:00", adjustment_type: "reset" },
      { budget_category_id: 1, year_month: "2026-05", amount: 0, date: "2026-06-01", created_at: null, adjustment_type: "reset" },
      { budget_category_id: 2, year_month: "2026-05", amount: 0, date: "2026-05-15", created_at: "2026-05-15 12:00:00", adjustment_type: "reset" },
    ];
    const lookup = createBudgetResetPointLookup(rows);
    expect(lookup(1, { start: "2026-05-01", end: "2026-05-31" })).toEqual({
      date: "2026-05-15", created_at: "2026-05-15 11:00:00",
    });
    expect(lookup(1, { start: "2026-05-16", end: "2026-05-31" })).toBeNull();
    expect(lookup(2, { start: "2026-05-01", end: "2026-05-31" })).toEqual({
      date: "2026-05-15", created_at: "2026-05-15 12:00:00",
    });
  });

  test("reuses the built index without rescanning source rows for repeated periods", () => {
    let reads = 0;
    const rows = Array.from({ length: 128 }, (_, index) => {
      const categoryId = index + 1;
      return {
        get budget_category_id() { reads++; return categoryId; },
        year_month: "2026-05", amount: 0,
        get date() { reads++; return "2026-05-15"; },
        created_at: "2026-05-15 12:00:00", adjustment_type: "reset",
      };
    });
    const lookup = createBudgetResetPointLookup(rows);
    const readsAfterIndexing = reads;
    for (let pass = 0; pass < 100; pass++) {
      expect(lookup(pass + 1, { start: "2026-05-01", end: "2026-05-31" })?.date)
        .toBe("2026-05-15");
    }
    expect(reads).toBe(readsAfterIndexing);
  });

  test("keeps funding cutoff semantics for null and tied creation timestamps", () => {
    const rows = [
      { budget_category_id: 1, year_month: "2026-05", amount: 0, date: "2026-05-01", created_at: "2026-05-01 09:00:00", adjustment_type: "reset" },
      { budget_category_id: 1, year_month: "2026-05", amount: 0, date: "2026-05-15", created_at: null, adjustment_type: "reset" },
      { budget_category_id: 1, year_month: "2026-05", amount: 0, date: "2026-05-15", created_at: "2026-05-15 12:00:00", adjustment_type: "reset" },
      { budget_category_id: 1, year_month: "2026-05", amount: 0, date: "2026-05-15", created_at: "2026-05-15 13:00:00", adjustment_type: "reset" },
      { budget_category_id: 2, year_month: "2026-05", amount: 0, date: "2026-05-15", created_at: "2026-05-15 14:00:00", adjustment_type: "reset" },
    ];
    const lookup = createBudgetResetPointLookup(rows);
    for (const event of [
      { date: "2026-05-15", created_at: null },
      { date: "2026-05-15", created_at: "2026-05-15 12:00:00" },
      { date: "2026-05-15", created_at: "2026-05-15 12:30:00" },
      { date: "2026-05-15", created_at: "2026-05-15 15:00:00" },
      { date: "2026-05-16", created_at: null },
    ]) {
      const expected = rows.filter(row => row.budget_category_id === 1 &&
        row.adjustment_type === "reset" && isAfterBudgetResetPoint(event, row))
        .map(row => ({ date: row.date, created_at: row.created_at ?? null }))
        .sort((a, b) => a.date.localeCompare(b.date) || (a.created_at ?? "").localeCompare(b.created_at ?? ""))
        .at(-1) ?? null;
      expect(lookup.beforeEvent(1, event)).toEqual(expected);
    }
  });

  test("scales repeated period lookup with indexed resets instead of rescanning all rows", () => {
    const makeRows = (read: () => void) => Array.from({ length: 128 }, (_, index) => {
      const categoryId = index + 1;
      return {
        get budget_category_id() { read(); return categoryId; },
        year_month: "2026-05", amount: 0,
        get date() { read(); return "2026-05-15"; },
        get created_at() { read(); return "2026-05-15 12:00:00"; },
        get adjustment_type() { read(); return "reset"; },
      };
    });
    let indexedReads = 0;
    const indexedRows = makeRows(() => indexedReads++);
    const lookup = createBudgetResetPointLookup(indexedRows);
    const buildReads = indexedReads;
    for (let pass = 0; pass < 100; pass++) {
      expect(lookup(pass + 1, { start: "2026-05-01", end: "2026-05-31" })?.date)
        .toBe("2026-05-15");
    }
    expect(indexedReads).toBe(buildReads);

    let scanReads = 0;
    const scannedRows = makeRows(() => scanReads++);
    for (let pass = 0; pass < 100; pass++) {
      findLatestResetPointForPeriod(scannedRows, pass + 1, {
        start: "2026-05-01", end: "2026-05-31",
      });
    }
    expect(scanReads).toBeGreaterThan(indexedReads * 20);
  });
});
