import { describe, expect, test } from "bun:test";
import type { CreditCardSettings } from "@balance-sheet/shared";
import {
  getAutomaticStatementCompletion,
  getZeroAmountStatementCompletion,
} from "./creditCardStatementCompletion";

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
});
