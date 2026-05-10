import type { ExchangeRates } from "@balance-sheet/shared";

export const LS_MANUAL_EXCHANGE_RATES_KEY = "manual_exchange_rates";

export function parseManualExchangeRate(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

export function readManualExchangeRates(): ExchangeRates {
  try {
    const raw = localStorage.getItem(LS_MANUAL_EXCHANGE_RATES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const rates: ExchangeRates = {};
    for (const [rawCode, rawRate] of Object.entries(parsed)) {
      const code = rawCode.trim().toUpperCase();
      const rate = parseManualExchangeRate(rawRate);
      if (code && rate !== null) rates[code] = rate;
    }
    return rates;
  } catch {
    return {};
  }
}

export function writeManualExchangeRates(rates: ExchangeRates) {
  const normalized: ExchangeRates = {};
  for (const [rawCode, rawRate] of Object.entries(rates)) {
    const code = rawCode.trim().toUpperCase();
    const rate = parseManualExchangeRate(rawRate);
    if (code && rate !== null) normalized[code] = rate;
  }
  try {
    localStorage.setItem(
      LS_MANUAL_EXCHANGE_RATES_KEY,
      JSON.stringify(normalized),
    );
  } catch {}
  return normalized;
}
