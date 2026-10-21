import { describe, expect, test } from "bun:test";
import type { Account, JournalEntry } from "@balance-sheet/shared";
import { getBudgetCheckTotals, getSuspiciousReasons } from "./ttUtils";
import { getUnallocatedAllocatableIncomeAmount } from "../../lib/budgetConsistency";

const accountMap = new Map([
  { id: 1, name: "Bank", type: "asset", category: "cash", include_in_allocatable: true },
  { id: 2, name: "Investment", type: "asset", category: "investment", include_in_allocatable: false },
  { id: 3, name: "Gain", type: "income", category: "investment" },
].map(account => [account.id, { ...account, created_at: "2026-01-01" } as Account]));
function sale(allocations: NonNullable<JournalEntry["income_budget_allocations"]>): JournalEntry {
  return {
    id: 1, date: "2026-10-21", created_at: "2026-10-21 01:00:00", description: "Investment sale",
    lines: [[1, 120000, 0], [2, 0, 100000], [3, 0, 20000]].map(([account_id, debit, credit], index) => ({
      id: index + 1, journal_entry_id: 1, account_id, account_name: accountMap.get(account_id)!.name,
      debit, credit, currency: "JPY",
    })),
    income_budget_allocations: allocations,
  };
}
describe("income budget checks separate returned investment principal", () => {
  test("only earned income is compared with the gain account", () => {
    const entry = sale([
      { budget_category_id: 1, amount: 20000, adjustment_type: "allocation" },
      { budget_category_id: 1, amount: 100000, adjustment_type: "transfer" },
    ]);
    expect(getBudgetCheckTotals(entry, accountMap).totalIncomeAllocated).toBe(20000);
    expect(getSuspiciousReasons(entry, accountMap, "ja")).toEqual([]);
    expect(getUnallocatedAllocatableIncomeAmount(entry, accountMap, "JPY")).toBe(0);
  });
  test("returning principal alone does not hide an unallocated gain", () => {
    const entry = sale([{ budget_category_id: 1, amount: 100000, adjustment_type: "transfer" }]);
    expect(getUnallocatedAllocatableIncomeAmount(entry, accountMap, "JPY")).toBe(20000);
  });
  test("a real one-yen income allocation difference is still detected", () => {
    const entry = sale([
      { budget_category_id: 1, amount: 19999 },
      { budget_category_id: 1, amount: 100000, adjustment_type: "transfer" },
    ]);
    expect(getSuspiciousReasons(entry, accountMap, "ja")).toHaveLength(1);
  });
  test("ordinary income allocations without an explicit kind still count", () => {
    expect(getBudgetCheckTotals(sale([{ budget_category_id: 1, amount: 20000 }]), accountMap).totalIncomeAllocated).toBe(20000);
  });
});
