import { useCallback, useEffect, useRef, useState } from "react";
import type { CryptoPrices, ExchangeRates } from "@balance-sheet/shared";
import { FALLBACK_JPY_PIVOT } from "../utils/fallbackRates2025";
import {
  clearManualExchangeRates,
  readManualExchangeRateSpecs,
  type ManualExchangeRateSpec,
  type ManualExchangeRateSpecs,
  writeManualExchangeRateSpecs,
} from "../lib/manualExchangeRates";

export const LS_FIAT_PROVIDER_KEY = "fiat_rate_provider";
export type FiatProvider = "frankfurter" | "er_api";

export function getFiatProvider(): FiatProvider {
  try {
    const val = localStorage.getItem(LS_FIAT_PROVIDER_KEY);
    return val === "er_api" ? "er_api" : "frankfurter";
  } catch {
    return "frankfurter";
  }
}

const COOLDOWN_SECS = 1800; // 30 minutes
const MISSING_FIAT_COOLDOWN_SECS = 30; // when a missing fiat code is added
export const LS_RATES_KEY = "exchange_rates_cache";
export const LS_LAST_FETCH_KEY = "exchange_rates_last_fetch_at";
const LS_EXTRA_FIAT_CODES_KEY = "exchange_rates_extra_fiat_codes";

// Both Frankfurter and ExchangeRate-API return rates as "1 JPY = X currency"
// when base=JPY. We invert to get "1 currency = X JPY".
const BASE_FIAT_CODES = [
  "USD",
  "EUR",
  "GBP",
  "AUD",
  "CAD",
  "CHF",
  "CNY",
  "HKD",
  "KRW",
  "SGD",
  "THB",
  "IDR",
  "MYR",
  "PHP",
  "VND",
  "INR",
  "SEK",
  "NOK",
  "DKK",
  "NZD",
  "MXN",
  "BRL",
  "ZAR",
  "TRY",
  "PLN",
  "CZK",
  "HUF",
  "RON",
  "BGN",
  "ILS",
  "ISK",
];

const BASE_FIAT_CODE_SET = new Set(BASE_FIAT_CODES);
const CRYPTO_CODE_SET = new Set([
  "BTC",
  "ETH",
  "SOL",
  "SKR",
  "BNB",
  "XRP",
  "ADA",
  "DOGE",
  "AVAX",
  "DOT",
  "LINK",
  "LTC",
  "ATOM",
]);
type InFlightFiatRates = { symbols: string; promise: Promise<Record<string, number>> };
let inFlightFiatRates: InFlightFiatRates | null = null;

export function isKnownFiatCurrency(code: string | null | undefined): boolean {
  return BASE_FIAT_CODE_SET.has((code ?? "").trim().toUpperCase());
}

function invertRates(raw: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [code, ratePerJpy] of Object.entries(raw)) {
    if (ratePerJpy > 0) result[code] = 1 / ratePerJpy;
  }
  return result;
}

function normalizeCurrencyCode(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase();
}

function isFiatCodeCandidate(code: string): boolean {
  return /^[A-Z]{3}$/.test(code);
}

