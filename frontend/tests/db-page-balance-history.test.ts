import { describe, expect, test } from "bun:test";
import { buildLoanBalanceHistory } from "../src/pages/dbPageUtils";

describe("DbPage long-term loan balance history", () => {
  test("builds newest-first rows with balance after each change", () => {
    const history = buildLoanBalanceHistory([
      { netChange: -3_000, entry: { id: 3, date: "2025-03-01" } },
      { netChange: 10_000, entry: { id: 1, date: "2025-01-01" } },
      { netChange: 2_000, entry: { id: 2, date: "2025-02-01" } },
    ]);

    expect(history).toEqual([
      {
        entry: { id: 3, date: "2025-03-01" },
        netChange: -3_000,
        balanceAfter: 9_000,
      },
      {
        entry: { id: 2, date: "2025-02-01" },
        netChange: 2_000,
        balanceAfter: 12_000,
      },
      {
        entry: { id: 1, date: "2025-01-01" },
        netChange: 10_000,
        balanceAfter: 10_000,
      },
    ]);
  });
});
