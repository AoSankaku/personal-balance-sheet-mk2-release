import { describe, expect, test } from "bun:test";
import type { CreditCardSettings } from "@balance-sheet/shared";
import {
  getAutomaticStatementCompletion,
  getConfirmedCsvCreditCardState,
  getDefaultStatementMonth,
  getManualStatementCompletion,
  getSelectableZeroAmountCompletions,
  getZeroAmountStatementCompletion,
} from "./creditCardStatementCompletion";
import type { CreditCardStatementCompletion } from "@balance-sheet/shared";

const settings: CreditCardSettings = {
  id: 1,
  account_id: 10,
  closing_day: 15,
  confirmation_day: 20,
  withdrawal_day: 10,
  billing_offset_months: 0,
  created_at: "2026-01-01T00:00:00Z",
};

describe("credit card statement completion", () => {
  test("uses the pure confirmed CSV net total even when rows look duplicated", () => {
    expect(
      getConfirmedCsvCreditCardState({
        format: "rakuten-confirmed",
        transactions: [
          transaction("2026-06-05", "2026-07", 1_000),
          transaction("2026-06-05", "2026-07", 1_000),
          {
            ...transaction("2026-06-10", "2026-07", 500),
            direction: "deposit" as const,
          },
        ],
        settings,
      }),
    ).toEqual({
      account_id: 10,
      payment_month: "2026-07",
      amount: 1_500,
      status: "confirmed",
    });
  });

  test("derives the SMBC confirmed payment month from the dominant closing month", () => {
    expect(
      getConfirmedCsvCreditCardState({
        format: "smbc-confirmed",
        transactions: [
          transaction("2026-05-20", "2026-05", 1_000),
          transaction("2026-06-05", "2026-06", 2_000),
          transaction("2026-04-12", "2026-04", 300),
        ],
        settings,
      }),
    ).toEqual({
      account_id: 10,
      payment_month: "2026-07",
      amount: 3_300,
      status: "confirmed",
    });
  });

  test("does not create trial-balance state from a draft CSV", () => {
    expect(
      getConfirmedCsvCreditCardState({
        format: "rakuten-draft",
        transactions: [transaction("2026-06-05", "2026-07", 1_000)],
        settings,
      }),
    ).toBeNull();
  });

  test("infers the usage month from an auto-detected Rakuten payment month", () => {
    expect(
      getDefaultStatementMonth({
        format: "rakuten-confirmed",
        transactions: [
          transaction("2026-06-05", "2026-07"),
          transaction("2026-06-10", "2026-07"),
          transaction("2026-04-12", "2026-07"),
        ],
        settings,
        selectableStatementMonths: ["2026-04", "2026-05", "2026-06"],
      }),
    ).toBe("2026-06");
  });

  test("uses the most frequent closing month for SMBC confirmed data with an old row", () => {
    expect(
      getDefaultStatementMonth({
        format: "smbc-confirmed",
        transactions: [
          transaction("2026-05-20", "2026-05"),
          transaction("2026-06-05", "2026-06"),
          transaction("2026-06-10", "2026-06"),
          transaction("2026-04-12", "2026-04"),
        ],
        settings,
        selectableStatementMonths: ["2026-04", "2026-05", "2026-06"],
      }),
    ).toBe("2026-06");
  });

  test("defaults to the latest selectable month when the format was not detected", () => {
    expect(
      getDefaultStatementMonth({
        format: "unknown",
        transactions: [],
        settings,
        selectableStatementMonths: ["2026-04", "2026-05", "2026-06"],
      }),
    ).toBe("2026-06");
  });

  test("completes a confirmed CSV imported on or after the confirmation day", () => {
    expect(
      getAutomaticStatementCompletion({
        today: new Date("2026-07-20T12:00:00+09:00"),
        settings,
        format: "smbc-confirmed",
        parsedTransactionCount: 3,
        unresolvedTransactionCount: 0,
      }),
    ).toEqual({
      account_id: 10,
      statement_month: "2026-06",
      payment_month: "2026-07",
      completion_method: "csv_import",
    });
  });

  test("does not complete a draft CSV", () => {
    expect(
      getAutomaticStatementCompletion({
        today: new Date("2026-07-20T12:00:00+09:00"),
        settings,
        format: "rakuten-draft",
        parsedTransactionCount: 3,
        unresolvedTransactionCount: 0,
      }),
    ).toBeNull();
  });

  test("does not complete a confirmed CSV before the confirmation day", () => {
    expect(
      getAutomaticStatementCompletion({
        today: new Date("2026-07-19T12:00:00+09:00"),
        settings,
        format: "rakuten-confirmed",
        parsedTransactionCount: 3,
        unresolvedTransactionCount: 0,
      }),
    ).toBeNull();
  });

  test("completes when every confirmed CSV row already exists as a manual entry", () => {
    expect(
      getAutomaticStatementCompletion({
        today: new Date("2026-07-20T12:00:00+09:00"),
        settings,
        format: "rakuten-confirmed",
        parsedTransactionCount: 3,
        unresolvedTransactionCount: 0,
      })?.completion_method,
    ).toBe("csv_import");
  });

  test("does not auto-complete an empty CSV", () => {
    expect(
      getAutomaticStatementCompletion({
        today: new Date("2026-07-20T12:00:00+09:00"),
        settings,
        format: "rakuten-confirmed",
        parsedTransactionCount: 0,
        unresolvedTransactionCount: 0,
      }),
    ).toBeNull();
  });

  test("does not complete while any CSV row remains unresolved", () => {
    expect(
      getAutomaticStatementCompletion({
        today: new Date("2026-07-20T12:00:00+09:00"),
        settings,
        format: "rakuten-confirmed",
        parsedTransactionCount: 3,
        unresolvedTransactionCount: 1,
      }),
    ).toBeNull();
  });

  test("creates an explicit zero-amount completion on or after confirmation", () => {
    expect(
      getZeroAmountStatementCompletion(
        new Date("2026-07-20T12:00:00+09:00"),
        settings,
      ),
    ).toEqual({
      account_id: 10,
      statement_month: "2026-06",
      payment_month: "2026-07",
      completion_method: "zero_amount",
    });
  });

  test("creates an explicit manual completion when every statement row is already recorded", () => {
    expect(
      getManualStatementCompletion(
        new Date("2026-07-20T12:00:00+09:00"),
        settings,
      ),
    ).toEqual({
      account_id: 10,
      statement_month: "2026-06",
      payment_month: "2026-07",
      completion_method: "manual_confirmation",
    });
  });

  test("does not allow manual completion before the confirmation day", () => {
    expect(
      getManualStatementCompletion(
        new Date("2026-07-19T12:00:00+09:00"),
        settings,
      ),
    ).toBeNull();
  });

  test("offers only ready months from the card settings creation month onward", () => {
    const targets = getSelectableZeroAmountCompletions(
      new Date("2026-07-20T12:00:00+09:00"),
      { ...settings, created_at: "2026-05-01T00:00:00Z" },
      [],
    );

    expect(targets.map((target) => target.statement_month)).toEqual([
      "2026-05",
      "2026-06",
    ]);
  });

  test("does not offer an incomplete month older than the latest completion", () => {
    const completions: CreditCardStatementCompletion[] = [
      {
        id: 1,
        account_id: 10,
        statement_month: "2026-05",
        payment_month: "2026-06",
        completion_method: "csv_import",
        completed_at: "2026-06-20T00:00:00Z",
      },
    ];

    const targets = getSelectableZeroAmountCompletions(
      new Date("2026-07-20T12:00:00+09:00"),
      { ...settings, created_at: "2026-03-01T00:00:00Z" },
      completions,
    );

    expect(targets.map((target) => target.statement_month)).toEqual([
      "2026-06",
    ]);
  });

  test("does not offer the current cycle before its confirmation day", () => {
    const targets = getSelectableZeroAmountCompletions(
      new Date("2026-07-19T12:00:00+09:00"),
      { ...settings, created_at: "2026-05-01T00:00:00Z" },
      [],
    );

    expect(targets.map((target) => target.statement_month)).toEqual([
      "2026-05",
    ]);
  });

  test("returns no choices when the latest ready month is already complete", () => {
    const completions: CreditCardStatementCompletion[] = [
      {
        id: 1,
        account_id: 10,
        statement_month: "2026-06",
        payment_month: "2026-07",
        completion_method: "zero_amount",
        completed_at: "2026-07-20T00:00:00Z",
      },
    ];

    expect(
      getSelectableZeroAmountCompletions(
        new Date("2026-07-20T12:00:00+09:00"),
        { ...settings, created_at: "2026-05-01T00:00:00Z" },
        completions,
      ),
    ).toEqual([]);
  });
});

function transaction(date: string, paymentMonth: string, amount = 1_000) {
  return {
    date,
    store: "テスト店舗",
    amount,
    paymentMonth,
    direction: "withdrawal" as const,
  };
}
