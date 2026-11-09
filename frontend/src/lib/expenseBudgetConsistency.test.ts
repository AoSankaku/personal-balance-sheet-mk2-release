import { describe, expect, test } from "bun:test";
import type { Account, JournalEntry } from "@balance-sheet/shared";
import { getSuspiciousReasons } from "../components/tt/ttUtils";

function account(id: number, overrides: Partial<Account> = {}): Account {
  return {
    id,
    name: `Account ${id}`,
    type: "asset",
    category: "cash",
    include_in_allocatable: true,
    created_at: "2026-01-01",
    ...overrides,
  };
}

function accounts(): Map<number, Account> {
  return new Map([
    [1, account(1)],
    [2, account(2, { type: "liability", category: "credit_card" })],
    [3, account(3, { include_in_allocatable: false })],
    [4, account(4, { type: "expense", category: "food" })],
    [5, account(5, { include_in_allocatable: false })],
    [6, account(6, { type: "income", category: "other" })],
    [7, account(7, { category: "short_term_lending" })],
    [8, account(8, { category: "business_advance" })],
  ]);
}

type Line = [accountId: number, debit: number, credit: number, currency?: string];

function compound(
  lines: Line[] = [[2, 0, 10_000], [4, 2_000, 0], [3, 8_000, 0]],
  allocated = 10_000,
): JournalEntry {
  return {
    id: 1,
    date: "2026-01-02",
    description: "Expense and transfer to excluded cash",
    created_at: "2026-01-02",
    lines: lines.map(([account_id, debit, credit, currency = "JPY"], index) => ({
      id: index + 1,
      journal_entry_id: 1,
      account_id,
      account_name: `Account ${account_id}`,
      debit,
      credit,
      currency,
    })),
    budget_allocations: [
      { budget_category_id: 1, amount: -2_000, currency: "JPY" },
      { budget_category_id: 2, amount: -(allocated - 2_000), currency: "JPY" },
    ],
  };
}

