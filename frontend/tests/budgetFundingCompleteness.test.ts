import { describe, expect, test } from "bun:test";

import type {
  Account,
  BudgetAdjustmentLog,
  JournalEntry,
  JournalLine,
} from "@balance-sheet/shared";
import {
  findLatestBudgetResetBoundary,
  getLoanBudgetFundingPrincipal,
  isLoanBudgetFundingMissing,
} from "../src/lib/budgetFundingCompleteness";

function account(id: number, category: Account["category"]): Account {
  return {
    id,
    name: `Account ${id}`,
    type:
      category === "cash" || category.includes("lending")
        ? "asset"
        : "liability",
    category,
    currency: "JPY",
    is_depreciable: false,
    include_in_allocatable: true,
    created_at: "2026-07-01 00:00:00",
  };
}

function line(
  id: number,
  accountId: number,
  debit: number,
  credit: number,
  currency = "JPY",
): JournalLine {
  return {
    id,
    journal_entry_id: 1,
    account_id: accountId,
    account_name: `Account ${accountId}`,
    debit,
    credit,
    currency,
  };
}

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: 1,
    date: "2026-07-11",
    description: "Loan",
    source: "manual",
    created_at: "2026-07-11 09:00:00",
    lines: [line(1, 10, 50, 0), line(2, 1, 0, 50)],
    ...overrides,
  };
}

function resetLog(
  id: number,
  date: string,
  createdAt: string,
  adjustmentType = "reset",
): BudgetAdjustmentLog {
  return {
    id,
    budget_category_id: 1,
    budget_category_name: "Daily",
    year_month: date.slice(0, 7),
    amount: 0,
    currency: "JPY",
    date,
    created_at: createdAt,
    type: adjustmentType === "reset" ? "reset" : "manual",
    adjustment_type: adjustmentType,
  };
}

describe("budget funding completeness", () => {
  const accountMap = new Map([
    [1, account(1, "cash")],
    [10, account(10, "short_term_lending")],
    [11, account(11, "short_term_loan")],
  ]);

  test("finds the latest reset by effective date and timestamp", () => {
    expect(
      findLatestBudgetResetBoundary([
        resetLog(1, "2026-07-10", "2026-07-10 09:00:00"),
        resetLog(2, "2026-07-10", "2026-07-10 11:00:00"),
        resetLog(3, "2026-07-12", "2026-07-12 09:00:00", "allocation"),
      ]),
    ).toEqual({
      date: "2026-07-10",
      created_at: "2026-07-10 11:00:00",
    });
    expect(findLatestBudgetResetBoundary([])).toBeNull();
  });

  test("uses reset time, saved funding, account kind, and currency", () => {
    const boundary = {
      date: "2026-07-10",
      created_at: "2026-07-10 11:00:00",
    };

    expect(
      isLoanBudgetFundingMissing(entry(), accountMap, boundary, "JPY"),
    ).toBe(true);
    expect(
      isLoanBudgetFundingMissing(
        entry({
          date: "2026-07-10",
          created_at: "2026-07-10 10:00:00",
        }),
        accountMap,
        boundary,
        "JPY",
      ),
    ).toBe(false);
    expect(
      isLoanBudgetFundingMissing(
        entry({
          budget_funding: {
            kind: "lend",
            allocations: [
              {
                id: 1,
                budget_category_id: null,
                amount: 50,
                currency: "JPY",
              },
            ],
          },
        }),
        accountMap,
        boundary,
        "JPY",
      ),
    ).toBe(false);
    expect(
      isLoanBudgetFundingMissing(
        entry({ lines: [line(1, 10, 50, 0, "USD")] }),
        accountMap,
        null,
        "JPY",
      ),
    ).toBe(false);
    expect(
      isLoanBudgetFundingMissing(
        entry({ lines: [line(1, 1, 50, 0)] }),
        accountMap,
        null,
      ),
    ).toBe(false);
  });

  test("calculates the principal only from matching loan accounts and currency", () => {
    expect(
      getLoanBudgetFundingPrincipal(
        entry({
          lines: [
            line(1, 10, 70, 0),
            line(2, 10, 0, 20),
            line(3, 11, 0, 30),
            line(4, 1, 0, 20),
            line(5, 10, 100, 0, "USD"),
          ],
        }),
        accountMap,
        "JPY",
      ),
    ).toBe(50);
  });

  test("uses a global cutoff only after every category has been reset", () => {
    const logs = [
      {
        ...resetLog(1, "2026-07-10", "2026-07-10 09:00:00"),
        budget_category_id: 1,
      },
      {
        ...resetLog(2, "2026-07-05", "2026-07-05 09:00:00"),
        budget_category_id: 2,
      },
    ];
    expect(findLatestBudgetResetBoundary(logs, [1, 2])).toMatchObject({
      date: "2026-07-05",
    });
    expect(findLatestBudgetResetBoundary(logs, [1, 2, 3])).toBeNull();
  });

  test("does not flag a structural zero-impact loan entry", () => {
    const nonAllocatableCash = {
      ...account(2, "cash"),
      include_in_allocatable: false,
    };
    const map = new Map(accountMap).set(2, nonAllocatableCash);

    expect(
      isLoanBudgetFundingMissing(
        entry({
          lines: [line(1, 2, 50, 0), line(2, 10, 0, 50)],
        }),
        map,
        null,
        "JPY",
      ),
    ).toBe(false);
  });

  test("accepts a persisted component-only collection", () => {
    const nonAllocatableCash = {
      ...account(2, "cash"),
      include_in_allocatable: false,
    };
    const map = new Map(accountMap).set(2, nonAllocatableCash);
    expect(
      isLoanBudgetFundingMissing(
        entry({
          lines: [line(1, 2, 50, 0), line(2, 10, 0, 50)],
          budget_funding_components: [
            {
              kind: "collect",
              principal_amount: 50,
              applied_amount: 0,
              component_only_amount: 50,
              source_journal_entry_ids: [7],
              allocations: [
                {
                  id: 1,
                  budget_category_id: 1,
                  amount: 50,
                  currency: "JPY",
                  source_journal_entry_id: 7,
                  effect: "component_only",
                },
              ],
            },
          ],
        }),
        map,
        null,
        "JPY",
      ),
    ).toBe(false);
  });
});
