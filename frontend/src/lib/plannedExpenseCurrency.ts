import { normalizePlannedExpenseCurrency } from "@balance-sheet/shared";

type ConvertCurrency = (amount: number, from: string, to: string) => number;

export function preservePlannedExpensesAcrossCurrencies<T>(rows: T[]): T[] {
  return rows;
}

export function categoriesForPlannedExpenseCurrency<
  T extends { currency: string },
>(rows: T[], currency: string): T[] {
  return filterPlannedExpensesForCurrency(rows, currency);
}

export function filterPlannedExpensesForCurrency<T extends { currency: string }>(
  rows: T[],
  currency: string,
): T[] {
  const normalizedCurrency = normalizePlannedExpenseCurrency(currency);
  return rows.filter(
    (row) =>
      normalizePlannedExpenseCurrency(row.currency) === normalizedCurrency,
  );
}

export function plannedExpenseJournalCurrency(
  sourceCurrency: string | null | undefined,
  displayCurrency: string | null | undefined,
): string {
  return normalizePlannedExpenseCurrency(sourceCurrency || displayCurrency);
}

export function plannedExpenseReferenceAmount(
  amount: number,
  sourceCurrency: string,
  selectedCurrency: string,
  convertCurrency: ConvertCurrency,
): number | null {
  const source = normalizePlannedExpenseCurrency(sourceCurrency);
  const selected = normalizePlannedExpenseCurrency(selectedCurrency);
  if (source === selected) return null;
  const converted = convertCurrency(amount, source, selected);
  if (!Number.isFinite(converted) || (amount !== 0 && converted <= 0)) {
    return null;
  }
  return converted;
}

export function buildPlannedExpenseInputOverride(
  amount: number,
  sourceCurrency: string,
  selectedCurrency: string,
  convertCurrency: ConvertCurrency,
  targetDecimalPlaces = 2,
): { inputAmount: number; inputCurrency: string } | null {
  const inputAmount = plannedExpenseReferenceAmount(
    amount,
    sourceCurrency,
    selectedCurrency,
    convertCurrency,
  );
  if (inputAmount === null) return null;
  const scale = 10 ** Math.max(0, targetDecimalPlaces);
  return {
    inputAmount: Math.round(inputAmount * scale) / scale,
    inputCurrency: normalizePlannedExpenseCurrency(selectedCurrency),
  };
}
