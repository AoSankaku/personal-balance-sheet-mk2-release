import { isBudgetAccount, type BudgetScopeAccount } from "../../../shared/budgetScope";
import { splitAmountByLargestRemainder } from "./budgetFundingImpact";
import { fromStorageMoneyAmount, toStorageMoneyAmount, type MoneyScaleOptions } from "./moneyValidation";

interface Allocation {
  budget_category_id: number;
  amount: number;
  currency?: string;
  is_reference?: boolean;
}

/** Advances leave the household budget when funded; writing them off spends no new cash. */
export function normalizeBusinessAdvanceBudgetAllocations(input: {
  lines: { account_id: number; debit?: number; credit?: number; currency?: string }[];
  accounts: BudgetScopeAccount[];
  allocations: Allocation[];
  currency: string;
  scale: MoneyScaleOptions;
}): { allocations: Allocation[]; error?: string } | null {
  const byId = new Map(input.accounts.map(account => [account.id, account]));
  let advanceUnits = 0;
  let expenseUnits = 0;
  let budgetResourceUnits = 0;
  for (const line of input.lines) {
    const account = byId.get(line.account_id);
    const delta = toStorageMoneyAmount(line.debit ?? 0, input.currency, input.scale) -
      toStorageMoneyAmount(line.credit ?? 0, input.currency, input.scale);
    if (account?.type === "asset" && account.category === "business_advance") advanceUnits += delta;
    if (account?.type === "expense") expenseUnits += delta;
    if (isBudgetAccount(account)) budgetResourceUnits += delta;
  }
  if (advanceUnits === 0) return null;

  const spendingUnits = Math.max(0, expenseUnits) + Math.max(0, advanceUnits);
  if (spendingUnits === 0) {
    // A recovery replenishes unallocated cash; it cannot resurrect a category,
    // including one whose previous funding was cleared by a reset.
    return { allocations: input.allocations.map(allocation => ({ ...allocation, is_reference: true })) };
  }
  if (input.allocations.some(allocation => allocation.amount > 0)) {
    return { allocations: [], error: "Business advance budget allocations must be consumption" };
  }
  const totalUnits = input.allocations.reduce((sum, allocation) =>
    sum + Math.abs(toStorageMoneyAmount(allocation.amount, input.currency, input.scale)), 0);
  if (totalUnits > spendingUnits) {
    return { allocations: [], error: "Budget allocations exceed the business advance and expense amount" };
  }

  const active = input.allocations.filter(allocation => !allocation.is_reference);
  const weights = active.map(allocation => Math.abs(toStorageMoneyAmount(allocation.amount, input.currency, input.scale)));
  const capacity = Math.max(0, -budgetResourceUnits);
  const portions = splitAmountByLargestRemainder(
    Math.min(capacity, weights.reduce((sum, amount) => sum + amount, 0)),
    weights.map((weight, key) => ({ key, weight })),
  );
  const allocations = input.allocations.filter(allocation => allocation.is_reference);
  active.forEach((allocation, index) => {
    const applied = portions[index]?.amount ?? 0;
    if (applied) allocations.push({ ...allocation, currency: input.currency,
      amount: -fromStorageMoneyAmount(applied, input.currency, input.scale), is_reference: false });
    const reference = weights[index]! - applied;
    if (reference) allocations.push({ ...allocation, currency: input.currency,
      amount: -fromStorageMoneyAmount(reference, input.currency, input.scale), is_reference: true });
  });
  return { allocations };
}
