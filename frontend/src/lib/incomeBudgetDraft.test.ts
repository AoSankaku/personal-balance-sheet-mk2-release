import { describe, expect, test } from "bun:test";
import type { BudgetCategory, BudgetFilter, JournalEntry } from "@balance-sheet/shared";
import { buildIncomeBudgetDraft, getIncomeDistributionDirtyIds } from "./incomeBudgetDraft";

const categories = [{ id: 1, name: "Living costs" }, { id: 2, name: "Savings" }] as BudgetCategory[];
const filters = [{ id: 10, name: "Salary", currency: "JPY", is_active: true, steps: [
  { id: 20, step_order: 1, step_type: "remainder", allocations: [
    { budget_category_id: 1, ratio: 50 }, { budget_category_id: 2, ratio: 50 },
  ] },
] }] as BudgetFilter[];
const entry = {
  id: 1, date: "2026-10-20", description: "Salary", created_at: "2026-10-20", lines: [],
  is_regular_income: true, income_budget_filter_id: 10,
  income_budget_allocations: [{ budget_category_id: 1, amount: 750 }],
} as JournalEntry;

describe("income edit draft", () => {
  test("restores regular mode and selected filter without recalculating saved amounts", () => {
    const draft = buildIncomeBudgetDraft(entry, categories, filters, 1000);
    expect(draft.isRegularIncome).toBe(true);
    expect(draft.selectedFilterId).toBe("10");
    expect(draft.incomeDist).toContainEqual({ budget_category_id: 1, name: "Living costs", amount: 750 });
    expect(draft.incomeDist).toContainEqual({ budget_category_id: 2, name: "Savings", amount: 0 });
    expect(draft.filterStepPreview).toHaveLength(1);
    expect([...getIncomeDistributionDirtyIds(draft)].sort()).toEqual([1, 2]);
  });

  test("a date change produces the same regular-income state and amounts", () => {
    expect(buildIncomeBudgetDraft({ ...entry, date: "2026-09-25" }, categories, filters, 1000))
      .toEqual(buildIncomeBudgetDraft(entry, categories, filters, 1000));
  });

  test("keeps unmodified defaults eligible for amount recalculation", () => {
    const draft = buildIncomeBudgetDraft({ ...entry, income_budget_allocations: [
      { budget_category_id: 1, amount: 500 }, { budget_category_id: 2, amount: 500 },
    ] }, categories, filters, 1000);
    expect(getIncomeDistributionDirtyIds(draft).size).toBe(0);
  });

  test("does not guess regular mode or a filter for older manual entries", () => {
    const { is_regular_income: _mode, income_budget_filter_id: _filter, ...legacy } = entry;
    const draft = buildIncomeBudgetDraft(legacy as JournalEntry, categories, filters, 1000);
    expect(draft.isRegularIncome).toBe(false);
    expect(draft.selectedFilterId).toBeNull();
    expect(draft.incomeDist).toEqual([{ budget_category_id: 1, name: "Living costs", amount: 750 }]);
  });

  test("retains saved amounts when the original filter was deleted", () => {
    const draft = buildIncomeBudgetDraft({ ...entry, income_budget_filter_id: null }, categories, [], 1000);
    expect(draft.isRegularIncome).toBe(true);
    expect(draft.selectedFilterId).toBeNull();
    expect(draft.filterStepPreview).toEqual([]);
    expect(draft.incomeDist[0]?.amount).toBe(750);
  });
});
