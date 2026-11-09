import { describe, expect, test } from "bun:test";
import type { Account, JournalEntry } from "@balance-sheet/shared";
import { buildExpenseHistorySnapshot } from "./expenseHistoryStorage";

const accounts = [
  { id: 1, name: "Meals", type: "expense", is_system: false },
  { id: 2, name: "Travel", type: "expense", is_system: false },
] as Account[];
const entry = (id: number, date: string, amount: number, tags: number[], currency = "JPY"): JournalEntry => ({
  id, date, description: "Synthetic expense", created_at: date,
  expense_tags: tags.map(id => ({ id, name: `Tag ${id}` })),
  lines: [{ id, journal_entry_id: id, account_id: 1, debit: amount, credit: 0, currency }],
} as JournalEntry);
const journal = [
  entry(1, "2026-01-10", 1_000, [1]),
  entry(2, "2026-09-10", 2_000, [1, 2]),
  entry(3, "2026-09-12", 5_000, [2]),
  entry(4, "2026-10-01", 8_000, []),
  entry(5, "2026-09-15", 12.34, [1], "USD"),
];

describe("tag-filtered expense chart history", () => {
  test("uses the selected tag across months and currencies without changing source data", () => {
    const original = JSON.stringify(journal);
    const snapshot = buildExpenseHistorySnapshot(journal, accounts, [1]);
    expect(snapshot.buckets.month["2026-01"]?.total_by_currency).toEqual({ JPY: 1_000 });
    expect(snapshot.buckets.month["2026-09"]?.total_by_currency).toEqual({ JPY: 2_000, USD: 12.34 });
    expect(snapshot.buckets.month["2026-10"]).toBeUndefined();
    expect(snapshot.buckets.year["2026"]?.total_by_currency).toEqual({ JPY: 3_000, USD: 12.34 });
    expect(JSON.stringify(journal)).toBe(original);
  });

  test("counts an entry matching several selected tags only once", () => {
    const snapshot = buildExpenseHistorySnapshot(journal, accounts, [1, 2, 1]);
    expect(snapshot.buckets.month["2026-09"]?.accounts["1"]?.total_by_currency).toEqual({ JPY: 7_000, USD: 12.34 });
    expect(snapshot.source.journal_count).toBe(4);
  });

  test("clearing tags restores all expenses and unmatched tags produce no buckets", () => {
    expect(buildExpenseHistorySnapshot(journal, accounts).buckets.year["2026"]?.total_by_currency).toEqual({ JPY: 16_000, USD: 12.34 });
    expect(buildExpenseHistorySnapshot(journal, accounts, []).buckets.year["2026"]?.total_by_currency).toEqual({ JPY: 16_000, USD: 12.34 });
    const unmatched = buildExpenseHistorySnapshot(journal, accounts, [999]);
    expect(unmatched.buckets).toEqual({ month: {}, year: {} });
    expect(unmatched.source.journal_count).toBe(0);
  });
});
