import { describe, expect, test } from "bun:test";
import type { ParsedTransaction } from "./csvParser";
import { getAmazonTransactionsForBulk } from "./csvInputUtils";

const transactions: ParsedTransaction[] = [
  {
    date: "2026-06-01",
    store: "AMAZON.CO.JP",
    amount: 1_000,
    paymentMonth: "2026-07",
  },
  {
    date: "2026-06-02",
    store: "ＡＭＡＺＯＮ．ＣＯ．ＪＰ",
    amount: 2_000,
    paymentMonth: "2026-07",
  },
  {
    date: "2026-06-03",
    store: "スーパーマーケット",
    amount: 3_000,
    paymentMonth: "2026-07",
  },
];

describe("Amazon CSV handoff", () => {
  test("does not pass duplicate Amazon transactions to bulk input", () => {
    expect(getAmazonTransactionsForBulk(transactions, new Set([0]))).toEqual([
      transactions[1],
    ]);
  });

  test("passes no Amazon rows when every Amazon transaction is duplicated", () => {
    expect(
      getAmazonTransactionsForBulk(transactions, new Set([0, 1])),
    ).toEqual([]);
  });
});
