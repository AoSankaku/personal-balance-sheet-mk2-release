export type ConvertCurrency = (amount: number, from: string, to: string) => number;

function normalizeCurrency(currency: string | null | undefined): string {
  return (currency || "JPY").toUpperCase();
}

export function balanceMapAmountInCurrency(
  balances: Record<string, number> | null | undefined,
  currency: string,
  convertCurrency: ConvertCurrency,
): number {
  const target = normalizeCurrency(currency);
  return Object.entries(balances ?? {}).reduce(
    (sum, [source, amount]) =>
      sum + convertCurrency(amount, normalizeCurrency(source), target),
    0,
  );
}

export function balanceMapAmountForDisplayMode(
  balances: Record<string, number> | null | undefined,
  currency: string,
  convertCurrency: ConvertCurrency,
  includeAllCurrencies: boolean,
): number {
  const target = normalizeCurrency(currency);
  if (!includeAllCurrencies) return balances?.[target] ?? 0;
  return balanceMapAmountInCurrency(balances, target, convertCurrency);
}

export function lineAmountInCurrency(
  amount: number,
  sourceCurrency: string | null | undefined,
  targetCurrency: string,
  convertCurrency: ConvertCurrency,
): number {
  return convertCurrency(
    amount,
    normalizeCurrency(sourceCurrency),
    normalizeCurrency(targetCurrency),
  );
}

export function lineAmountForDisplayMode(
  amount: number,
  sourceCurrency: string | null | undefined,
  targetCurrency: string,
  convertCurrency: ConvertCurrency,
  includeAllCurrencies: boolean,
): number {
  const source = normalizeCurrency(sourceCurrency);
  const target = normalizeCurrency(targetCurrency);
  if (!includeAllCurrencies) return source === target ? amount : 0;
  return convertCurrency(amount, source, target);
}
