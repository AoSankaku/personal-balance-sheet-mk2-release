import { describe, expect, test } from "bun:test";

import { cardBookChangeInPeriod } from "../src/components/tt/ttUtils";
import type {
  Account,
  CreditCardSettings,
  JournalEntry,
} from "@balance-sheet/shared";

const accounts: Account[] = [
  {
    id: 10,
    name: "Main Bank",
    type: "asset",
    category: "cash",
    created_at: "2026-05-01T00:00:00.000Z",
  },
  {
    id: 14,
    name: "__system:opening_balance__",
    type: "equity",
    category: "opening_balance",
    is_system: true,
    created_at: "2026-05-01T00:00:00.000Z",
  },
  {
    id: 20,
    name: "Credit Card",
    type: "liability",
    category: "credit_card",
    created_at: "2026-05-01T00:00:00.000Z",
  },
  {
    id: 30,
    name: "Food",
    type: "expense",
    category: "food",
    created_at: "2026-05-01T00:00:00.000Z",
  },
];

const settings: CreditCardSettings = {
  id: 1,
  account_id: 20,
  closing_day: 0,
  confirmation_day: 12,
  withdrawal_day: 27,
  billing_offset_months: 0,
  withdrawal_account_id: 10,
  created_at: "2026-05-01T00:00:00.000Z",
};

function entry(
  id: number,
  date: string,
  description: string,
  lines: JournalEntry["lines"],
): JournalEntry {
  return {
    id,
    date,
    description,
    created_at: `${date}T00:00:00.000Z`,
    lines,
  };
}

describe("cardBookChangeInPeriod", () => {
  test("includes opening balance entries in credit-card deviation book value", () => {
    const journal: JournalEntry[] = [
      entry(1, "2025-01-25", "card purchase", [
        {
          id: 1,
          journal_entry_id: 1,
          account_id: 30,
          account_name: "Food",
          debit: 31_744,
          credit: 0,
          currency: "JPY",
        },
        {
          id: 2,
          journal_entry_id: 1,
          account_id: 20,
          account_name: "Credit Card",
          debit: 0,
          credit: 31_744,
          currency: "JPY",
        },
      ]),
      entry(2, "2025-01-31", "opening balance for card", [
        {
          id: 3,
          journal_entry_id: 2,
          account_id: 20,
          account_name: "Credit Card",
          debit: 31_744,
          credit: 0,
          currency: "JPY",
        },
        {
          id: 4,
          journal_entry_id: 2,
          account_id: 14,
          account_name: "__system:opening_balance__",
          debit: 0,
          credit: 31_744,
          currency: "JPY",
        },
      ]),
      entry(3, "2025-02-27", "card withdrawal", [
        {
          id: 5,
          journal_entry_id: 3,
          account_id: 20,
          account_name: "Credit Card",
          debit: 31_744,
          credit: 0,
          currency: "JPY",
        },
        {
          id: 6,
          journal_entry_id: 3,
          account_id: 10,
          account_name: "Main Bank",
          debit: 0,
          credit: 31_744,
          currency: "JPY",
        },
      ]),
    ];

    expect(
      cardBookChangeInPeriod(
        20,
        "2025-01",
        "2026-05-01",
        "2025-01-01",
        "2025-01-31",
        settings,
        journal,
        accounts,
      ),
    ).toBe(0);
  });
});
