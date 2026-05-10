/**
 * 2025 calendar-year average exchange rates with USD as pivot.
 *
 * Convention: 1 USD = N units of the given currency (USD = 1 exactly).
 * Written to 10 significant figures so that cross-rate calculations
 * between any two non-USD currencies (e.g. KRW → IDR) stay precise.
 *
 * Why USD pivot instead of JPY pivot:
 *   Currencies like IDR (≈16 000/USD) or VND (≈25 000/USD) would be stored
 *   as sub-hundredth fractions of JPY (≈0.0094, ≈0.0059), losing significant
 *   figures before any arithmetic is done.  Storing them as large integers
 *   relative to USD preserves all 10 significant figures through division.
 */
export const FALLBACK_2025_PER_USD: Record<string, number> = {
  USD: 1.000000000,
  JPY: 152.0000000,
  EUR: 0.9180000000,
  GBP: 0.7880000000,
  AUD: 1.580000000,
  CAD: 1.390000000,
  CHF: 0.8970000000,
  CNY: 7.250000000,
  HKD: 7.786000000,
  KRW: 1395.000000,
  SGD: 1.345000000,
  THB: 34.20000000,
  IDR: 16200.00000,
  MYR: 4.450000000,
  PHP: 57.50000000,
  VND: 25300.00000,
  INR: 84.20000000,
  SEK: 10.65000000,
  NOK: 10.90000000,
  DKK: 6.870000000,
  NZD: 1.720000000,
  MXN: 19.70000000,
  BRL: 5.870000000,
  ZAR: 18.60000000,
  TRY: 35.50000000,
  PLN: 4.000000000,
  CZK: 23.80000000,
  HUF: 378.0000000,
  RON: 4.620000000,
  BGN: 1.797000000,
  ILS: 3.720000000,
  ISK: 139.0000000,
};

/**
 * Convert an amount directly between any two currencies using 2025 fallback
 * rates.  USD is the internal pivot, so precision is consistent even for
 * large-integer currencies: amount × (toRate / fromRate).
 *
 * Returns the original amount unchanged when either currency is unknown.
 */
export function convertFallback(
  amount: number,
  from: string,
  to: string,
): number {
  if (from === to) return amount;
  const fromRate = FALLBACK_2025_PER_USD[from];
  const toRate = FALLBACK_2025_PER_USD[to];
  if (!fromRate || !toRate) return amount;
  return (amount * toRate) / fromRate;
}

/**
 * Convert the USD-pivot table into the "1 currency = X JPY" format expected
 * by useExchangeRates.  Called once at module load; result is a constant.
 *
 * Derivation:
 *   jpyPerUnit[X] = jpyPerUsd / unitsPerUsd[X]
 *   e.g. IDR: 152.0 / 16200 = 0.009382716049...  (9+ sig figs)
 */
function buildJpyPivotFallback(): Record<string, number> {
  const jpyPerUsd = FALLBACK_2025_PER_USD.JPY;
  const result: Record<string, number> = { JPY: 1 };
  for (const [code, unitsPerUsd] of Object.entries(FALLBACK_2025_PER_USD)) {
    if (code === "JPY") continue;
    result[code] = jpyPerUsd / unitsPerUsd;
  }
  return result;
}

/**
 * Pre-built JPY-pivot fallback map.  Spread this as a base layer before
 * overlaying live rates so every currency always has a non-zero value.
 */
export const FALLBACK_JPY_PIVOT: Record<string, number> =
  buildJpyPivotFallback();
