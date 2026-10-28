import { describe, expect, test } from "bun:test";
import type { Account, CreateJournalInput } from "@balance-sheet/shared";
import { buildBulkJournalEntries } from "./bulkEntrySubmission";
import * as scope from "./incomeBudgetScope";
import { buildExpenseBudgetAllocations, getLoanSettlementDifference, summarizeBudgetDistribution } from "./simpleEntryUtils";

const accounts = [
  { id: 1, name: "Bank", type: "asset", category: "cash", include_in_allocatable: true },
  { id: 2, name: "Holding", type: "asset", category: "cash", include_in_allocatable: true },
  { id: 3, name: "Purchase", type: "expense", category: "other", budget_ratios: [{ budget_category_id: 10, ratio: 60 }, { budget_category_id: 11, ratio: 40 }] },
  { id: 4, name: "Income", type: "income", category: "other" },
  { id: 5, name: "Card", type: "liability", category: "credit_card", deduct_from_budget: true },
  { id: 6, name: "Untracked", type: "asset", category: "cash", include_in_allocatable: false },
  { id: 7, name: "Other holding", type: "asset", category: "cash", include_in_allocatable: true },
  { id: 8, name: "Loan", type: "liability", category: "short_term_loan" },
].map(a => ({ ...a, created_at: "2026-01-01", balances: { JPY: 0, USD: 0 } })) as Account[];
const categories = [{ id: 10, name: "Reserve", target_accounts: [{ account_id: 2, ratio: 100 }] }, { id: 11, name: "Other", target_accounts: [{ account_id: 2, ratio: 100 }] }];
const date = new Date(2026, 9, 20);
const expense = { type: "expense", date, itemName: "Purchase", qty: 1, price: 25.55, expenseAccountId: "3" } as const;
const discount = { type: "discount", date, discountType: "Points", amount: 5, incomeAccountId: "4", budgetCategoryId: "10", deferTransfer: true } as const;
type BuildInput = Parameters<typeof buildBulkJournalEntries>[0];
const build = (rows: BuildInput["rows"], extra: Partial<BuildInput> = {}) => buildBulkJournalEntries({ rows, paymentAccount: accounts[0], accounts, budgetCategories: categories, currency: "USD", decimalPlaces: 2, defaultExpenseDescription: "Purchase", defaultDiscountDescription: "Discount", ...extra });

