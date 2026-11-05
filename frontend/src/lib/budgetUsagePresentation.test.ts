import { describe, expect, test } from "bun:test";
import type { BudgetCategorySummary } from "@balance-sheet/shared";
import { presentBudgetUsage, summarizeBudgetUsage } from "./budgetUsagePresentation";

function category(overrides: Partial<BudgetCategorySummary> = {}): BudgetCategorySummary {
  return {
    category: { id: 1, name: "Living", budget_group: "生活費", account_ids: [], target_accounts: [], sort_order: 0, rollover_months: 0, goal_balance: null, balance_cap: null, overflow_budget_category_id: null, created_at: "2026-01-01" },
    budget_base: 0, carryover: 0, total_budget: 0, spent: 0, available: 0,
    months_with_contributions: 1,
    ...overrides,
  };
}

describe("budget usage including monthly depreciation funding", () => {
  test("shows the screenshot's monthly funding use without reducing either balance again", () => {
    const free = category({ carryover: -51_077, total_budget: -53_439, available: -53_439,
      depreciation_funding_out: 2_362, reference_spent: 2_500 });
    const necessary = category({ carryover: 72_765, total_budget: 69_879, available: 69_879,
      depreciation_funding_out: 2_886 });
    expect(presentBudgetUsage(free)).toMatchObject({ spending: 0, fundingOut: 2_362,
      used: 2_362, beforeUsage: -51_077, available: -53_439, reference: 2_500, percentage: null });
    expect(presentBudgetUsage(necessary)).toMatchObject({ used: 2_886, beforeUsage: 72_765, available: 69_879 });
    const combined = summarizeBudgetUsage([free, necessary]);
    expect(combined).toMatchObject({ spending: 0, fundingOut: 5_248, used: 5_248,
      beforeUsage: 21_688, available: 16_440, reference: 2_500 });
    expect(combined.percentage).toBeCloseTo(5_248 / 21_688 * 100);
  });

  test("separates spending, funding out, and funding received without counting receipts as usage", () => {
    const source = category({ spent: 1_000, total_budget: 7_000, available: 6_000, depreciation_funding_out: 3_000 });
    const destination = category({ total_budget: 5_000, available: 5_000, depreciation_funding_in: 3_000 });
    const display = summarizeBudgetUsage([source, destination]);
    expect(display).toMatchObject({ spending: 1_000, fundingOut: 3_000, fundingIn: 3_000,
      used: 4_000, beforeUsage: 15_000, available: 11_000 });
    expect(display.beforeUsage - display.used).toBe(display.available);
    expect(presentBudgetUsage(destination)).toMatchObject({ used: 0, beforeUsage: 5_000, fundingIn: 3_000 });
  });

  test("does not add legacy depreciation already included in spent", () => {
    expect(presentBudgetUsage(category({ spent: 1_500, total_budget: 10_000, available: 8_500,
      depreciation_spent: 1_500, depreciation_reserve: 500 })))
      .toMatchObject({ spending: 1_500, used: 1_500, beforeUsage: 10_000, available: 8_500 });
  });

  test("reference records and refunds never change usage or the authoritative balance", () => {
    for (const reference of [2_500, -250]) {
      expect(presentBudgetUsage(category({ spent: 50, total_budget: 100, available: 50, reference_spent: reference })))
        .toMatchObject({ used: 50, beforeUsage: 100, available: 50, reference });
    }
  });

  test("retains currency decimals and the server balance rather than re-subtracting usage", () => {
    const input = category({ spent: 1.01, total_budget: 9.12, available: 8.11, depreciation_funding_out: 2.34 });
    Object.freeze(input);
    const before = JSON.stringify(input);
    const display = presentBudgetUsage(input);
    expect(display.used).toBeCloseTo(3.35);
    expect(display.beforeUsage).toBeCloseTo(11.46);
    expect(display.available).toBe(8.11);
    expect(JSON.stringify(input)).toBe(before);
  });

  test("supports older cached summaries and nonpositive budgets without a false 0%", () => {
    expect(presentBudgetUsage(category({ spent: 10, total_budget: 100, available: 90 })))
      .toMatchObject({ used: 10, beforeUsage: 100, fundingOut: 0, fundingIn: 0, percentage: 10 });
    expect(presentBudgetUsage(category({ total_budget: 0 })).percentage).toBeNull();
    expect(summarizeBudgetUsage([])).toMatchObject({ used: 0, beforeUsage: 0, available: 0, percentage: null });
  });

  test("keeps savings exclusion explicit while producing consistent all-category totals", () => {
    const expenses = category({ total_budget: 6_000, available: 6_000, depreciation_funding_out: 4_000 });
    const savings = category({ category: { ...category().category, id: 2, budget_group: "貯蓄" },
      total_budget: 104_000, available: 104_000, depreciation_funding_in: 4_000 });
    const rows = [expenses, savings];
    expect(summarizeBudgetUsage(rows.filter(row => row.category.budget_group !== "貯蓄")))
      .toMatchObject({ used: 4_000, beforeUsage: 10_000, available: 6_000, fundingIn: 0 });
    expect(summarizeBudgetUsage(rows)).toMatchObject({ used: 4_000, beforeUsage: 114_000, available: 110_000, fundingIn: 4_000 });
  });
});
