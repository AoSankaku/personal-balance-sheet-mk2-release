export interface BudgetScopeAccount {
  id: number;
  type: string;
  category: string;
  include_in_allocatable?: boolean | number;
  is_depreciable?: boolean | number;
  deduct_from_budget?: boolean | number;
  balances?: Record<string, number>;
  balance?: number | null;
}

export function isBudgetAsset(account: BudgetScopeAccount | undefined): boolean {
  return !!account && account.type === "asset" && account.category === "cash" &&
    account.include_in_allocatable !== false && account.include_in_allocatable !== 0 &&
    account.is_depreciable !== true && account.is_depreciable !== 1;
}

export function isBudgetLiability(account: BudgetScopeAccount | undefined): boolean {
  if (!account || account.type !== "liability") return false;
  return account.deduct_from_budget == null
    ? account.category === "credit_card"
    : account.deduct_from_budget === true || account.deduct_from_budget === 1;
}

export function isBudgetAccount(account: BudgetScopeAccount | undefined): boolean {
  return isBudgetAsset(account) || isBudgetLiability(account);
}

export function budgetAccountDelta(
  lines: { account_id: number; debit?: number; credit?: number; currency?: string }[],
  accounts: BudgetScopeAccount[],
  currency: string,
): number {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  return lines.reduce((sum, line) =>
    (line.currency || "JPY").toUpperCase() === currency.toUpperCase() && isBudgetAccount(byId.get(line.account_id))
      ? sum + (line.debit ?? 0) - (line.credit ?? 0) : sum, 0);
}

/** API balances are debit-normal for assets and credit-normal for liabilities. */
export function sumBudgetResourceBalances(accounts: BudgetScopeAccount[], currency: string): number {
  return accounts.reduce((sum, account) => {
    if (!isBudgetAccount(account)) return sum;
    const balance = account.balances
      ? account.balances[currency.toUpperCase()] ?? 0
      : currency.toUpperCase() === "JPY" ? account.balance ?? 0 : 0;
    return sum + (account.type === "liability" ? -balance : balance);
  }, 0);
}
