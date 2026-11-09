import { describe, expect, test } from "bun:test";
import type { Account, JournalEntry } from "@balance-sheet/shared";
import { getBudgetCheckTotals, getSuspiciousReasons } from "../components/tt/ttUtils";

const account = (id: number, overrides: Partial<Account> = {}): Account => ({
  id, name: `Account ${id}`, type: "asset", category: "cash",
  include_in_allocatable: true, created_at: "2026-01-01", ...overrides,
});
const accounts = new Map([
  [1, account(1)],
  [2, account(2, { include_in_allocatable: false })],
  [3, account(3, { type: "liability", category: "credit_card" })],
  [4, account(4, { type: "expense", category: "food" })],
  [5, account(5, { type: "income", category: "other" })],
  [6, account(6, { category: "short_term_lending" })],
  [7, account(7)],
  [8, account(8, { include_in_allocatable: false })],
  [9, account(9, { type: "liability", category: "credit_card", deduct_from_budget: false })],
  [10, account(10, { type: "equity", category: "opening_balance" })],
  [11, account(11, { is_depreciable: true, include_in_allocatable: false })],
]);

type Line = [accountId: number, debit: number, credit: number, currency?: string];
function transfer(lines: Line[] = [[1, 0, 600], [2, 600, 0]], extra: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: 1, date: "2026-01-02", description: "Transfer to excluded cash", created_at: "2026-01-02",
    lines: lines.map(([account_id, debit, credit, currency = "JPY"], index) => ({
      id: index, journal_entry_id: 1, account_id, account_name: `Account ${account_id}`, debit, credit, currency,
    })),
    ...extra,
  };
}
const reasons = (entry: JournalEntry, currency = "JPY") => getSuspiciousReasons(entry, accounts, "ja", undefined, currency);
const check = (entry: JournalEntry, currency = "JPY") => getBudgetCheckTotals(entry, accounts, undefined, currency).unrecordedTransfer;
const reduction = (amount: number, currency = "JPY") => ({ budget_category_id: 1, amount: -amount, currency, adjustment_type: "transfer" as const });

describe("unrecorded budget reductions for excluded cash transfers", () => {
  test("flags a bank-to-excluded-cash transfer with no budget reduction without changing saved data", () => {
    const entry = transfer();
    const before = structuredClone(entry);
    expect(reasons(entry)).toHaveLength(1);
    expect(check(entry)).toEqual({ amount: 600, allocated: 0, missing: 600 });
    expect(entry).toEqual(before);
  });

  test("also flags a deducted card charge into excluded cash", () => {
    const entry = transfer([[3, 0, 600], [2, 600, 0]]);
    expect(reasons(entry)).toHaveLength(1);
    expect(check(entry)?.missing).toBe(600);
  });

  test("does not flag a fully saved transfer reduction, including the configured advance budget category", () => {
    const entry = transfer(undefined, { income_budget_allocations: [{ ...reduction(600), budget_category_id: 8 }] });
    expect(getSuspiciousReasons(entry, accounts, "ja", 8)).toEqual([]);
    expect(check(entry)).toBeNull();
  });

  test("accepts a legacy explicit consumption allocation without an expense account", () => {
    expect(reasons(transfer(undefined, { budget_allocations: [{ budget_category_id: 1, amount: -600 }] }))).toEqual([]);
  });

  test("reports only the missing portion of a saved reduction", () => {
    const entry = transfer(undefined, { income_budget_allocations: [reduction(400)] });
    expect(check(entry)).toEqual({ amount: 600, allocated: 400, missing: 200 });
    expect(reasons(entry)).toHaveLength(1);
  });

  test("combines actual consumption and linked adjustment effects", () => {
    const entry = transfer(undefined, {
      budget_allocations: [{ budget_category_id: 1, amount: -200 }],
      income_budget_allocations: [reduction(400)],
    });
    expect(reasons(entry)).toEqual([]);
  });

  test("a category-to-category movement does not hide missing global budget reduction", () => {
    const entry = transfer(undefined, { income_budget_allocations: [reduction(600), { ...reduction(-600), budget_category_id: 2 }] });
    expect(check(entry)).toEqual({ amount: 600, allocated: 0, missing: 600 });
  });

  test("an increase in budget does not count as a reduction", () => {
    const entry = transfer(undefined, { income_budget_allocations: [reduction(-100)] });
    expect(check(entry)).toEqual({ amount: 600, allocated: -100, missing: 700 });
  });

  test("reference allocations and reset records are not saved transfer reductions", () => {
    expect(check(transfer(undefined, { budget_allocations: [{ budget_category_id: 1, amount: -600, is_reference: true }] }))?.missing).toBe(600);
    expect(check(transfer(undefined, { income_budget_allocations: [{ budget_category_id: 1, amount: -600, adjustment_type: "reset" }] }))?.missing).toBe(600);
  });

  test("uses net excluded-cash movements rather than gross receipts", () => {
    const entry = transfer([[1, 0, 600], [2, 800, 0], [8, 0, 200]]);
    expect(check(entry)).toEqual({ amount: 600, allocated: 0, missing: 600 });
  });

  test("keeps the warning currency-specific", () => {
    const entry = transfer([[1, 0, 12.34, "usd"], [2, 12.34, 0, "USD"]], {
      income_budget_allocations: [reduction(600, "JPY"), reduction(10, "USD")],
    });
    expect(check(entry)).toBeNull();
    expect(reasons(entry)).toEqual([]);
    expect(check(entry, "USD")?.amount).toBe(12.34);
    expect(check(entry, "USD")?.allocated).toBe(10);
    expect(check(entry, "USD")?.missing).toBeCloseTo(2.34);
    expect(reasons(entry, "USD")).toHaveLength(1);
  });

  test.each([
    [[1, 0, 600], [7, 600, 0]],
    [[2, 0, 600], [8, 600, 0]],
    [[2, 0, 600], [1, 600, 0]],
    [[1, 0, 600], [3, 600, 0]],
    [[9, 0, 600], [2, 600, 0]],
    [[10, 0, 600], [2, 600, 0]],
    [[1, 0, 600], [6, 600, 0]],
    [[1, 0, 600], [11, 600, 0]],
    [[1, 0, 600], [99, 600, 0]],
    [[1, 0, 599], [2, 600, 0]],
  ] as Line[][])("does not attribute unrelated or ambiguous movement %j to an unrecorded cash transfer", (...lines) => {
    expect(check(transfer(lines))).toBeNull();
  });

  test("preserves the resolved expense-plus-excluded-cash compound entry", () => {
    const entry = transfer([[3, 0, 1_000], [4, 200, 0], [2, 800, 0]], {
      budget_allocations: [{ budget_category_id: 1, amount: -800 }, { budget_category_id: 2, amount: -200 }],
    });
    expect(check(entry)).toBeNull();
    expect(reasons(entry)).toEqual([]);
  });

  test("does not reinterpret separately saved loan funding", () => {
    const entry = transfer(undefined, { budget_funding: { kind: "lend", allocations: [{ id: 1, budget_category_id: 1, amount: 600, currency: "JPY" }] } });
    expect(check(entry)).toBeNull();
  });
});
