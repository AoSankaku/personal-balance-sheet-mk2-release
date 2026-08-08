import type { Account } from "@balance-sheet/shared";

export function isAllocatableCashAccount(account: Account): boolean {
  return (
    account.type === "asset" &&
    account.category === "cash" &&
    account.include_in_allocatable !== false &&
    account.is_depreciable !== true
  );
}

export function accountBalanceInCurrency(account: Account, currency: string) {
  if (account.balances) return account.balances[currency] ?? 0;
  return currency === "JPY" ? (account.balance ?? 0) : 0;
}

export function sumAllocatableCashBalances(
  accounts: Account[],
  currency: string,
): number {
  return accounts
    .filter(isAllocatableCashAccount)
    .reduce(
      (sum, account) => sum + accountBalanceInCurrency(account, currency),
      0,
    );
}

export function sumBudgetClaims(availableValues: number[]): number {
  return availableValues.reduce(
    (sum, available) => sum + Math.max(available, 0),
    0,
  );
}

export function sumBudgetOverspending(availableValues: number[]): number {
  return availableValues.reduce(
    (sum, available) => sum + Math.max(-available, 0),
    0,
  );
}

export interface BudgetFundingSummary {
  allocatableCash: number;
  netBudgetBalance: number;
  positiveBudgetClaims: number;
  unfundedOverspending: number;
  reconciliationGap: number;
  fundingGap: number;
}

export function summarizeBudgetFunding(
  cashBalance: number,
  budgetAvailableValues: number[],
): BudgetFundingSummary {
  const netBudgetBalance = budgetAvailableValues.reduce(
    (sum, available) => sum + available,
    0,
  );
  const positiveBudgetClaims = sumBudgetClaims(budgetAvailableValues);
  return {
    allocatableCash: cashBalance,
    netBudgetBalance,
    positiveBudgetClaims,
    unfundedOverspending: sumBudgetOverspending(budgetAvailableValues),
    reconciliationGap: cashBalance - netBudgetBalance,
    fundingGap: cashBalance - positiveBudgetClaims,
  };
}

export function computeAllocatableBudget(
  cashBalance: number,
  budgetAvailableValues: number[],
): number {
  return summarizeBudgetFunding(cashBalance, budgetAvailableValues).fundingGap;
}