function readExtraFiatCodes(): string[] {
  try {
    const raw = localStorage.getItem(LS_EXTRA_FIAT_CODES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const result: string[] = [];
    for (const val of parsed) {
      const code = normalizeCurrencyCode(String(val));
      if (!isFiatCodeCandidate(code)) continue;
      if (code === "JPY") continue;
      result.push(code);
    }
    return [...new Set(result)];
  } catch {
    return [];
  }
}

function writeExtraFiatCodes(codes: Iterable<string>) {
  const normalized = [...new Set([...codes].map((c) => normalizeCurrencyCode(c)))]
    .filter((c) => isFiatCodeCandidate(c) && c !== "JPY")
    .sort();
  try {
    localStorage.setItem(LS_EXTRA_FIAT_CODES_KEY, JSON.stringify(normalized));
  } catch {}
  return normalized;
}

function getFiatSymbols(extra: string[] = readExtraFiatCodes()): string {
  const merged = new Set<string>(BASE_FIAT_CODES);
  for (const code of extra) merged.add(code);
  return [...merged].sort().join(",");
}

async function fetchFrankfurter(symbols: string): Promise<Record<string, number>> {
  const url = `https://api.frankfurter.dev/v1/latest?base=JPY&symbols=${symbols}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Frankfurter fetch failed");
  const data = (await res.json()) as { rates: Record<string, number> };
  return invertRates(data.rates);
}

async function fetchErApi(symbols: string): Promise<Record<string, number>> {
  const res = await fetch("https://open.er-api.com/v6/latest/JPY");
  if (!res.ok) throw new Error("ExchangeRate-API fetch failed");
  const data = (await res.json()) as { rates: Record<string, number> };
  const inverted = invertRates(data.rates);
  const wanted = new Set(symbols.split(",").map((s) => s.trim().toUpperCase()));
  const filtered: Record<string, number> = {};
  for (const [code, rate] of Object.entries(inverted)) {
    if (wanted.has(code)) filtered[code] = rate;
  }
  return filtered;
}

function readCachedRates(): ExchangeRates | null {
  try {
    const raw = localStorage.getItem(LS_RATES_KEY);
    return raw ? (JSON.parse(raw) as ExchangeRates) : null;
  } catch {
    return null;
  }
}

function readCachedLastFetch(): number {
  try {
    return parseInt(localStorage.getItem(LS_LAST_FETCH_KEY) ?? "0", 10) || 0;
  } catch {
    return 0;
  }
}

async function fetchFiatRatesUncached(symbols: string): Promise<Record<string, number>> {
  const provider = getFiatProvider();
  const primary = provider === "er_api" ? fetchErApi : fetchFrankfurter;
  const fallback = provider === "er_api" ? fetchFrankfurter : fetchErApi;
  try {
    return await primary(symbols);
  } catch {
    return fallback(symbols);
  }
}

async function fetchFiatRates(symbols: string): Promise<Record<string, number>> {
  if (inFlightFiatRates && inFlightFiatRates.symbols === symbols) {
    return inFlightFiatRates.promise;
  }
  const promise = fetchFiatRatesUncached(symbols).finally(() => {
    if (inFlightFiatRates?.promise === promise) inFlightFiatRates = null;
  });
  inFlightFiatRates = { symbols, promise };
  return promise;
}

/** Build exchange rates from fiat API response + crypto prices */
function buildRates(
  fiat: Record<string, number>,
  crypto: CryptoPrices | null,
  manual: ManualExchangeRateSpecs = readManualExchangeRateSpecs(),
): ExchangeRates {
  // Fallback is the base layer; live fiat data overwrites it where available.
  const rates: ExchangeRates = { ...FALLBACK_JPY_PIVOT, ...fiat, JPY: 1 };
  if (crypto?.byTicker) {
    for (const [ticker, jpy] of Object.entries(crypto.byTicker)) {
      if (jpy != null && jpy > 0) rates[ticker] = jpy;
    }
  }
  for (const [code, spec] of Object.entries(manual)) {
    if (!spec || code === "JPY") continue;
    const base = normalizeCurrencyCode(spec.base);
    if (!base || base === code) continue;
    const baseJpy = base === "JPY" ? 1 : (rates[base] ?? 0);
    if (baseJpy <= 0) continue;
    if (spec.rate > 0) rates[code] = spec.rate * baseJpy;
  }
  rates.JPY = 1;
  return rates;
}

function hasCompleteFiatRates(rates: ExchangeRates | null, required: string[]): boolean {
  if (!rates) return false;
  return required.every((code) => (rates[code] ?? 0) > 0);
}

export interface UseExchangeRatesResult {
  /** All rates as: 1 unit of currency = X JPY. Always includes JPY: 1. */
  rates: ExchangeRates;
  /** Seconds remaining in 30-min cooldown (0 = ready to refresh) */
  cooldownRemaining: number;
  /** Manually trigger a refresh. Returns false if still on cooldown. */
  refresh: () => Promise<boolean>;
  /** Force refresh bypassing cooldown (use when switching provider). */
  forceRefresh: () => Promise<void>;
  /** Manual custom-currency rates as: 1 unit of CODE = rate units of base */
  manualRateSpecs: ManualExchangeRateSpecs;
  /** Save or clear one manual custom-currency rate */
  setManualRateSpec: (code: string, spec: ManualExchangeRateSpec | null) => void;
  /** Clear manually entered rates and cached exchange-rate state. */
  resetStoredRates: () => void;
  /** Ensure rates exist for missing fiat codes (30s cooldown when missing) */
  ensureRatesForCurrencies: (codes: string[]) => Promise<void>;
  /** Convert an amount from one currency to another using current rates */
  convert: (amount: number, from: string, to: string) => number;
}

export function useExchangeRates(
  cryptoPrices: CryptoPrices | null,
): UseExchangeRatesResult {
  const [rates, setRates] = useState<ExchangeRates>(() => {
    const cached = readCachedRates();
    // Seed with fallback so all currencies have a value before the first fetch.
    return buildRates(cached ?? FALLBACK_JPY_PIVOT, cryptoPrices);
  });
  const [manualRateSpecs, setManualRateSpecs] = useState<ManualExchangeRateSpecs>(
    readManualExchangeRateSpecs,
  );
  const [cooldownRemaining, setCooldownRemaining] = useState(() => {
    const elapsed = Math.floor((Date.now() - readCachedLastFetch()) / 1000);
    return Math.max(0, COOLDOWN_SECS - elapsed);
  });

  const lastFetchAt = useRef(readCachedLastFetch());
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ratesRef = useRef(rates);

  useEffect(() => {
    ratesRef.current = rates;
  }, [rates]);

  function beginCooldown(at: number) {
    lastFetchAt.current = at;
    try {
      localStorage.setItem(LS_LAST_FETCH_KEY, String(at));
    } catch {}
    const initial = Math.max(
      0,
      COOLDOWN_SECS - Math.floor((Date.now() - at) / 1000),
    );
    setCooldownRemaining(initial);
    if (tickerRef.current) clearInterval(tickerRef.current);
    if (initial === 0) return;
    tickerRef.current = setInterval(() => {
      const rem = Math.max(
        0,
        COOLDOWN_SECS - Math.floor((Date.now() - lastFetchAt.current) / 1000),
      );
      setCooldownRemaining(rem);
      if (rem === 0 && tickerRef.current) {
        clearInterval(tickerRef.current);
        tickerRef.current = null;
      }
    }, 1000);
  }

  function saveRates(r: ExchangeRates) {
    setRates(r);
    try {
      localStorage.setItem(LS_RATES_KEY, JSON.stringify(r));
    } catch {}
  }

  // On mount: fetch if cooldown expired
  useEffect(() => {
    const cachedAt = readCachedLastFetch();
    const elapsed = Date.now() - cachedAt;
    const cached = readCachedRates();
    const requiredFiatCodes = getFiatSymbols()
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    if (
      elapsed < COOLDOWN_SECS * 1000 &&
      hasCompleteFiatRates(cached, requiredFiatCodes)
    ) {
      // Still in cooldown — resume ticker, but merge in new crypto prices
      beginCooldown(cachedAt);
      if (cached && cryptoPrices?.byTicker) {
        saveRates(buildRates(cached, cryptoPrices));
      }
      return () => {
        if (tickerRef.current) clearInterval(tickerRef.current);
      };
    }

    let alive = true;
    fetchFiatRates(getFiatSymbols())
      .then((fiat) => {
        if (!alive) return;
        const built = buildRates(fiat, cryptoPrices);
        saveRates(built);
        beginCooldown(Date.now());
      })
      .catch(() => {});

    return () => {
      alive = false;
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When crypto prices change, merge them into existing rates without triggering fiat refetch
  useEffect(() => {
    if (!cryptoPrices?.byTicker) return;
    setRates((prev) => buildRates(prev, cryptoPrices, manualRateSpecs));
  }, [cryptoPrices]);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (Date.now() - lastFetchAt.current < COOLDOWN_SECS * 1000) return false;
    try {
      const fiat = await fetchFiatRates(getFiatSymbols());
      const built = buildRates(fiat, cryptoPrices, manualRateSpecs);
      saveRates(built);
      beginCooldown(Date.now());
      return true;
    } catch {
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cryptoPrices, manualRateSpecs]);

  const setManualRateSpec = useCallback(
    (code: string, spec: ManualExchangeRateSpec | null) => {
      const normalizedCode = code.trim().toUpperCase();
      if (!normalizedCode || normalizedCode === "JPY") return;
      setManualRateSpecs((prev) => {
        const next = { ...prev };
        if (spec && spec.rate > 0 && spec.base) {
          next[normalizedCode] = {
            base: normalizeCurrencyCode(spec.base),
            rate: spec.rate,
          };
        } else {
          delete next[normalizedCode];
        }
        const saved = writeManualExchangeRateSpecs(next);
        setRates((current) => {
          const rebuilt = buildRates(current, cryptoPrices, saved);
          if (!(normalizedCode in saved)) delete rebuilt[normalizedCode];
          rebuilt.JPY = 1;
          return rebuilt;
        });
        return saved;
      });
    },
    [cryptoPrices],
  );

  const convert = useCallback(
    (amount: number, from: string, to: string): number => {
      if (from === to) return amount;
      const fromRate = from === "JPY" ? 1 : (rates[from] ?? 0);
      const toRate = to === "JPY" ? 1 : (rates[to] ?? 0);
      if (fromRate === 0 || toRate === 0) return 0;
      return (amount * fromRate) / toRate;
    },
    [rates],
  );

  const forceRefresh = useCallback(async (): Promise<void> => {
    try {
      localStorage.removeItem(LS_RATES_KEY);
      localStorage.setItem(LS_LAST_FETCH_KEY, "0");
    } catch {}
    lastFetchAt.current = 0;
    try {
      const fiat = await fetchFiatRates(getFiatSymbols());
      const built = buildRates(fiat, cryptoPrices, manualRateSpecs);
      saveRates(built);
      beginCooldown(Date.now());
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cryptoPrices, manualRateSpecs]);

  const resetStoredRates = useCallback(() => {
    clearManualExchangeRates();
    setManualRateSpecs({});
    try {
      localStorage.removeItem(LS_RATES_KEY);
      localStorage.removeItem(LS_LAST_FETCH_KEY);
      localStorage.removeItem(LS_EXTRA_FIAT_CODES_KEY);
    } catch {}
    lastFetchAt.current = 0;
    if (tickerRef.current) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
    setCooldownRemaining(0);
    setRates(buildRates(FALLBACK_JPY_PIVOT, cryptoPrices, {}));
  }, [cryptoPrices]);

  const ensureRatesForCurrencies = useCallback(
    async (codes: string[]) => {
      const wanted = new Set<string>();
      for (const raw of codes) {
        const code = normalizeCurrencyCode(raw);
        if (!code || code === "JPY") continue;
        if (!isFiatCodeCandidate(code)) continue;
        // Avoid hitting fiat providers for crypto tickers and obvious non-fiat codes.
        if (CRYPTO_CODE_SET.has(code)) continue;
        if (cryptoPrices?.byTicker && code in cryptoPrices.byTicker) continue;
        wanted.add(code);
      }

      const missing: string[] = [];
      for (const code of wanted) {
        if ((ratesRef.current[code] ?? 0) <= 0) missing.push(code);
      }
      if (missing.length === 0) return;

      // Persist requested extra codes so future refreshes include them.
      const currentExtra = new Set(readExtraFiatCodes());
      for (const code of missing) currentExtra.add(code);
      writeExtraFiatCodes(currentExtra);

      // If we fetched recently, don't spam the API while missing. Allow a short 30s window.
      if (Date.now() - lastFetchAt.current < MISSING_FIAT_COOLDOWN_SECS * 1000) {
        return;
      }

      try {
        const fiat = await fetchFiatRates(getFiatSymbols([...currentExtra]));
        const built = buildRates(fiat, cryptoPrices, manualRateSpecs);
        saveRates(built);
        beginCooldown(Date.now());
      } catch {
        // ignore
      }
    },
    [cryptoPrices, manualRateSpecs],
  );

  return {
    rates,
    cooldownRemaining,
    refresh,
    forceRefresh,
    manualRateSpecs,
    setManualRateSpec,
    resetStoredRates,
    ensureRatesForCurrencies,
    convert,
  };
}
