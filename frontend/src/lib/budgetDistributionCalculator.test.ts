import { describe, expect, test } from "bun:test";
import type {
  Account,
  BudgetCategory,
  BudgetFilter,
  CreateJournalLineInput,
} from "@balance-sheet/shared";
import {
  calculateAccountBudgetDistribution,
  calculateJournalBudgetDistribution,
} from "./budgetDistributionCalculator";

const categories: BudgetCategory[] = [
  { id: 1, name: "Food", sort_order: 0, rollover_months: 0, budget_group: "life", account_ids: [], created_at: "" },
  { id: 2, name: "Home", sort_order: 1, rollover_months: 0, budget_group: "life", account_ids: [], created_at: "" },
  { id: 3, name: "Other", sort_order: 2, rollover_months: 0, budget_group: "life", account_ids: [], created_at: "" },
];

const accounts: Account[] = [
  { id: 10, name: "Bank", type: "asset", category: "cash", include_in_allocatable: true, created_at: "" },
  { id: 11, name: "Excluded cash", type: "asset", category: "cash", include_in_allocatable: false, created_at: "" },
  { id: 12, name: "Card", type: "liability", category: "credit_card", deduct_from_budget: true, created_at: "" },
  { id: 13, name: "Groceries", type: "expense", category: "other", budget_ratios: [{ budget_category_id: 1, ratio: 60 }, { budget_category_id: 2, ratio: 30 }], created_at: "" },
  { id: 14, name: "Income", type: "income", category: "other", created_at: "" },
  { id: 15, name: "Fund", type: "asset", category: "investment", created_at: "" },
  { id: 16, name: "Investment loss", type: "expense", category: "investment_loss", created_at: "" },
  { id: 17, name: "Loan", type: "liability", category: "loan", created_at: "" },
  { id: 18, name: "Refundable purchase", type: "expense", category: "other", budget_ratios: [{ budget_category_id: 1, ratio: 100 }], created_at: "" },
  { id: 19, name: "Refunded home purchase", type: "expense", category: "other", budget_ratios: [{ budget_category_id: 2, ratio: 100 }], created_at: "" },
];

const filter: BudgetFilter = {
  id: 1,
  name: "Income split",
  is_active: true,
  currency: "USD",
  created_at: "",
  steps: [
    { id: 1, filter_id: 1, step_order: 0, step_type: "fixed", allocations: [{ id: 1, step_id: 1, budget_category_id: 1, amount: 1.01, ratio: null }] },
    { id: 2, filter_id: 1, step_order: 1, step_type: "remainder", allocations: [{ id: 2, step_id: 2, budget_category_id: 2, amount: null, ratio: 1 }] },
  ],
};

const accountOptions = {
  categories,
  currency: "JPY",
  decimalPlaces: 0,
};

function lines(...items: CreateJournalLineInput[]): CreateJournalLineInput[] {
  return items;
}

