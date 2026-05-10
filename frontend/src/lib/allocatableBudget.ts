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
    (sum, available) => sum + Math.abs(available),
    0,
  );
}

export function computeAllocatableBudget(
  cashBalance: number,
  budgetAvailableValues: number[],
): number {
  return cashBalance - sumBudgetClaims(budgetAvailableValues);
}