describe("bulk journal submission parity", () => {
  test("preserves selected currency and cents in journal lines and budget splits", () => {
    const result = build([expense]);
    expect(result.entries[0]!.lines.map(l => l.currency)).toEqual(["USD", "USD"]);
    expect(result.entries[0]!.budget_allocations).toEqual([{ budget_category_id: 10, amount: -15.33, currency: "USD" }, { budget_category_id: 11, amount: -10.22, currency: "USD" }]);
  });

  test("saves income allocation, physical transfer, and the per-income deferred choice together", () => {
    const entry = build([discount]).entries[0]!;
    expect(entry.income_budget_allocations).toEqual([{ budget_category_id: 10, amount: 5, currency: "USD" }]);
    expect(entry.income_transfer_destinations).toEqual([{ budget_category_id: 10, from_account_id: 1, to_account_id: 2, amount: 5, currency: "USD", is_deferred: true }]);
  });

  test("card discounts keep allocations but cannot create physical transfers", () => {
    const entry = build([discount], { paymentAccount: accounts[4] }).entries[0]!;
    expect(entry.income_budget_allocations).toHaveLength(1);
    expect(entry.income_transfer_destinations).toEqual([]);
  });

  test("excluded destinations discard stale income allocations and transfers", () => {
    const entry = build([discount], { paymentAccount: accounts[5] }).entries[0]!;
    expect(entry.income_budget_allocations).toBeUndefined();
    expect(entry.income_transfer_destinations).toEqual([]);
  });

  test("requires a selected holding account when several candidates remain", () => {
    const budgetCategories = [{ ...categories[0]!, target_accounts: [{ account_id: 2, ratio: 1 }, { account_id: 7, ratio: 1 }] }];
    expect(() => build([discount], { budgetCategories })).toThrow();
    expect(build([{ ...discount, transferAccountId: "7" }], { budgetCategories }).entries[0]!.income_transfer_destinations![0]!.to_account_id).toBe(7);
  });

  const loanInput: CreateJournalInput = { date: "2026-10-20", description: "Repay", lines: [{ account_id: 8, debit: 200, credit: 0 }, { account_id: 1, debit: 0, credit: 200 }], loan_settlement_journal_entry_ids: [99], budget_funding: { kind: "repay", principal_amount: 200, source_journal_entry_ids: [99] }, budget_funding_components: [{ kind: "repay", principal_amount: 200, applied_amount: 200, component_only_amount: 0, source_journal_entry_ids: [99], allocations: [{ budget_category_id: 10, amount: 200, effect: "apply", source_journal_entry_id: 99 }] }] };
  const loanRow = { type: "loan", input: loanInput, draft: { formValues: { entryType: "loan", loanDirection: "decrease", amount: 200 }, budgetDist: [], showZeroCategories: false }, currency: "USD", paymentAccountId: "1" };

  test("keeps the normal loan form's principal and opening references without ordinary expense consumption", () => {
    const entry = build([loanRow]).entries[0]!;
    expect(entry.loan_settlement_journal_entry_ids).toEqual([99]);
    expect(entry.budget_funding_components![0]!.source_journal_entry_ids).toEqual([99]);
    expect(entry.budget_funding_components![0]!.allocations![0]!.currency).toBe("USD");
    expect(entry.budget_allocations).toBeUndefined();
    expect(entry.lines.every(l => l.currency === "USD")).toBe(true);
  });

  test("never silently posts an unconfigured, stale-currency, or stale-payment loan row", () => {
    expect(() => build([{ ...expense, expenseAccountId: "8" }])).toThrow();
    expect(() => build([{ ...loanRow, input: null }])).toThrow();
    expect(() => build([{ ...loanRow, currency: "JPY" }])).toThrow();
    expect(() => build([{ ...loanRow, paymentAccountId: "2" }])).toThrow();
  });

  test("does not let two bulk rows consume the same opening settlement", () => {
    expect(() => build([loanRow, loanRow])).toThrow();
  });

  test("preserves the normal card-repayment exception without manufacturing loan funding", () => {
    const entry = build([{ ...loanRow, input: { date: "2026-10-20", description: "Card repayment", lines: [{ account_id: 5, debit: 200, credit: 0 }, { account_id: 1, debit: 0, credit: 200 }] } }]).entries[0]!;
    expect(entry.budget_funding).toBeUndefined();
    expect(entry.budget_funding_components).toBeUndefined();
    expect(entry.lines[0]!.account_id).toBe(5);
  });

  test("normal and bulk income use one transfer builder with the same explicit resume flag", () => {
    const shared = scope.buildIncomeBudgetEntryFields;
    const normal = shared({ destinationAccount: accounts[0], incomeBudgetAllocations: [{ budget_category_id: 10, amount: 5 }], accounts, categories, currency: "USD", defer: false });
    const bulk = build([{ ...discount, deferTransfer: false }]).entries[0]!;
    expect(bulk.income_budget_allocations).toEqual(normal.income_budget_allocations);
    expect(bulk.income_transfer_destinations).toEqual(normal.income_transfer_destinations);
    expect(normal.income_transfer_destinations![0]!.is_deferred).toBe(false);
  });

  test("counts incomplete ordinary rows while retaining the valid configured income row", () => {
    const result = build([
      { ...expense, price: 0 },
      { ...expense, expenseAccountId: null },
      { ...discount, incomeAccountId: null },
      discount,
    ]);
    expect(result.skippedCount).toBe(2);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.description).toBe("Points");
  });

  test("rejects amounts that cannot be represented in the selected currency", () => {
    expect(() => build([{ ...expense, price: 1.001 }])).toThrow("bulk_invalid_amount");
    expect(() => build([{ ...discount, amount: Number.NaN }])).toThrow("bulk_invalid_amount");
    expect(() => build([{ ...expense, qty: 0 }])).toThrow("bulk_invalid_amount");
  });

  test("rejects an explicitly different currency in a prepared loan and retains legacy funding splits", () => {
    expect(() => build([{ ...loanRow, input: { ...loanInput, lines: loanInput.lines.map(line => ({ ...line, currency: "JPY" })) } }])).toThrow("bulk_currency_changed");
    const entry = build([{ ...loanRow, input: { ...loanInput, budget_funding: { kind: "repay", principal_amount: 200, allocations: [{ budget_category_id: 10, amount: 200, source_journal_entry_id: 99 }] } } }]).entries[0]!;
    expect(entry.budget_funding!.allocations).toEqual([{ budget_category_id: 10, amount: 200, source_journal_entry_id: 99, currency: "USD" }]);
  });
});

test("the shared normal/bulk expense allocator distributes smallest currency units", () => {
  expect(buildExpenseBudgetAllocations(25.55, [{ budget_category_id: 10, ratio: 60 }, { budget_category_id: 11, ratio: 40 }], -1, 2)).toEqual([{ budget_category_id: 10, amount: -15.33 }, { budget_category_id: 11, amount: -10.22 }]);
  expect(summarizeBudgetDistribution(25.55, [{ budget_category_id: 10, ratio: 100, amount: 25.55 }], 2).isComplete).toBe(true);
});

test("loan settlement differences retain one minor unit and ignore floating-point residue", () => {
  expect(getLoanSettlementDifference(20.02, 20.01, 2)).toBe(0.01);
  expect(getLoanSettlementDifference(20.01, 20.02, 2)).toBe(-0.01);
  expect(getLoanSettlementDifference(0.3, 0.1 + 0.2, 2)).toBe(0);
  expect(getLoanSettlementDifference(1.001, 1, 3)).toBe(0.001);
  expect(getLoanSettlementDifference(0.00000002, 0.00000001, 8)).toBe(0.00000001);
});