describe("calculateAccountBudgetDistribution", () => {
  test("keeps partial expense ratios literal and requires an explicit fallback", () => {
    const result = calculateAccountBudgetDistribution({
      ...accountOptions,
      account: accounts[3],
      amount: 101,
      direction: "debit",
    });

    expect(result.expense).toEqual({ 1: -61, 2: -30 });
    expect(result.expenseTarget).toBe(-101);
    expect(result.expenseUnassigned).toBe(-10);
    expect(result.canApply).toBe(false);

    const withFallback = calculateAccountBudgetDistribution({
      ...accountOptions,
      account: accounts[3],
      amount: 101,
      direction: "debit",
      fallbackCategoryId: 3,
    });
    expect(withFallback.expense).toEqual({ 1: -61, 2: -30, 3: -10 });
    expect(withFallback.expenseUnassigned).toBe(0);
    expect(withFallback.canApply).toBe(true);
  });

  test("distributes odd JPY units deterministically and retains USD minor units", () => {
    const jpyAccount = { ...accounts[3]!, budget_ratios: [{ budget_category_id: 1, ratio: 50 }, { budget_category_id: 2, ratio: 50 }] };
    expect(calculateAccountBudgetDistribution({ ...accountOptions, account: jpyAccount, amount: 5, direction: "debit" }).expense)
      .toEqual({ 1: -3, 2: -2 });

    const usdAccount = { ...jpyAccount, budget_ratios: [{ budget_category_id: 1, ratio: 50 }, { budget_category_id: 2, ratio: 50 }] };
    const usd = calculateAccountBudgetDistribution({ account: usdAccount, amount: 10.01, direction: "debit", categories, currency: "USD", decimalPlaces: 2 });
    expect(usd.expense).toEqual({ 1: -5.01, 2: -5 });
    expect(usd.expenseUnassigned).toBe(0);
  });

  test("preserves BTC precision and rejects malformed amount, precision, and over-allocation", () => {
    const btcAccount = { ...accounts[3]!, budget_ratios: [{ budget_category_id: 1, ratio: 100 }] };
    const btc = calculateAccountBudgetDistribution({ account: btcAccount, amount: 0.12345678, direction: "credit", categories, currency: "BTC", decimalPlaces: 8 });
    expect(btc.expense).toEqual({ 1: 0.12345678 });
    const skr = calculateAccountBudgetDistribution({ account: btcAccount, amount: 0.123456789, direction: "debit", categories, currency: "SKR", decimalPlaces: 9 });
    expect(skr.expense).toEqual({ 1: -0.123456789 });
    expect(calculateAccountBudgetDistribution({ ...accountOptions, account: btcAccount, amount: -1, direction: "debit" }).canApply).toBe(false);
    expect(calculateAccountBudgetDistribution({ ...accountOptions, account: btcAccount, amount: 1.25, direction: "debit" }).canApply).toBe(false);

    const over = { ...accounts[3]!, budget_ratios: [{ budget_category_id: 1, ratio: 70 }, { budget_category_id: 2, ratio: 40 }] };
    const overResult = calculateAccountBudgetDistribution({ ...accountOptions, account: over, amount: 100, direction: "debit" });
    expect(overResult.supported).toBe(false);
    expect(overResult.canApply).toBe(false);
  });

  test("income stays unassigned unless a matching filter or explicit fallback is supplied", () => {
    const income = calculateAccountBudgetDistribution({ ...accountOptions, account: accounts[4], amount: 80, direction: "credit" });
    expect(income.incomeTarget).toBe(80);
    expect(income.income).toEqual({});
    expect(income.incomeUnassigned).toBe(80);
    expect(income.canApply).toBe(false);

    const fallback = calculateAccountBudgetDistribution({ ...accountOptions, account: accounts[4], amount: 80, direction: "credit", fallbackCategoryId: 2 });
    expect(fallback.income).toEqual({ 2: 80 });
    expect(fallback.canApply).toBe(true);
  });

  test("runs filters in integer minor units and explicitly fills any remainder", () => {
    const originalFilter = structuredClone(filter);
    const result = calculateAccountBudgetDistribution({ account: accounts[4], amount: 10.05, direction: "credit", categories, filter, currency: "USD", decimalPlaces: 2, fallbackCategoryId: 3 });
    expect(result.income).toEqual({ 1: 1.01, 2: 9.04 });
    expect(result.incomeUnassigned).toBe(0);
    expect(result.canApply).toBe(true);
    expect(filter).toEqual(originalFilter);

    const overFilter: BudgetFilter = {
      ...filter,
      steps: [{ id: 3, filter_id: 1, step_order: 0, step_type: "remainder", allocations: [{ id: 4, step_id: 3, budget_category_id: 1, amount: null, ratio: 1.1 }] }],
    };
    const over = calculateAccountBudgetDistribution({ account: accounts[4], amount: 10, direction: "credit", categories, filter: overFilter, currency: "USD", decimalPlaces: 2, fallbackCategoryId: 3 });
    expect(over.issue).toBe("overallocated");
    expect(over.canApply).toBe(false);

    const mismatch = calculateAccountBudgetDistribution({ account: accounts[4], amount: 10, direction: "credit", categories, filter, currency: "JPY", decimalPlaces: 0 });
    expect(mismatch.canApply).toBe(false);
  });
});

