import { describe, expect, test } from "bun:test";
import type { Account, IncomeTransferRequirementGroup, JournalEntry } from "@balance-sheet/shared";
import { buildInterestIncomeDefault, partitionInterestIncomeTransfers } from "./interestIncome";
import { summarizePendingIncomeTransfers } from "./pendingIncomeTransferSummary";
import * as interestIncome from "./interestIncome";

const rule = { income_account_id: 5, budget_category_id: 10, transfer_thresholds: { JPY: 1000, USD: 10 } };
const accounts = [{ id: 5, type: "income" }, { id: 6, type: "income" }] as Account[];
const categories = [{ id: 10, name: "Free spending" }];
function entry(id: number, incomeAccountId = 5): JournalEntry {
  return { id, date: "2026-10-20", description: "Interest", created_at: "", lines: [
    { id, journal_entry_id: id, account_id: incomeAccountId, account_name: "Interest", debit: 0, credit: 112, currency: "JPY" },
  ] };
}
function group(id: number, amount: number, overrides: Partial<IncomeTransferRequirementGroup> = {}): IncomeTransferRequirementGroup {
  const requirement = { id, source_income_journal_entry_id: id, budget_category_id: 10, budget_category_name: "Free spending", from_account_id: 1, to_account_id: 2, amount, currency: "JPY", transfer_journal_entry_id: null, completion_source: null, created_at: "", completed_at: null };
  return { key: String(id), requirement_ids: [id], source_income_journal_entry_id: id, from_account_id: 1, to_account_id: 2, amount, currency: "JPY", transfer_journal_entry_id: null, completion_source: null, is_squashed: false, requirements: [requirement], ...overrides };
}
function partition(groups: IncomeTransferRequirementGroup[], journal = groups.map(g => entry(g.source_income_journal_entry_id))) {
  return partitionInterestIncomeTransfers({ groups, journal, accounts, rule });
}

describe("interest income defaults", () => {
  test("saving thresholds removes disabled currencies and preserves other enabled currencies", () => {
    expect(typeof interestIncome.buildInterestTransferThresholds).toBe("function");
    expect(interestIncome.buildInterestTransferThresholds({ JPY: 1000, USD: 10, EUR: 20 }, [{ code: "JPY" }, { code: "EUR" }], "JPY", 2000)).toEqual({ JPY: 2000, EUR: 20 });
  });
  test("allocates the full income to the configured category by ID", () => {
    expect(buildInterestIncomeDefault({ rule, incomeAccountId: 5, amount: 112, categories })).toEqual([{ budget_category_id: 10, name: "Free spending", amount: 112 }]);
  });
  test("does not infer rules from names or use missing categories", () => {
    expect(buildInterestIncomeDefault({ rule, incomeAccountId: 6, amount: 112, categories })).toBeNull();
    expect(buildInterestIncomeDefault({ rule, incomeAccountId: 5, amount: 112, categories: [] })).toBeNull();
    expect(buildInterestIncomeDefault({ rule: null, incomeAccountId: 5, amount: 112, categories })).toBeNull();
  });
});

describe("small interest transfers reuse pending tasks", () => {
  test("defers a small interest task without altering its amount or completion", () => {
    const pending = group(1, 112);
    expect(partition([pending])).toEqual({ actionable: [], deferred: [pending] });
    expect(pending.requirements[0].completion_source).toBeNull();
    expect(pending.amount).toBe(112);
  });
  test("uses the cumulative route total, including the exact threshold", () => {
    expect(partition([group(1, 499), group(2, 500)]).deferred).toHaveLength(2);
    expect(partition([group(1, 499), group(2, 501)]).actionable).toHaveLength(2);
  });
  test("keeps different routes and currencies separate", () => {
    const groups = [group(1, 600), group(2, 600, { to_account_id: 3 }), group(3, 9, { currency: "USD" }), group(4, 1, { currency: "EUR" })];
    const result = partition(groups);
    expect(result.deferred.map(g => g.key)).toEqual(["1", "2", "3"]);
    expect(result.actionable.map(g => g.key)).toEqual(["4"]);
  });
  test("does not hide ordinary income, overridden budgets, or unknown source entries", () => {
    const overridden = group(2, 2);
    overridden.requirements[0].budget_category_id = 11;
    const groups = [group(1, 112), overridden, group(3, 3)];
    expect(partition(groups, [entry(1, 6), entry(2)]).actionable).toEqual(groups);
  });
  test("does not hide mixed-income entries or completed transfers", () => {
    const mixed = entry(1);
    mixed.lines.push({ ...mixed.lines[0], id: 99, account_id: 6 });
    const completed = group(2, 10, { completion_source: "created" });
    expect(partition([group(1, 10), completed], [mixed, entry(2)]).deferred).toEqual([]);
  });
  test("disabled rules and zero thresholds preserve normal task visibility", () => {
    const groups = [group(1, 112)];
    expect(partitionInterestIncomeTransfers({ groups, journal: [entry(1)], accounts, rule: null }).actionable).toEqual(groups);
    expect(partitionInterestIncomeTransfers({ groups, journal: [entry(1)], accounts, rule: { ...rule, transfer_thresholds: { JPY: 0 } } }).actionable).toEqual(groups);
  });
  test("reconciliation retains every pending task while distinguishing deferred ones", () => {
    const journal = [entry(1), entry(2)];
    journal[0].income_transfer_requirements = group(1, 112).requirements;
    journal[1].income_transfer_requirements = group(2, 122).requirements;
    const summary = summarizePendingIncomeTransfers(journal, { accounts, rule });
    expect(summary.taskCount).toBe(2);
    expect(summary.actionableTaskCount).toBe(0);
    expect(summary.deferredTaskCount).toBe(2);
    expect(summary.taskCountByAccount.get(1)).toBe(2);
  });
});
