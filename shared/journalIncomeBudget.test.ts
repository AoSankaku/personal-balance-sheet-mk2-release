import { describe, expect, test } from "bun:test";
import { calculateJournalIncomeBudgetImpact } from "./journalIncomeBudget";
import type { BudgetScopeAccount } from "./budgetScope";

const accounts: BudgetScopeAccount[] = [
  { id: 1, type: "asset", category: "cash", include_in_allocatable: 1 },
  { id: 2, type: "asset", category: "investment", include_in_allocatable: 0 },
  { id: 3, type: "income", category: "investment" },
  { id: 4, type: "expense", category: "investment_loss" },
  { id: 5, type: "asset", category: "cash", include_in_allocatable: 0 },
  { id: 6, type: "liability", category: "credit_card", deduct_from_budget: 1 },
];

const sale = (proceeds: number, bookValue: number, currency = "JPY") => {
  const gain = proceeds - bookValue;
  return [
    { account_id: 1, debit: proceeds, credit: 0, currency },
    { account_id: 2, debit: 0, credit: bookValue, currency },
    ...(gain > 0 ? [{ account_id: 3, debit: 0, credit: gain, currency }] : []),
    ...(gain < 0 ? [{ account_id: 4, debit: -gain, credit: 0, currency }] : []),
  ];
};

describe("shared income budget boundary", () => {
  test("splits sale proceeds into gain and returned principal", () => {
    expect(calculateJournalIncomeBudgetImpact({
      lines: sale(120_000, 100_000), accounts, currency: "JPY",
    })).toEqual({
      incomeCapacity: 20_000,
      investmentReturnCapacity: 100_000,
      totalCapacity: 120_000,
      excludedCash: 0,
      isInvestmentSale: true,
      trackedCashInflowByAccount: { 1: 120_000 },
      investmentReturnByAccount: { 1: 100_000 },
    });
  });

  test("treats zero-gain and losing sales as principal return only", () => {
    expect(calculateJournalIncomeBudgetImpact({ lines: sale(100, 100), accounts, currency: "JPY" }))
      .toMatchObject({ incomeCapacity: 0, investmentReturnCapacity: 100, totalCapacity: 100, isInvestmentSale: true });
    expect(calculateJournalIncomeBudgetImpact({ lines: sale(90, 100), accounts, currency: "JPY" }))
      .toMatchObject({ incomeCapacity: 0, investmentReturnCapacity: 90, totalCapacity: 90, isInvestmentSale: true });
  });

  test("keeps excluded cash outside the sale allocation boundary", () => {
    const lines = sale(120_000, 100_000).map(line => line.account_id === 1 ? { ...line, account_id: 5 } : line);
    expect(calculateJournalIncomeBudgetImpact({ lines, accounts, currency: "JPY" }))
      .toMatchObject({ incomeCapacity: 0, investmentReturnCapacity: 0, totalCapacity: 0, isInvestmentSale: false });
  });

  test("recognizes income credited directly to a budget-deducted card", () => {
    const impact = calculateJournalIncomeBudgetImpact({
      lines: [
        { account_id: 6, debit: 2_000, credit: 0, currency: "JPY" },
        { account_id: 3, debit: 0, credit: 2_000, currency: "JPY" },
      ], accounts, currency: "JPY",
    });
    expect(impact).toMatchObject({ incomeCapacity: 2_000, investmentReturnCapacity: 0, isInvestmentSale: false });
  });

  test("rounds sale capacity to the currency's minor unit", () => {
    expect(calculateJournalIncomeBudgetImpact({
      lines: sale(12.34, 10.01, "USD"), accounts, currency: "USD", decimalPlaces: 2,
    })).toMatchObject({ incomeCapacity: 2.33, investmentReturnCapacity: 10.01, totalCapacity: 12.34 });
  });

  test("retains BTC and SKR minor units and allocates principal exactly across accounts", () => {
    expect(calculateJournalIncomeBudgetImpact({
      lines: sale(0.00000002, 0.00000002, "BTC"),
      accounts,
      currency: "BTC",
      decimalPlaces: 8,
    })).toMatchObject({ incomeCapacity: 0, investmentReturnCapacity: 0.00000002, totalCapacity: 0.00000002, isInvestmentSale: true });
    expect(calculateJournalIncomeBudgetImpact({
      lines: sale(0.000000002, 0.000000002, "SKR"),
      accounts,
      currency: "SKR",
      decimalPlaces: 9,
    })).toMatchObject({ incomeCapacity: 0, investmentReturnCapacity: 0.000000002, totalCapacity: 0.000000002, isInvestmentSale: true });

    const multiAccountImpact = calculateJournalIncomeBudgetImpact({
      lines: [
        ...[1, 7, 8, 9].map(account_id => ({ account_id, debit: 0.00000001, credit: 0, currency: "BTC" })),
        { account_id: 2, debit: 0, credit: 0.00000002, currency: "BTC" },
        { account_id: 3, debit: 0, credit: 0.00000002, currency: "BTC" },
      ],
      accounts: [...accounts, ...[7, 8, 9].map(id => ({ id, type: "asset", category: "cash", include_in_allocatable: 1 }))],
      currency: "BTC",
      decimalPlaces: 8,
    });
    expect(Object.values(multiAccountImpact.investmentReturnByAccount).reduce((sum, amount) => sum + amount, 0))
      .toBe(multiAccountImpact.investmentReturnCapacity);
  });

  test("allocates one minor unit of principal when receipts are each one minor unit", () => {
    const impact = calculateJournalIncomeBudgetImpact({
      lines: [
        ...[1, 7, 8].map(account_id => ({ account_id, debit: 1, credit: 0, currency: "JPY" })),
        { account_id: 2, debit: 0, credit: 1, currency: "JPY" },
        { account_id: 3, debit: 0, credit: 2, currency: "JPY" },
      ],
      accounts: [...accounts, ...[7, 8].map(id => ({ id, type: "asset", category: "cash", include_in_allocatable: 1 }))],
      currency: "JPY",
    });
    expect(impact).toMatchObject({ incomeCapacity: 2, investmentReturnCapacity: 1, totalCapacity: 3 });
    expect(Object.values(impact.investmentReturnByAccount).reduce((sum, amount) => sum + amount, 0))
      .toBe(impact.investmentReturnCapacity);
  });
});
