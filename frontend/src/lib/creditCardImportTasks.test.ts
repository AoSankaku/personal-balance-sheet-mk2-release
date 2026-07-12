import { describe, expect, test } from "bun:test";
import type {
  Account,
  CreditCardSettings,
  CreditCardStateEntry,
  JournalEntry,
} from "@balance-sheet/shared";
import { computeCreditCardImportTasks } from "./creditCardImportTasks";

const account: Account = {
  id: 10,
  name: "Main card",
  type: "liability",
  category: "credit_card",
  created_at: "2026-01-01T00:00:00Z",
};

const settings: CreditCardSettings = {
  id: 1,
  account_id: account.id,
  closing_day: 15,
  confirmation_day: 20,
  withdrawal_day: 10,
  billing_offset_months: 0,
  created_at: "2026-01-01T00:00:00Z",
};

function usageEntry(date: string): JournalEntry {
  return {
    id: 1,
    date,
    description: "purchase",
    created_at: `${date}T00:00:00Z`,
    lines: [
      {
        id: 1,
        journal_entry_id: 1,
        account_id: account.id,
        account_name: account.name,
        debit: 0,
        credit: 1_000,
        currency: "JPY",
      },
    ],
  };
}

describe("computeCreditCardImportTasks", () => {
  test("returns the usage month for a statement that is ready to import", () => {
    const tasks = computeCreditCardImportTasks({
      today: new Date("2026-07-20T12:00:00+09:00"),
      accounts: [account],
      creditCardSettings: [settings],
      creditCardState: [],
      journal: [usageEntry("2026-06-10")],
    });

    expect(tasks).toEqual([
      {
        id: "credit-card-import-10-2026-06",
        accountId: 10,
        creditCardName: "Main card",
        statementMonth: "2026-06",
        paymentMonth: "2026-07",
        usagePeriod: { start: "2026-05-16", end: "2026-06-15" },
      },
    ]);
  });

  test("does not return a task before the confirmation day", () => {
    expect(
      computeCreditCardImportTasks({
        today: new Date("2026-07-19T12:00:00+09:00"),
        accounts: [account],
        creditCardSettings: [settings],
        creditCardState: [],
        journal: [usageEntry("2026-06-10")],
      }),
    ).toEqual([]);
  });

  test("does not return a task after the payment month was saved", () => {
    const savedState: CreditCardStateEntry = {
      id: 1,
      account_id: account.id,
      account_name: account.name,
      payment_month: "2026-07",
      status: "confirmed",
      amount: 0,
      last_updated_at: "2026-07-20T00:00:00Z",
    };

    expect(
      computeCreditCardImportTasks({
        today: new Date("2026-07-20T12:00:00+09:00"),
        accounts: [account],
        creditCardSettings: [settings],
        creditCardState: [savedState],
        journal: [usageEntry("2026-06-10")],
      }),
    ).toEqual([]);
  });

  test("does not return a task without usage in the statement period", () => {
    expect(
      computeCreditCardImportTasks({
        today: new Date("2026-07-20T12:00:00+09:00"),
        accounts: [account],
        creditCardSettings: [settings],
        creditCardState: [],
        journal: [usageEntry("2026-06-16")],
      }),
    ).toEqual([]);
  });

  test("applies an additional billing offset to the usage month", () => {
    const tasks = computeCreditCardImportTasks({
      today: new Date("2026-07-20T12:00:00+09:00"),
      accounts: [account],
      creditCardSettings: [{ ...settings, billing_offset_months: 1 }],
      creditCardState: [],
      journal: [usageEntry("2026-05-10")],
    });

    expect(tasks[0]?.statementMonth).toBe("2026-05");
    expect(tasks[0]?.paymentMonth).toBe("2026-07");
  });
});