describe("expense checks with transfers to excluded cash", () => {
  test("accepts the full budget decrease funded by a deducted credit card without mutating saved data", () => {
    const entry = compound();
    const before = structuredClone(entry);
    expect(getSuspiciousReasons(entry, accounts(), "ja")).toEqual([]);
    expect(entry).toEqual(before);
  });

  test("accepts a transfer funded by tracked cash", () => {
    expect(getSuspiciousReasons(compound([[1, 0, 10_000], [4, 2_000, 0], [3, 8_000, 0]]), accounts(), "en")).toEqual([]);
  });

  test("keeps existing expense-only allocations valid", () => {
    expect(getSuspiciousReasons(compound(undefined, 2_000), accounts(), "ja")).toEqual([]);
  });

  test.each([9_999, 10_001, 9_000])("still flags an incorrect full allocation of %i", (allocated) => {
    expect(getSuspiciousReasons(compound(undefined, allocated), accounts(), "ja")).toHaveLength(1);
  });

  test("does not excuse extra allocations when the receiving cash is budget eligible", () => {
    const map = accounts();
    map.set(3, account(3));
    expect(getSuspiciousReasons(compound(), map, "ja")).toHaveLength(1);
  });

  test("does not treat an excluded credit card as a budget source", () => {
    const map = accounts();
    map.set(2, account(2, { type: "liability", category: "credit_card", deduct_from_budget: false }));
    expect(getSuspiciousReasons(compound(), map, "ja")).toHaveLength(1);
  });

  test("nets multiple excluded cash movements rather than using gross receipts", () => {
    const entry = compound([[1, 0, 8_000], [4, 2_000, 0], [3, 8_000, 0], [5, 0, 2_000]], 8_000);
    expect(getSuspiciousReasons(entry, accounts(), "ja")).toEqual([]);
    entry.budget_allocations![1].amount = -8_000;
    expect(getSuspiciousReasons(entry, accounts(), "ja")).toHaveLength(1);
  });

  test("an excluded cash payment does not justify a missing expense allocation", () => {
    const entry = compound([[1, 0, 1_000], [3, 0, 1_000], [4, 2_000, 0]], 1_000);
    expect(getSuspiciousReasons(entry, accounts(), "ja")).toHaveLength(1);
  });

  test("retains active and reference expense allocation checks", () => {
    const entry = compound();
    entry.budget_allocations![1].is_reference = true;
    expect(getSuspiciousReasons(entry, accounts(), "ja")).toHaveLength(1);
    const mixedPayment = compound([[1, 0, 1_000], [3, 0, 1_000], [4, 2_000, 0]], 2_000);
    mixedPayment.budget_allocations![1].is_reference = true;
    expect(getSuspiciousReasons(mixedPayment, accounts(), "ja")).toEqual([]);
  });

  test("does not count a separately recorded budget transfer twice", () => {
    const entry = compound();
    entry.income_budget_allocations = [{ budget_category_id: 2, amount: -8_000, currency: "JPY", adjustment_type: "transfer" }];
    expect(getSuspiciousReasons(entry, accounts(), "ja")).toHaveLength(1);
    entry.budget_allocations![1].amount = 0;
    expect(getSuspiciousReasons(entry, accounts(), "ja")).toEqual([]);
  });

  test.each([7, 8, 6, 99])("does not infer an excluded cash transfer from loan, advance, income, or unknown account %i", (accountId) => {
    expect(getSuspiciousReasons(compound([[1, 0, 10_000], [4, 2_000, 0], [accountId, 8_000, 0]]), accounts(), "ja")).toHaveLength(1);
  });

  test("does not count the separately excluded business advance category", () => {
    expect(getSuspiciousReasons(compound(), accounts(), "ja", 2)).toEqual([]);
    const entry = compound();
    entry.budget_allocations!.push({ budget_category_id: 3, amount: -8_000, currency: "JPY" });
    expect(getSuspiciousReasons(entry, accounts(), "ja", 2)).toHaveLength(1);
  });

  test("does not infer transfers into depreciable cash accounts", () => {
    const map = accounts();
    map.set(3, account(3, { include_in_allocatable: false, is_depreciable: true }));
    expect(getSuspiciousReasons(compound(), map, "ja")).toHaveLength(1);
  });

  test("requires the journal's budget resource reduction to match the proposed comparison", () => {
    expect(getSuspiciousReasons(compound([[2, 0, 9_999], [4, 2_000, 0], [3, 8_000, 0]]), accounts(), "ja")).toHaveLength(1);
  });

  test("cannot use another currency's excluded receipt to explain this currency's allocation", () => {
    expect(getSuspiciousReasons(compound([[2, 0, 10_000], [4, 2_000, 0], [3, 8_000, 0, "USD"]]), accounts(), "ja")).toHaveLength(1);
  });

  test("checks compound allocations separately for each currency", () => {
    const entry = compound();
    entry.lines.push(...compound([[1, 0, 50, "usd"], [4, 20, 0, "USD"], [3, 30, 0, "USD"]]).lines);
    entry.budget_allocations!.push({ budget_category_id: 2, amount: -50, currency: "USD" });
    expect(getSuspiciousReasons(entry, accounts(), "ja")).toEqual([]);
    entry.budget_allocations![1].amount += 1;
    expect(getSuspiciousReasons(entry, accounts(), "ja")).toHaveLength(1);
  });

  test("does not hide an unrelated currency's mismatch when a valid transfer is present", () => {
    const entry = compound();
    entry.lines.push(...compound([[1, 0, 50, "USD"], [4, 50, 0, "USD"]]).lines);
    entry.budget_allocations!.push({ budget_category_id: 2, amount: -49, currency: "USD" });
    expect(getSuspiciousReasons(entry, accounts(), "ja")).toHaveLength(1);
  });

  test("ordinary expenses still warn for a one-yen difference", () => {
    expect(getSuspiciousReasons(compound([[1, 0, 2_000], [4, 2_000, 0]], 2_001), accounts(), "ja")).toHaveLength(1);
  });
});
