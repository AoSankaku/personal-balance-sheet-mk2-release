import { describe, expect, test } from "bun:test";
import type { Account, IncomeTransferRequirementGroup, JournalEntry } from "@balance-sheet/shared";
import { partitionInterestIncomeTransfers } from "./interestIncome";

function group(id: number, amount: number, options: { categoryId?: number; to?: number; currency?: string; deferred?: boolean; completed?: boolean } = {}): IncomeTransferRequirementGroup {
  const requirement = { id, source_income_journal_entry_id: id, budget_category_id: options.categoryId ?? 10, budget_category_name: "Budget", from_account_id: 1, to_account_id: options.to ?? 2, amount, currency: options.currency ?? "JPY", is_deferred: options.deferred ?? false, transfer_journal_entry_id: null, completion_source: options.completed ? "created" as const : null, created_at: "", completed_at: null };
  return { key: String(id), requirement_ids: [id], source_income_journal_entry_id: id, from_account_id: requirement.from_account_id, to_account_id: requirement.to_account_id, amount, currency: requirement.currency, transfer_journal_entry_id: null, completion_source: requirement.completion_source, is_squashed: false, requirements: [requirement] };
}
function partition(groups: IncomeTransferRequirementGroup[], thresholds: Record<string, number> = { JPY: 1000, USD: 10 }) {
  // Exercise the existing implementation for RED; generalized classification replaces this adapter.
  const journal = groups.map(g => ({ id: g.source_income_journal_entry_id, date: "2026-10-20", description: "Unexpected income", created_at: "", lines: [{ id: g.source_income_journal_entry_id, journal_entry_id: g.source_income_journal_entry_id, account_id: g.source_income_journal_entry_id === 2 ? 6 : 5, account_name: "Income", debit: 0, credit: g.amount, currency: g.currency }] })) as JournalEntry[];
  return partitionInterestIncomeTransfers({ groups, journal, accounts: [{ id: 5, type: "income" }, { id: 6, type: "income" }] as Account[], rule: { income_account_id: 5, budget_category_id: 10, transfer_thresholds: thresholds } });
}

describe("generic income transfer scheduling", () => {
  test("defers any income account and any allocated budget below the route threshold", () => {
    const groups = [group(2, 112, { categoryId: 20 })];
    expect(partition(groups)).toEqual({ actionable: [], deferred: groups });
  });
  test("uses all income and budget categories for the cumulative route total", () => {
    const groups = [group(1, 499), group(2, 501, { categoryId: 20 })];
    expect(partition(groups)).toEqual({ actionable: groups, deferred: [] });
  });
  test("explicit deferral works for a large unexpected deposit", () => {
    const groups = [group(1, 20000, { deferred: true })];
    expect(partition(groups)).toEqual({ actionable: [], deferred: groups });
    expect(groups[0].requirements[0].completion_source).toBeNull();
    expect(groups[0].amount).toBe(20000);
  });
  test("manual deferral survives disabling automatic thresholds", () => {
    const groups = [group(1, 20000, { deferred: true }), group(2, 112)];
    expect(partition(groups, {})).toEqual({ actionable: [groups[1]], deferred: [groups[0]] });
  });
  test("does not combine different routes or currencies", () => {
    const groups = [group(1, 600), group(2, 600, { to: 3 }), group(3, 9, { currency: "USD" }), group(4, 1, { currency: "EUR" })];
    expect(partition(groups).deferred.map(g => g.key)).toEqual(["1", "2", "3"]);
    expect(partition(groups).actionable.map(g => g.key)).toEqual(["4"]);
  });
  test("completed transfers never return to the deferred list", () => {
    const groups = [group(1, 112, { deferred: true, completed: true })];
    expect(partition(groups).deferred).toEqual([]);
  });
});
