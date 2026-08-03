import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import type {
  IncomeTransferRequirement,
  JournalEntry,
} from "@balance-sheet/shared";
import {
  connectedTargetAccounts,
  groupIncomeTransferRequirements,
  isMatchingPureTransfer,
  squashIncomeTransferRequirements,
} from "../src/lib/incomeTransferRequirements";

const routeSource = readFileSync(
  join(import.meta.dir, "../src/routes/incomeTransferRequirements.ts"),
  "utf8",
);

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

function balancesOf(
  transfers: ReturnType<typeof squashIncomeTransferRequirements>,
) {
  const balances = new Map<string, number>();
  for (const transfer of transfers) {
    const fromKey = `${transfer.currency}:${transfer.from_account_id}`;
    const toKey = `${transfer.currency}:${transfer.to_account_id}`;
    balances.set(fromKey, (balances.get(fromKey) ?? 0) - transfer.amount);
    balances.set(toKey, (balances.get(toKey) ?? 0) + transfer.amount);
  }
  return Object.fromEntries([...balances.entries()].sort());
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

  test("groups one squashed completion by its shared journal entry", () => {
    const groups = groupIncomeTransferRequirements([
      requirement({
        id: 1,
        source_income_journal_entry_id: 10,
        from_account_id: 100,
        to_account_id: 200,
        transfer_journal_entry_id: 99,
        completion_source: "created",
        completed_at: "2026-08-02T00:00:00Z",
      }),
      requirement({
        id: 2,
        source_income_journal_entry_id: 11,
        from_account_id: 200,
        to_account_id: 300,
        transfer_journal_entry_id: 99,
        completion_source: "created",
        completed_at: "2026-08-02T00:00:00Z",
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.is_squashed).toBe(true);
    expect(groups[0]?.requirement_ids).toEqual([1, 2]);
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

describe("income transfer squashing", () => {
  test("collapses a transfer chain to one direct transfer", () => {
    const transfers = squashIncomeTransferRequirements([
      { from_account_id: 1, to_account_id: 2, amount: 10, currency: "jpy" },
      { from_account_id: 2, to_account_id: 3, amount: 10, currency: "JPY" },
    ]);

    expect(transfers).toEqual([
      { from_account_id: 1, to_account_id: 3, amount: 10, currency: "JPY" },
    ]);
  });

  test("finds the exact minimum instead of accepting a four-transfer greedy plan", () => {
    const transfers = squashIncomeTransferRequirements([
      { from_account_id: 1, to_account_id: 4, amount: 8, currency: "JPY" },
      { from_account_id: 2, to_account_id: 4, amount: 2, currency: "JPY" },
      { from_account_id: 2, to_account_id: 5, amount: 3, currency: "JPY" },
      { from_account_id: 3, to_account_id: 5, amount: 5, currency: "JPY" },
    ]);

    expect(transfers).toHaveLength(3);
    expect(balancesOf(transfers)).toEqual({
      "JPY:1": -8,
      "JPY:2": -5,
      "JPY:3": -5,
      "JPY:4": 10,
      "JPY:5": 8,
    });
  });

  test("does not net balances across currencies", () => {
    const transfers = squashIncomeTransferRequirements([
      { from_account_id: 1, to_account_id: 2, amount: 10, currency: "JPY" },
      { from_account_id: 2, to_account_id: 1, amount: 10, currency: "USD" },
    ]);

    expect(transfers).toHaveLength(2);
  });

  test("returns no transfer when every movement is offset", () => {
    expect(
      squashIncomeTransferRequirements([
        { from_account_id: 1, to_account_id: 2, amount: 10, currency: "JPY" },
        { from_account_id: 2, to_account_id: 1, amount: 10, currency: "JPY" },
      ]),
    ).toEqual([]);
  });
});

describe("income transfer journal descriptions", () => {
  test("uses descriptions supplied by the localized client", () => {
    expect(routeSource).toContain("body.description");
    expect(routeSource).not.toContain("Income allocation transfer:");
    expect(routeSource).not.toContain("Income allocation transfers (squashed):");
  });
});
