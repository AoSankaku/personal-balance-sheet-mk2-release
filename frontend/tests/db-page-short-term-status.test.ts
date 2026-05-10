import { describe, expect, test } from "bun:test";
import {
  findOverdueShortTermLoanAccounts,
  isShortTermLoanAccountActive,
  isUnsettledOpeningEntry,
} from "../src/pages/dbPageUtils";

describe("DbPage short-term loan status", () => {
  test("does not treat a settled opening entry as active", () => {
    expect(
      isUnsettledOpeningEntry({
        netChange: 10_000,
        entry: { loan_settlement: { is_settled: true } },
      }),
    ).toBe(false);
  });

  test("moves zero-balance accounts with only settled openings out of active", () => {
    expect(
      isShortTermLoanAccountActive(
        { is_completed: false, balance: 0 },
        [
          {
            netChange: 10_000,
            entry: { loan_settlement: { is_settled: true } },
          },
          {
            netChange: -10_000,
            entry: {},
          },
        ],
      ),
    ).toBe(false);
  });

  test("keeps accounts with an unsettled opening active", () => {
    expect(
      isShortTermLoanAccountActive(
        { is_completed: false, balance: 10_000 },
        [
          {
            netChange: 10_000,
            entry: { loan_settlement: { is_settled: false } },
          },
        ],
      ),
    ).toBe(true);
  });

  test("reports overdue unsettled openings even when the account is marked completed", () => {
    const overdue = findOverdueShortTermLoanAccounts(
      [
        {
          account: {
            id: 1,
            name: "貸付先A",
            type: "asset",
            category: "short_term_lending",
            is_completed: true,
            balance: 0,
          },
          entries: [
            {
              netChange: 10_000,
              entry: {
                id: 10,
                date: "2025-12-01",
                loan_settlement: { is_settled: false },
              },
            },
          ],
        },
      ],
      30,
      "2026-01-01",
    );

    expect(overdue).toEqual([
      {
        account: {
          id: 1,
          name: "貸付先A",
          type: "asset",
          category: "short_term_lending",
          is_completed: true,
          balance: 0,
        },
        daysDiff: 31,
      },
    ]);
  });

  test("does not report settled openings as overdue", () => {
    expect(
      findOverdueShortTermLoanAccounts(
        [
          {
            account: {
              id: 1,
              name: "貸付先A",
              type: "asset",
              category: "short_term_lending",
              is_completed: false,
              balance: 0,
            },
            entries: [
              {
                netChange: 10_000,
                entry: {
                  id: 10,
                  date: "2025-12-01",
                  loan_settlement: { is_settled: true },
                },
              },
            ],
          },
        ],
        30,
        "2026-01-01",
      ),
    ).toEqual([]);
  });
});