describe("calculateJournalBudgetDistribution", () => {
  const journalOptions = { accounts, categories, currency: "JPY", decimalPlaces: 0 };

  test("supports expense, refund, mixed tracked/excluded cash, and partial ratios", () => {
    const expense = calculateJournalBudgetDistribution({
      ...journalOptions,
      lines: lines({ account_id: 10, debit: 0, credit: 100 }, { account_id: 13, debit: 100, credit: 0 }),
      fallbackCategoryId: 3,
    });
    expect(expense.expenseTarget).toBe(-100);
    expect(expense.expense).toEqual({ 1: -60, 2: -30, 3: -10 });
    expect(expense.resourceDelta).toBe(-100);
    expect(expense.canApply).toBe(true);

    const mixed = calculateJournalBudgetDistribution({
      ...journalOptions,
      lines: lines({ account_id: 10, debit: 0, credit: 60 }, { account_id: 11, debit: 0, credit: 40 }, { account_id: 13, debit: 100, credit: 0 }),
      fallbackCategoryId: 3,
    });
    expect(mixed.expenseTarget).toBe(-100);
    expect(mixed.expenseActiveTarget).toBe(-60);
    expect(mixed.expenseReferenceTarget).toBe(-40);

    const refund = calculateJournalBudgetDistribution({
      ...journalOptions,
      lines: lines({ account_id: 10, debit: 100, credit: 0 }, { account_id: 13, debit: 0, credit: 100 }),
      fallbackCategoryId: 3,
    });
    expect(refund.expenseTarget).toBe(100);
    expect(refund.expense).toEqual({ 1: 60, 2: 30, 3: 10 });

    const excludedRefund = calculateJournalBudgetDistribution({
      ...journalOptions,
      lines: lines({ account_id: 11, debit: 100, credit: 0 }, { account_id: 13, debit: 0, credit: 100 }),
      fallbackCategoryId: 3,
    });
    expect(excludedRefund.expenseActiveTarget).toBe(0);
    expect(excludedRefund.expenseReferenceTarget).toBe(100);
  });

  test("does not classify excluded-cash receipts as reference spending or excluded-cash outflows as reference refunds", () => {
    const expenseWithUnrelatedExcludedReceipt = calculateJournalBudgetDistribution({
      ...journalOptions,
      lines: lines(
        { account_id: 13, debit: 100, credit: 0 },
        { account_id: 11, debit: 200, credit: 0 },
        { account_id: 10, debit: 0, credit: 300 },
      ),
      fallbackCategoryId: 3,
    });
    expect(expenseWithUnrelatedExcludedReceipt.expenseActiveTarget).toBe(-100);
    expect(expenseWithUnrelatedExcludedReceipt.expenseReferenceTarget).toBe(0);

    const refundWithUnrelatedExcludedOutflow = calculateJournalBudgetDistribution({
      ...journalOptions,
      lines: lines(
        { account_id: 13, debit: 0, credit: 100 },
        { account_id: 11, debit: 0, credit: 200 },
        { account_id: 10, debit: 300, credit: 0 },
      ),
      fallbackCategoryId: 3,
    });
    expect(refundWithUnrelatedExcludedOutflow.expenseActiveTarget).toBe(100);
    expect(refundWithUnrelatedExcludedOutflow.expenseReferenceTarget).toBe(0);
  });

  test("rejects mixed expense/refund signs when any excluded-cash source makes API normalization ambiguous", () => {
    const result = calculateJournalBudgetDistribution({
      ...journalOptions,
      lines: lines(
        { account_id: 13, debit: 1000, credit: 0 },
        { account_id: 19, debit: 0, credit: 200 },
        { account_id: 10, debit: 0, credit: 400 },
        { account_id: 11, debit: 0, credit: 400 },
      ),
    });
    expect(result.supported).toBe(false);
    expect(result.issue).toBe("ambiguous");
    expect(result.canApply).toBe(false);
  });

  test("ignores zero-valued selected nonbudget rows when classifying a valid journal", () => {
    const result = calculateJournalBudgetDistribution({
      ...journalOptions,
      lines: lines(
        { account_id: 10, debit: 0, credit: 100 },
        { account_id: 13, debit: 100, credit: 0 },
        { account_id: 15, debit: 0, credit: 0 },
      ),
      fallbackCategoryId: 3,
    });
    expect(result.supported).toBe(true);
    expect(result.expenseTarget).toBe(-100);
    expect(result.canApply).toBe(true);
  });

  test("supports income, gross income with fee, and internal tracked transfers", () => {
    const income = calculateJournalBudgetDistribution({
      ...journalOptions,
      lines: lines({ account_id: 10, debit: 100, credit: 0 }, { account_id: 14, debit: 0, credit: 100 }),
      fallbackCategoryId: 1,
    });
    expect(income.incomeTarget).toBe(100);
    expect(income.income).toEqual({ 1: 100 });

    const excludedIncome = calculateJournalBudgetDistribution({
      ...journalOptions,
      lines: lines({ account_id: 11, debit: 100, credit: 0 }, { account_id: 14, debit: 0, credit: 100 }),
    });
    expect(excludedIncome.supported).toBe(true);
    expect(excludedIncome.incomeTarget).toBe(0);
    expect(excludedIncome.incomeUnassigned).toBe(0);
    expect(excludedIncome.canApply).toBe(true);

    const cardIncome = calculateJournalBudgetDistribution({
      ...journalOptions,
      lines: lines({ account_id: 12, debit: 100, credit: 0 }, { account_id: 14, debit: 0, credit: 100 }),
      fallbackCategoryId: 2,
    });
    expect(cardIncome.incomeTarget).toBe(100);
    expect(cardIncome.income).toEqual({ 2: 100 });

    const fee = calculateJournalBudgetDistribution({
      ...journalOptions,
      lines: lines({ account_id: 10, debit: 19_800, credit: 0 }, { account_id: 13, debit: 200, credit: 0 }, { account_id: 14, debit: 0, credit: 20_000 }),
      fallbackCategoryId: 3,
    });
    expect(fee.expenseTarget).toBe(-200);
    expect(fee.incomeTarget).toBe(20_000);
    expect(fee.canApply).toBe(true);

    const transfer = calculateJournalBudgetDistribution({
      ...journalOptions,
      lines: lines({ account_id: 10, debit: 50, credit: 0 }, { account_id: 10, debit: 0, credit: 50 }),
    });
    expect(transfer.supported).toBe(true);
    expect(transfer.expenseTarget).toBe(0);
    expect(transfer.incomeTarget).toBe(0);
    expect(transfer.canApply).toBe(true);
  });

  test("uses canonical sale proceeds and does not treat investment loss as spending", () => {
    const sale = calculateJournalBudgetDistribution({
      ...journalOptions,
      lines: lines({ account_id: 10, debit: 90, credit: 0 }, { account_id: 15, debit: 0, credit: 100 }, { account_id: 16, debit: 10, credit: 0 }),
      fallbackCategoryId: 2,
    });
    expect(sale.incomeTarget).toBe(90);
    expect(sale.expenseTarget).toBe(0);
    expect(sale.expense).toEqual({});
    expect(sale.income).toEqual({ 2: 90 });
  });

  test("retains signed per-account expense and refund allocations, including a zero net target", () => {
    const mixed = calculateJournalBudgetDistribution({
      ...journalOptions,
      lines: lines(
        { account_id: 10, debit: 0, credit: 800 },
        { account_id: 13, debit: 1000, credit: 0 },
        { account_id: 18, debit: 0, credit: 200 },
      ),
      fallbackCategoryId: 3,
    });
    expect(mixed.expenseTarget).toBe(-800);
    expect(mixed.expense).toEqual({ 1: -400, 2: -300, 3: -100 });
    expect(mixed.canApply).toBe(true);

    const zeroNet = calculateJournalBudgetDistribution({
      ...journalOptions,
      lines: lines(
        { account_id: 13, debit: 1000, credit: 0 },
        { account_id: 18, debit: 0, credit: 1000 },
      ),
      fallbackCategoryId: 3,
    });
    expect(zeroNet.expenseTarget).toBe(0);
    expect(zeroNet.expense).toEqual({ 1: 400, 2: -300, 3: -100 });
    expect(zeroNet.canApply).toBe(true);
  });

  test("rejects ambiguous, unsupported, funding, unbalanced, and unknown-account entries", () => {
    const ambiguous = calculateJournalBudgetDistribution({
      ...journalOptions,
      lines: lines({ account_id: 10, debit: 50, credit: 0 }, { account_id: 11, debit: 0, credit: 50 }, { account_id: 13, debit: 100, credit: 0 }, { account_id: 14, debit: 0, credit: 100 }),
      fallbackCategoryId: 1,
    });
    expect(ambiguous.supported).toBe(false);
    expect(ambiguous.issue).toBe("ambiguous");

    const funding = calculateJournalBudgetDistribution({
      ...journalOptions,
      lines: lines({ account_id: 10, debit: 100, credit: 0 }, { account_id: 17, debit: 0, credit: 100 }),
    });
    expect(funding.issue).toBe("funding");
    expect(funding.fundingComponents).toHaveLength(1);
    expect(funding.canApply).toBe(false);

    expect(calculateJournalBudgetDistribution({ ...journalOptions, lines: lines({ account_id: 10, debit: 10, credit: 0 }, { account_id: 13, debit: 9, credit: 0 }) }).issue).toBe("unbalanced");
    expect(calculateJournalBudgetDistribution({ ...journalOptions, lines: lines({ account_id: 10, debit: 1, credit: 0 }, { account_id: 999, debit: 0, credit: 1 }) }).issue).toBe("unknown_account");
    expect(calculateJournalBudgetDistribution({ ...journalOptions, lines: lines({ account_id: 10, debit: 1, credit: 0 }, { account_id: 12, debit: 0, credit: 1 }) }).supported).toBe(true);
  });

  test("keeps decimal currency units exact and never mutates caller data", () => {
    const usdLines = lines({ account_id: 10, debit: 10.01, credit: 0, currency: "USD" }, { account_id: 13, debit: 0, credit: 10.01, currency: "USD" });
    const before = structuredClone(usdLines);
    const usd = calculateJournalBudgetDistribution({ accounts, categories, lines: usdLines, currency: "USD", decimalPlaces: 2, fallbackCategoryId: 3 });
    expect(usd.expenseTarget).toBe(10.01);
    expect(usdLines).toEqual(before);
  });
});
