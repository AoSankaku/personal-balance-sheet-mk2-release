import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

import type {
  Account,
  BudgetAdjustmentLog,
  JournalEntry,
} from "@balance-sheet/shared";
import {
  getSuspiciousReasons,
} from "../src/components/tt/ttUtils";
import {
  findLatestBudgetResetBoundary,
  isLoanBudgetFundingMissing,
} from "../src/lib/budgetFundingCompleteness";

const frontendRoot = join(import.meta.dir, "..");
const source = (path: string) =>
  readFileSync(join(frontendRoot, path), "utf8");

function account(overrides: Partial<Account>): Account {
  return {
    id: overrides.id ?? 1,
    name: overrides.name ?? "Account",
    type: overrides.type ?? "expense",
    category: overrides.category ?? "other",
    currency: overrides.currency ?? "JPY",
    is_depreciable: overrides.is_depreciable ?? false,
    include_in_allocatable: overrides.include_in_allocatable ?? true,
    created_at: overrides.created_at ?? "2026-05-01 00:00:00",
    budget_ratios: overrides.budget_ratios,
  };
}

function entry(overrides: Partial<JournalEntry>): JournalEntry {
  return {
    id: overrides.id ?? 1,
    date: overrides.date ?? "2026-05-02",
    description: overrides.description ?? "Entry",
    source: overrides.source ?? "manual",
    created_at: overrides.created_at ?? "2026-05-02 13:39:08",
    lines: overrides.lines ?? [],
    budget_allocations: overrides.budget_allocations,
    income_budget_allocations: overrides.income_budget_allocations,
  };
}

function resetLog(
  overrides: Partial<BudgetAdjustmentLog> = {},
): BudgetAdjustmentLog {
  return {
    id: overrides.id ?? 1,
    budget_category_id: overrides.budget_category_id ?? 1,
    budget_category_name: overrides.budget_category_name ?? "生活費",
    year_month: overrides.year_month ?? "2026-07",
    amount: overrides.amount ?? 0,
    currency: overrides.currency ?? "JPY",
    date: overrides.date ?? "2026-07-10",
    created_at: overrides.created_at ?? "2026-07-10 09:00:00",
    type: overrides.type ?? "reset",
    adjustment_type: overrides.adjustment_type ?? "reset",
  };
}

describe("getSuspiciousReasons", () => {
  test("does not flag budget-excluded compound entries without explicit budget allocations", () => {
    const accounts = new Map([
      [
        16,
        account({
          id: 16,
          name: "臨時収入",
          type: "income",
        }),
      ],
      [
        22,
        account({
          id: 22,
          name: "娯楽費",
          type: "expense",
          budget_ratios: [{ budget_category_id: 2, ratio: 100 }],
        }),
      ],
    ]);

    const reasons = getSuspiciousReasons(
      entry({
        description: "IFTTT Pro",
        lines: [
          {
            id: 1,
            journal_entry_id: 1192,
            account_id: 16,
            account_name: "臨時収入",
            debit: 629,
            credit: 0,
            currency: "JPY",
          },
          {
            id: 2,
            journal_entry_id: 1192,
            account_id: 22,
            account_name: "娯楽費",
            debit: 0,
            credit: 629,
            currency: "JPY",
          },
        ],
      }),
      accounts,
      "ja",
    );

    expect(reasons).toEqual([]);
  });

  test("flags mismatches only when explicit expense budget allocations exist", () => {
    const accounts = new Map([
      [
        22,
        account({
          id: 22,
          name: "娯楽費",
          type: "expense",
          budget_ratios: [{ budget_category_id: 2, ratio: 100 }],
        }),
      ],
    ]);

    const reasons = getSuspiciousReasons(
      entry({
        lines: [
          {
            id: 1,
            journal_entry_id: 10,
            account_id: 22,
            account_name: "娯楽費",
            debit: 1000,
            credit: 0,
            currency: "JPY",
          },
        ],
        budget_allocations: [{ budget_category_id: 2, amount: -500 }],
      }),
      accounts,
      "en",
    );

    expect(reasons).toHaveLength(1);
  });
});

