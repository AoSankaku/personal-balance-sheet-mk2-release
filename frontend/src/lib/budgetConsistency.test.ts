import { describe, expect, test } from "bun:test";
import type { Account, JournalEntry } from "@balance-sheet/shared";
import {
  findPreResetCreditCardSettlements,
  getExcludedCashBudgetConsumptionAmount,
  getUnallocatedAllocatableIncomeAmount,
  hasBudgetAllocationMismatch,
} from "./budgetConsistency";

function account(
  id: number,
  type: Account["type"],
  category: Account["category"],
  includeInAllocatable = true,
): Account {
  return {
    id,
    name: `account-${id}`,
    type,
    category,
    include_in_allocatable: includeInAllocatable,
    balance: 0,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

function entry(
  id: number,
  date: string,
  createdAt: string,
  lines: Array<[number, number, number]>,
  extra: Partial<JournalEntry> = {},
): JournalEntry {
  return {
    id,
    date,
    description: `entry-${id}`,
    created_at: createdAt,
    lines: lines.map(([accountId, debit, credit], index) => ({
      id: id * 10 + index,
      journal_entry_id: id,
      account_id: accountId,
      account_name: `account-${accountId}`,
      debit,
      credit,
      currency: "JPY",
    })),
    ...extra,
  };
}

describe("budget consistency", () => {
  test("flags a one-yen discrepancy", () => {
    expect(hasBudgetAllocationMismatch(965, 966)).toBe(true);
  });

  test("does not flag equal amounts", () => {
    expect(hasBudgetAllocationMismatch(965, 965)).toBe(false);
  });

  test("finds income received into an allocatable account without allocation", () => {
    const accounts = new Map([
      [1, account(1, "asset", "cash")],
      [2, account(2, "income", "other")],
    ]);
    const journalEntry = entry(1, "2026-06-01", "2026-06-01T00:00:00Z", [
      [1, 245, 0],
      [2, 0, 245],
    ]);

    expect(
      getUnallocatedAllocatableIncomeAmount(journalEntry, accounts, "JPY"),
    ).toBe(245);
  });

  test("does not flag income received outside allocatable accounts", () => {
    const accounts = new Map([
      [1, account(1, "asset", "cash", false)],
      [2, account(2, "income", "other")],
    ]);
    const journalEntry = entry(1, "2026-06-01", "2026-06-01T00:00:00Z", [
      [1, 245, 0],
      [2, 0, 245],
    ]);

    expect(
      getUnallocatedAllocatableIncomeAmount(journalEntry, accounts, "JPY"),
    ).toBe(0);
  });

  test("finds budget consumption paid from excluded cash", () => {
    const accounts = new Map([
      [1, account(1, "asset", "cash", false)],
      [2, account(2, "expense", "food")],
    ]);
    const journalEntry = entry(
      1,
      "2026-07-01",
      "2026-07-01T00:00:00Z",
      [
        [2, 1_180, 0],
        [1, 0, 1_180],
      ],
      {
        budget_allocations: [
          { budget_category_id: 1, amount: -1_180, currency: "JPY" },
        ],
      },
    );

    expect(
      getExcludedCashBudgetConsumptionAmount(
        journalEntry,
        accounts,
        "JPY",
      ),
    ).toBe(1_180);
  });

  test("attributes later payments to pre-reset card debt before new debt", () => {
    const accounts = new Map([
      [1, account(1, "asset", "cash")],
      [2, account(2, "liability", "credit_card")],
      [3, account(3, "expense", "other")],
    ]);
    const journal = [
      entry(1, "2026-04-20", "2026-04-20T00:00:00Z", [
        [3, 100, 0],
        [2, 0, 100],
      ]),
      entry(2, "2026-05-10", "2026-05-10T00:00:00Z", [
        [3, 30, 0],
        [2, 0, 30],
      ]),
      entry(3, "2026-05-27", "2026-05-27T00:00:00Z", [
        [2, 80, 0],
        [1, 0, 80],
      ]),
      entry(4, "2026-06-27", "2026-06-27T00:00:00Z", [
        [2, 50, 0],
        [1, 0, 50],
      ]),
    ];

    expect(
      findPreResetCreditCardSettlements(
        journal,
        accounts,
        { date: "2026-05-01", created_at: "2026-05-01T12:00:00Z" },
        "JPY",
      ).map(({ entry: settledEntry, amount }) => ({
        id: settledEntry.id,
        amount,
      })),
    ).toEqual([
      { id: 3, amount: 80 },
      { id: 4, amount: 20 },
    ]);
  });

  test("reduces carried card debt with a non-cash credit before a payment", () => {
    const accounts = new Map([
      [1, account(1, "asset", "cash")],
      [2, account(2, "liability", "credit_card")],
      [3, account(3, "expense", "other")],
      [4, account(4, "income", "other")],
    ]);
    const journal = [
      entry(1, "2026-04-20", "2026-04-20T00:00:00Z", [
        [3, 100, 0],
        [2, 0, 100],
      ]),
      entry(2, "2026-05-10", "2026-05-10T00:00:00Z", [
        [2, 30, 0],
        [4, 0, 30],
      ]),
      entry(3, "2026-05-27", "2026-05-27T00:00:00Z", [
        [2, 80, 0],
        [1, 0, 80],
      ]),
    ];

    expect(
      findPreResetCreditCardSettlements(
        journal,
        accounts,
        { date: "2026-05-01", created_at: "2026-05-01T12:00:00Z" },
        "JPY",
      ).map(({ amount }) => amount),
    ).toEqual([70]);
  });
});
