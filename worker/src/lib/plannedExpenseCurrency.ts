import type { PlannedExpenseKind } from "@balance-sheet/shared";
import { normalizePlannedExpenseCurrency } from "@balance-sheet/shared";

export function isPlannedExpenseCategoryCurrencyCompatible(
  category: { kind: string; currency: string } | null | undefined,
  kind: PlannedExpenseKind,
  currency: string,
): boolean {
  return Boolean(
    category &&
      category.kind === kind &&
      normalizePlannedExpenseCurrency(category.currency) ===
        normalizePlannedExpenseCurrency(currency),
  );
}
