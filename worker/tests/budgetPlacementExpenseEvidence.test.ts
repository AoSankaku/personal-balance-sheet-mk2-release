import { expect, test } from "bun:test";
import { buildBudgetPlacementExpenseEvidence } from "../src/lib/budgetPlacementExpenseEvidence";

const accounts = [
  { id: 1, name: "Main cash", type: "asset", category: "cash" },
  { id: 2, name: "Groceries", type: "expense", category: "daily" },
  { id: 3, name: "Investments", type: "asset", category: "crypto" },
  { id: 4, name: "Transport", type: "expense", category: "daily" },
];

const groups = [
  { group_id: "reserve", account_ids: [3], categories: [{ budget_category_id: 10 }, { budget_category_id: 11 }] },
  { group_id: "already-held", account_ids: [1], categories: [{ budget_category_id: 12 }] },
];

function allocation(journal_entry_id: number, budget_category_id: number, amount: number, suffix = "purchase") {
  return { journal_entry_id, budget_category_id, amount, date: "2026-08-01", description: `${suffix} ${journal_entry_id}` };
}

function line(journal_entry_id: number, account_id: number, debit: number, credit: number) {
  return { journal_entry_id, account_id, debit, credit, currency: "USD" };
}

test("groups eligible expense evidence once while preserving eligibility, order, and currency precision", () => {
  const result = buildBudgetPlacementExpenseEvidence({
    allocations: [
      allocation(20, 10, -100, "multi"),
      allocation(20, 11, -200, "multi"),
      allocation(10, 10, -1234),
      allocation(30, 10, -50, "extra-line"),
      allocation(40, 10, -75, "non-cash"),
      allocation(50, 10, -99, "mismatched-allocation"),
      allocation(60, 12, -250, "already-held"),
    ],
    lines: [
      line(10, 2, 1234, 0), line(10, 1, 0, 1234),
      line(20, 2, 300, 0), line(20, 1, 0, 300),
      line(30, 2, 50, 0), line(30, 4, 1, 0), line(30, 1, 0, 50),
      line(40, 2, 75, 0), line(40, 3, 0, 75),
      line(50, 2, 100, 0), line(50, 1, 0, 100),
      line(60, 2, 250, 0), line(60, 1, 0, 250),
    ],
    accounts,
    summaries: [10, 11, 12].map(id => ({ category: { id, name: `Category ${id}` } })),
    groups,
    currency: "USD",
    decimalPlacesByCurrency: { USD: 2 },
  });

  expect(result).toEqual([
    {
      journal_entry_id: 20, date: "2026-08-01", description: "multi 20",
      budget_category_id: 10, budget_category_name: "Category 10",
      from_account_id: 1, from_account_name: "Main cash", to_group_id: "reserve", amount: 1,
    },
    {
      journal_entry_id: 20, date: "2026-08-01", description: "multi 20",
      budget_category_id: 11, budget_category_name: "Category 11",
      from_account_id: 1, from_account_name: "Main cash", to_group_id: "reserve", amount: 2,
    },
    {
      journal_entry_id: 10, date: "2026-08-01", description: "purchase 10",
      budget_category_id: 10, budget_category_name: "Category 10",
      from_account_id: 1, from_account_name: "Main cash", to_group_id: "reserve", amount: 12.34,
    },
  ]);
});

test("journal-entry indexing reads source IDs linearly as the input doubles", () => {
  const countReads = (entryCount: number) => {
    let reads = 0;
    const instrument = <T extends { journal_entry_id: number }>(row: T): T => {
      const id = row.journal_entry_id;
      Object.defineProperty(row, "journal_entry_id", {
        enumerable: true,
        get() { reads++; return id; },
      });
      return row;
    };
    const allocations = Array.from({ length: entryCount }, (_, index) => instrument({
      journal_entry_id: index + 1, budget_category_id: 10, amount: -1,
      date: "2026-08-01", description: "purchase",
    }));
    const lines = Array.from({ length: entryCount }, (_, index) => [
      instrument({ journal_entry_id: index + 1, account_id: 2, debit: 1, credit: 0, currency: "USD" }),
      instrument({ journal_entry_id: index + 1, account_id: 1, debit: 0, credit: 1, currency: "USD" }),
    ]).flat();

    buildBudgetPlacementExpenseEvidence({
      allocations, lines, accounts, summaries: [{ category: { id: 10, name: "Food" } }],
      groups: [{ group_id: "reserve", account_ids: [3], categories: [{ budget_category_id: 10 }] }],
      currency: "USD", decimalPlacesByCurrency: { USD: 2 },
    });
    return reads;
  };

  const readsAt32 = countReads(32);
  const readsAt64 = countReads(64);
  expect(readsAt32).toBeGreaterThan(0);
  expect(readsAt64).toBeLessThanOrEqual(readsAt32 * 2 + 8);
});