describe("budget check presentation", () => {
  test("uses the notification basis and shows overruns separately", () => {
    const section = source("src/components/tt/BudgetCheckSection.tsx");
    const placement = source("src/components/BudgetPlacementTable.tsx");

    expect(section).toContain('searchParams.get("basis")');
    expect(section).toContain("accountsToday");
    expect(section).toContain("budgetSummaryToday");
    expect(section).toContain('t("assignableMoneyTodayLabel")');
    expect(section).toContain('t("assignableMoneyTotalLabel")');
    expect(placement).toContain('t("budgetPlacementUnfundedOverspending")');
    expect(placement).toContain(
      't("budgetPlacementUnfundedOverspendingHint")',
    );
    expect(placement).toContain('t("budgetPlacementTotal")');
  });

  test("places the date filter inside the consistency check area", () => {
    const section = source("src/components/tt/BudgetCheckSection.tsx");

    expect(section.indexOf('t("budgetConsistencyTitle")')).toBeLessThan(
      section.indexOf("<DatePickerInput"),
    );
  });

  test("loads reset points and shows missing loan funding as an issue", () => {
    const section = source("src/components/tt/BudgetCheckSection.tsx");

    expect(section).toContain("listAdjustmentLogs");
    expect(section).toContain("resetsOnly");
    expect(section).toContain("isEntryAfterBudgetReset");
    expect(section).toContain("resetLogs != null");
    expect(section).toContain('t("budgetFundingMissingIssue")');
    expect(section).toContain('{t("amountLabel")}');
  });
});

describe("loan budget funding completeness after reset", () => {
  const loanAccountMap = new Map([
    [
      30,
      account({
        id: 30,
        name: "短期貸付",
        type: "asset",
        category: "short_term_lending",
      }),
    ],
    [
      1,
      account({
        id: 1,
        name: "現金",
        type: "asset",
        category: "cash",
      }),
    ],
  ]);

  test("uses the latest reset date and input timestamp as the boundary", () => {
    expect(
      findLatestBudgetResetBoundary([
        resetLog(),
        resetLog({
          id: 2,
          date: "2026-07-10",
          created_at: "2026-07-10 11:00:00",
        }),
        resetLog({
          id: 3,
          date: "2026-07-12",
          created_at: "2026-07-12 08:00:00",
          type: "manual",
          adjustment_type: "allocation",
        }),
      ]),
    ).toEqual({
      date: "2026-07-10",
      created_at: "2026-07-10 11:00:00",
    });
  });

  test("flags a loan entry after the latest reset when funding is missing", () => {
    expect(
      isLoanBudgetFundingMissing(
        entry({
          date: "2026-07-11",
          lines: [
            {
              id: 1,
              journal_entry_id: 1,
              account_id: 30,
              account_name: "短期貸付",
              debit: 50,
              credit: 0,
              currency: "JPY",
            },
            {
              id: 2,
              journal_entry_id: 1,
              account_id: 1,
              account_name: "現金",
              debit: 0,
              credit: 50,
              currency: "JPY",
            },
          ],
        }),
        loanAccountMap,
        {
          date: "2026-07-10",
          created_at: "2026-07-10 11:00:00",
        },
      ),
    ).toBe(true);
  });

  test("does not flag entries before reset or entries with a saved split", () => {
    const loanEntry = entry({
      date: "2026-07-09",
      lines: [
        {
          id: 1,
          journal_entry_id: 1,
          account_id: 30,
          account_name: "短期貸付",
          debit: 50,
          credit: 0,
          currency: "JPY",
        },
      ],
    });

    expect(
      isLoanBudgetFundingMissing(loanEntry, loanAccountMap, {
        date: "2026-07-10",
        created_at: "2026-07-10 11:00:00",
      }),
    ).toBe(false);
    expect(
      isLoanBudgetFundingMissing(
        {
          ...loanEntry,
          date: "2026-07-11",
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
        },
        loanAccountMap,
        {
          date: "2026-07-10",
          created_at: "2026-07-10 11:00:00",
        },
      ),
    ).toBe(false);
  });

  test("checks only loan entries in the displayed currency", () => {
    expect(
      isLoanBudgetFundingMissing(
        entry({
          date: "2026-07-11",
          lines: [
            {
              id: 1,
              journal_entry_id: 1,
              account_id: 30,
              account_name: "短期貸付",
              debit: 50,
              credit: 0,
              currency: "USD",
            },
          ],
        }),
        loanAccountMap,
        null,
        "JPY",
      ),
    ).toBe(false);
  });
});
