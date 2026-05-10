import { describe, expect, test } from "bun:test";

import type { Account, JournalEntry } from "@balance-sheet/shared";
import { getSuspiciousReasons } from "../src/components/tt/ttUtils";

function account(overrides: Partial<Account>): Account {
  return {
    id: overrides.id ?? 1,
    name: overrides.name ?? "Account",
    type: overrides.type ?? "expense",
    category: overrides.category ?? "other",
    currency: overrides.currency ?? "JPY",
    is_depreciable: overrides.is_depreciable ?? false,
    include_in_allocatable: overrides.include_in_allocatable ?? true,
    created_at: overrides.created_at ?? "2026-05-01 00:00:00",
    budget_ratios: overrides.budget_ratios,
  };
}

function entry(overrides: Partial<JournalEntry>): JournalEntry {
  return {
    id: overrides.id ?? 1,
    date: overrides.date ?? "2026-05-02",
    description: overrides.description ?? "Entry",
    source: overrides.source ?? "manual",
    created_at: overrides.created_at ?? "2026-05-02 13:39:08",
    lines: overrides.lines ?? [],
    budget_allocations: overrides.budget_allocations,
    income_budget_allocations: overrides.income_budget_allocations,
  };
}

describe("getSuspiciousReasons", () => {
  test("does not flag budget-excluded compound entries without explicit budget allocations", () => {
    const accounts = new Map([
      [
        16,
        account({
          id: 16,
          name: "臨時収入",
          type: "income",
        }),
      ],
      [
        22,
        account({
          id: 22,
          name: "娯楽費",
          type: "expense",
          budget_ratios: [{ budget_category_id: 2, ratio: 100 }],
        }),
      ],
    ]);

    const reasons = getSuspiciousReasons(
      entry({
        description: "IFTTT Pro",
        lines: [
          {
            id: 1,
            journal_entry_id: 1192,
            account_id: 16,
            account_name: "臨時収入",
            debit: 629,
            credit: 0,
            currency: "JPY",
          },
          {
            id: 2,
            journal_entry_id: 1192,
            account_id: 22,
            account_name: "娯楽費",
            debit: 0,
            credit: 629,
            currency: "JPY",
          },
        ],
      }),
      accounts,
      "ja",
    );

    expect(reasons).toEqual([]);
  });

  test("flags mismatches only when explicit expense budget allocations exist", () => {
    const accounts = new Map([
      [
        22,
        account({
          id: 22,
          name: "娯楽費",
          type: "expense",
          budget_ratios: [{ budget_category_id: 2, ratio: 100 }],
        }),
      ],
    ]);

    const reasons = getSuspiciousReasons(
      entry({
        lines: [
          {
            id: 1,
            journal_entry_id: 10,
            account_id: 22,
            account_name: "娯楽費",
            debit: 1000,
            credit: 0,
            currency: "JPY",
          },
        ],
        budget_allocations: [{ budget_category_id: 2, amount: -500 }],
      }),
      accounts,
      "en",
    );

    expect(reasons).toHaveLength(1);
  });
});
