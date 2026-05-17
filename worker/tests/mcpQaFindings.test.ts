import { describe, expect, test } from "bun:test";

import { toLocalDateString } from "../src/lib/appDate";
import {
  isLoanSettlementEffective,
  serializeLoanSettlement,
} from "../src/lib/loanSettlement";

describe("app-local date handling", () => {
  test("uses the app timezone instead of UTC for the current date", () => {
    const instant = new Date("2026-05-16T20:30:00.000Z");

    expect(toLocalDateString(instant, "Asia/Tokyo")).toBe("2026-05-17");
  });
});

describe("loan settlement effective date", () => {
  test("does not treat a future-dated repayment as settled for an earlier as-of date", () => {
    expect(
      isLoanSettlementEffective({
        is_settled: 1,
        settled_by_entry_date: "2026-05-30",
        asOf: "2026-05-17",
      }),
    ).toBe(false);
  });

  test("treats a linked repayment as settled once the as-of date reaches it", () => {
    expect(
      isLoanSettlementEffective({
        is_settled: 1,
        settled_by_entry_date: "2026-05-30",
        asOf: "2026-05-30",
      }),
    ).toBe(true);
  });

  test("serializes future settlements as currently unsettled without losing the link", () => {
    expect(
      serializeLoanSettlement({
        is_settled: 1,
        settled_by_journal_entry_id: 14,
        settled_by_entry_date: "2026-05-30",
        settled_at: "2026-05-16T20:14:53.356Z",
        asOf: "2026-05-17",
      }),
    ).toEqual({
      is_settled: false,
      settled_by_journal_entry_id: 14,
      settled_at: "2026-05-16T20:14:53.356Z",
    });
  });
});
