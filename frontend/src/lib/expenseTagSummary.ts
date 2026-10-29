import type { Account, JournalEntry } from "@balance-sheet/shared";
import { calculateExpenseTagAmounts, matchesExpenseTags } from "../../../shared/expenseTags";
import { lineAmountForDisplayMode, type ConvertCurrency } from "./displayCurrencyAmounts";

export function expenseTagOptions(entries: readonly JournalEntry[]) {
  const names = new Map<number, string>();
  for (const entry of entries) for (const tag of entry.expense_tags ?? []) names.set(tag.id, tag.name);
  return [...names].sort(([, left], [, right]) => left.localeCompare(right)).map(([id, name]) => ({ value: String(id), label: name }));
}

export function summarizeExpenseTags(
  entries: readonly JournalEntry[],
  accounts: readonly Pick<Account, "id" | "type">[],
  options: { currency: string; includeAllCurrencies: boolean; convertCurrency: ConvertCurrency; selectedTagIds?: readonly number[] },
) {
  const selected = options.selectedTagIds ?? [];
  const byTag = new Map<number, { id: number; name: string; amount: number; count: number }>();
  let total = 0, entryCount = 0;
  for (const entry of entries) {
    const tags = entry.expense_tags ?? [];
    if (!tags.length || !matchesExpenseTags(entry, selected)) continue;
    const amounts = entry.tag_expense_mode === "manual"
      ? entry.tag_expense_amounts ?? []
      : calculateExpenseTagAmounts(entry.lines, accounts);
    const amount = amounts.reduce((sum, value) => sum + lineAmountForDisplayMode(
      value.amount, value.currency, options.currency, options.convertCurrency, options.includeAllCurrencies,
    ), 0);
    total += amount;
    entryCount++;
    for (const tag of new Map(tags.map(tag => [tag.id, tag])).values()) {
      if (selected.length && !selected.includes(tag.id)) continue;
      const row = byTag.get(tag.id) ?? { ...tag, amount: 0, count: 0 };
      row.amount += amount;
      row.count++;
      byTag.set(tag.id, row);
    }
  }
  return {
    total: Number(total.toFixed(9)), entryCount,
    byTag: [...byTag.values()].sort((a, b) => a.name.localeCompare(b.name)).map(row => ({ ...row, amount: Number(row.amount.toFixed(9)) })),
  };
}
