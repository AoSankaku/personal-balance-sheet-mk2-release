import type { AccountType, ExpenseTag, TagExpenseAmount } from "./types";

/** Defaults use expense debits minus credits, including refunds, per currency. */
export function calculateExpenseTagAmounts(
  lines: readonly { account_id: number | null; debit: number; credit: number; currency?: string }[],
  accounts: readonly { id: number; type: AccountType }[],
): TagExpenseAmount[] {
  const expenseIds = new Set(accounts.filter(account => account.type === "expense").map(account => account.id));
  const totals = new Map<string, number>();
  for (const line of lines) {
    if (line.account_id == null || !expenseIds.has(line.account_id)) continue;
    const currency = (line.currency || "JPY").toUpperCase();
    totals.set(currency, (totals.get(currency) ?? 0) + line.debit - line.credit);
  }
  return [...totals].sort(([left], [right]) => left.localeCompare(right)).map(([currency, amount]) => ({ currency, amount: Number(amount.toFixed(9)) }));
}

/** Selected tags mean any match. Filter entries once to avoid double counting. */
export function matchesExpenseTags(
  entry: { expense_tags?: readonly ExpenseTag[] },
  selectedTagIds: readonly number[],
): boolean {
  return selectedTagIds.length === 0 || (entry.expense_tags ?? []).some(tag => selectedTagIds.includes(tag.id));
}
