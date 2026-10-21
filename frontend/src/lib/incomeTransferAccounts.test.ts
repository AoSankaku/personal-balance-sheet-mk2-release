import { describe, expect, test } from "bun:test";
import { splitIncomeAllocationsAcrossSources } from "./incomeTransferAccounts";

describe("income transfer source allocation", () => {
  test("respects remaining account receipts across categories after rounding", () => {
    const split = splitIncomeAllocationsAcrossSources({
      allocations: [
        { budgetCategoryId: 10, amount: 59_999 },
        { budgetCategoryId: 20, amount: 60_001 },
      ],
      sources: [
        { accountId: 1, amount: 60_000 },
        { accountId: 2, amount: 60_000 },
      ],
      decimalPlaces: 0,
    });
    expect(split).toEqual({
      10: { 1: 30_000, 2: 29_999 },
      20: { 1: 30_000, 2: 30_001 },
    });
    expect(Object.values(split).reduce((totals, category) => {
      for (const [accountId, amount] of Object.entries(category)) {
        totals[Number(accountId)] = (totals[Number(accountId)] ?? 0) + amount;
      }
      return totals;
    }, {} as Record<number, number>)).toEqual({ 1: 60_000, 2: 60_000 });
  });

  test("assigns one-minor-unit categories to separate one-unit receipt sources", () => {
    expect(splitIncomeAllocationsAcrossSources({
      allocations: [
        { budgetCategoryId: 10, amount: 1 },
        { budgetCategoryId: 20, amount: 1 },
      ],
      sources: [
        { accountId: 1, amount: 1 },
        { accountId: 2, amount: 1 },
      ],
      decimalPlaces: 0,
    })).toEqual({ 10: { 1: 1 }, 20: { 2: 1 } });
  });
});
