import type { Account, JournalEntry } from "@balance-sheet/shared";
import { budgetAccountDelta, isBudgetAccount, isBudgetAsset } from "../../../shared/budgetScope";
import { hasBudgetAllocationMismatch } from "./budgetConsistency";

const currencyCode = (currency?: string) => (currency || "JPY").toUpperCase();

function isExcludedCash(account: Account): boolean {
  return account.type === "asset" && account.category === "cash" &&
    account.is_depreciable !== true && !isBudgetAsset(account);
}

/**
 * Some compound entries consume a budget both for an expense and for cash moved
 * outside budget management. Accept that saved total only when each currency's
 * journal independently proves the additional decrease. Keep the ordinary
 * expense comparison for flows with separate transfer/funding classifications.
 */
export function matchesExpenseAndExcludedCashTransfer(
  entry: JournalEntry,
  accountMap: Map<number, Account>,
  excludedExpenseAllocationCategoryId?: number | null,
): boolean {
  const allocations = (entry.budget_allocations ?? []).filter(
    (allocation) => allocation.budget_category_id !== excludedExpenseAllocationCategoryId,
  );
  const currencies = new Set([
    ...entry.lines.map((line) => currencyCode(line.currency)),
    ...allocations.map((allocation) => currencyCode(allocation.currency)),
  ]);
  let includesTransfer = false;
  for (const currency of currencies) {
    const lines = entry.lines.filter((line) => currencyCode(line.currency) === currency);
    const currencyAllocations = allocations.filter((allocation) => currencyCode(allocation.currency) === currency);
    const expense = lines.reduce((sum, line) => accountMap.get(line.account_id)?.type === "expense"
      ? sum + line.debit - line.credit : sum, 0);
    const allocated = -currencyAllocations.reduce((sum, allocation) => sum + allocation.amount, 0);
    if (!hasBudgetAllocationMismatch(expense, allocated)) continue;

    // Reference rows and dedicated business/loan/transfer records must retain
    // their existing treatment instead of being reinterpreted as cash movement.
    if (
      currencyAllocations.some((allocation) => allocation.is_reference) ||
      (entry.budget_allocations ?? []).some((allocation) =>
        allocation.budget_category_id === excludedExpenseAllocationCategoryId &&
        allocation.amount !== 0 && currencyCode(allocation.currency) === currency) ||
      (entry.income_budget_allocations ?? []).some((allocation) =>
        allocation.amount !== 0 && currencyCode(allocation.currency) === currency) ||
      (entry.budget_funding?.allocations.length ?? 0) > 0 ||
      (entry.budget_funding_components?.length ?? 0) > 0 ||
      lines.some((line) => {
        const account = accountMap.get(line.account_id);
        return !account || !(account.type === "expense" || isBudgetAccount(account) || isExcludedCash(account));
      })
    ) return false;

    const excludedCashIncrease = lines.reduce((sum, line) => {
      const account = accountMap.get(line.account_id);
      return account && isExcludedCash(account) ? sum + line.debit - line.credit : sum;
    }, 0);
    const expected = expense + excludedCashIncrease;
    if (
      excludedCashIncrease <= 0 ||
      !hasBudgetAllocationMismatch(excludedCashIncrease, 0) ||
      hasBudgetAllocationMismatch(expected, allocated) ||
      hasBudgetAllocationMismatch(expected, -budgetAccountDelta(lines, [...accountMap.values()], currency))
    ) return false;
    includesTransfer = true;
  }
  return includesTransfer;
}
