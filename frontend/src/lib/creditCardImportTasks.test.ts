import { describe, expect, test } from "bun:test";
import type {
  Account,
  CreditCardSettings,
  CreditCardStatementCompletion,
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

describe("computeCreditCardImportTasks", () => {
  test("returns the usage month even when the statement has no usage", () => {
    const tasks = computeCreditCardImportTasks({
      today: new Date("2026-07-20T12:00:00+09:00"),
      accounts: [account],
      creditCardSettings: [settings],
      completions: [],
    });

    expect(tasks).toEqual([
      {
        id: "credit-card-import-10-2026-06",
        accountId: 10,
        creditCardName: "Main card",
        statementMonth: "2026-06",
        paymentMonth: "2026-07",
      },
    ]);
  });

  test("does not return a task before the confirmation day", () => {
    expect(
      computeCreditCardImportTasks({
        today: new Date("2026-07-19T12:00:00+09:00"),
        accounts: [account],
        creditCardSettings: [settings],
        completions: [],
      }),
    ).toEqual([]);
  });

  test("does not return a task after the statement was completed", () => {
    const completion: CreditCardStatementCompletion = {
      id: 1,
      account_id: account.id,
      statement_month: "2026-06",
      payment_month: "2026-07",
      completion_method: "csv_import",
      completed_at: "2026-07-20T00:00:00Z",
    };

    expect(
      computeCreditCardImportTasks({
        today: new Date("2026-07-20T12:00:00+09:00"),
        accounts: [account],
        creditCardSettings: [settings],
        completions: [completion],
      }),
    ).toEqual([]);
  });

  test("applies an additional billing offset to the usage month", () => {
    const tasks = computeCreditCardImportTasks({
      today: new Date("2026-07-20T12:00:00+09:00"),
      accounts: [account],
      creditCardSettings: [{ ...settings, billing_offset_months: 1 }],
      completions: [],
    });

    expect(tasks[0]?.statementMonth).toBe("2026-05");
    expect(tasks[0]?.paymentMonth).toBe("2026-07");
  });
});
