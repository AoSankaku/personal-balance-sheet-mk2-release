import { describe, expect, test } from "bun:test";
import type {
  IncomeTransferRequirement,
  JournalEntry,
} from "@balance-sheet/shared";
import {
  connectedTargetAccounts,
  groupIncomeTransferRequirements,
  isMatchingPureTransfer,
} from "../src/lib/incomeTransferRequirements";

function requirement(
  overrides: Partial<IncomeTransferRequirement>,
): IncomeTransferRequirement {
  return {
    id: overrides.id ?? 1,
    source_income_journal_entry_id:
      overrides.source_income_journal_entry_id ?? 10,
    budget_category_id: overrides.budget_category_id ?? 1,
    budget_category_name: overrides.budget_category_name ?? "Daily",
    from_account_id: overrides.from_account_id ?? 100,
    to_account_id: overrides.to_account_id ?? 200,
    amount: overrides.amount ?? 30,
    currency: overrides.currency ?? "JPY",
    transfer_journal_entry_id:
      overrides.transfer_journal_entry_id ?? null,
    completion_source: overrides.completion_source ?? null,
    created_at: overrides.created_at ?? "2026-07-01 00:00:00",
    completed_at: overrides.completed_at ?? null,
  };
}

describe("income transfer requirement grouping", () => {
  test("combines categories sharing source, destination, and currency", () => {
    const groups = groupIncomeTransferRequirements([
      requirement({ id: 1, budget_category_id: 1, amount: 30 }),
      requirement({ id: 2, budget_category_id: 2, amount: 20 }),
      requirement({ id: 3, to_account_id: 300, amount: 10 }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      requirement_ids: [1, 2],
      amount: 50,
      from_account_id: 100,
      to_account_id: 200,
    });
  });
});

describe("historical placement groups", () => {
  test("finds every account connected through shared category targets", () => {
    expect(
      connectedTargetAccounts(
        1,
        [
          { budget_category_id: 1, account_id: 10 },
          { budget_category_id: 1, account_id: 20 },
          { budget_category_id: 2, account_id: 20 },
          { budget_category_id: 2, account_id: 30 },
          { budget_category_id: 3, account_id: 40 },
        ],
      ),
    ).toEqual(new Set([10, 20, 30]));
  });
});

describe("pure transfer candidate matching", () => {
  const entry: JournalEntry = {
    id: 50,
    date: "2026-07-03",
    description: "Transfer",
    created_at: "2026-07-03 00:00:00",
    lines: [
      {
        id: 1,
        journal_entry_id: 50,
        account_id: 200,
        account_name: "Destination",
        debit: 50,
        credit: 0,
        currency: "JPY",
      },
      {
        id: 2,
        journal_entry_id: 50,
        account_id: 100,
        account_name: "Source",
        debit: 0,
        credit: 50,
        currency: "JPY",
      },
    ],
  };

  test("accepts only the exact debit-destination/credit-source transfer", () => {
    expect(
      isMatchingPureTransfer(entry, {
        from_account_id: 100,
        to_account_id: 200,
        amount: 50,
        currency: "JPY",
      }),
    ).toBe(true);
    expect(
      isMatchingPureTransfer(
        {
          ...entry,
          lines: [...entry.lines, { ...entry.lines[0]!, id: 3, debit: 1 }],
        },
        {
          from_account_id: 100,
          to_account_id: 200,
          amount: 50,
          currency: "JPY",
        },
      ),
    ).toBe(false);
  });
});
