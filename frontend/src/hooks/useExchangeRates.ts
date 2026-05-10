import { useCallback, useEffect, useRef, useState } from "react";
import type { CryptoPrices, ExchangeRates } from "@balance-sheet/shared";
import { FALLBACK_JPY_PIVOT } from "../utils/fallbackRates2025";
import {
  readManualExchangeRates,
  writeManualExchangeRates,
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
const LS_RATES_KEY = "exchange_rates_cache";
const LS_LAST_FETCH_KEY = "exchange_rates_last_fetch_at";

// Both Frankfurter and ExchangeRate-API return rates as "1 JPY = X currency"
// when base=JPY. We invert to get "1 currency = X JPY".
const FIAT_CODES = [
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

const FIAT_SYMBOLS = FIAT_CODES.join(",");

function invertRates(raw: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [code, ratePerJpy] of Object.entries(raw)) {
    if (ratePerJpy > 0) result[code] = 1 / ratePerJpy;
  }
  return result;
}

async function fetchFrankfurter(): Promise<Record<string, number>> {
  const url = `https://api.frankfurter.app/latest?base=JPY&symbols=${FIAT_SYMBOLS}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Frankfurter fetch failed");
  const data = (await res.json()) as { rates: Record<string, number> };
  return invertRates(data.rates);
}

async function fetchErApi(): Promise<Record<string, number>> {
  const res = await fetch("https://open.er-api.com/v6/latest/JPY");
  if (!res.ok) throw new Error("ExchangeRate-API fetch failed");
  const data = (await res.json()) as { rates: Record<string, number> };
  return invertRates(data.rates);
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

async function fetchFiatRates(): Promise<Record<string, number>> {
  const provider = getFiatProvider();
  const primary = provider === "er_api" ? fetchErApi : fetchFrankfurter;
  const fallback = provider === "er_api" ? fetchFrankfurter : fetchErApi;
  try {
    return await primary();
  } catch {
    return fallback();
  }
}

/** Build exchange rates from fiat API response + crypto prices */
function buildRates(
  fiat: Record<string, number>,
  crypto: CryptoPrices | null,
  manual: ExchangeRates = readManualExchangeRates(),
): ExchangeRates {
  // Fallback is the base layer; live fiat data overwrites it where available.
  const rates: ExchangeRates = { ...FALLBACK_JPY_PIVOT, ...fiat, JPY: 1 };
  if (crypto?.byTicker) {
    for (const [ticker, jpy] of Object.entries(crypto.byTicker)) {
      if (jpy != null && jpy > 0) rates[ticker] = jpy;
    }
  }
  for (const [code, rate] of Object.entries(manual)) {
    if (rate > 0) rates[code] = rate;
  }
  rates.JPY = 1;
  return rates;
}

function hasCompleteFiatRates(rates: ExchangeRates | null): boolean {
  if (!rates) return false;
  return FIAT_CODES.every((code) => (rates[code] ?? 0) > 0);
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
  /** Manual rates as: 1 unit of currency = X JPY. */
  manualRates: ExchangeRates;
  /** Save or clear one manual rate and immediately refresh conversions. */
  setManualRate: (code: string, rate: number | null) => void;
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
  const [manualRates, setManualRates] = useState<ExchangeRates>(
    readManualExchangeRates,
  );
  const [cooldownRemaining, setCooldownRemaining] = useState(() => {
    const elapsed = Math.floor((Date.now() - readCachedLastFetch()) / 1000);
    return Math.max(0, COOLDOWN_SECS - elapsed);
  });

  const lastFetchAt = useRef(readCachedLastFetch());
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    if (elapsed < COOLDOWN_SECS * 1000 && hasCompleteFiatRates(cached)) {
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
    fetchFiatRates()
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
    setRates((prev) => buildRates(prev, cryptoPrices, manualRates));
  }, [cryptoPrices]);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (Date.now() - lastFetchAt.current < COOLDOWN_SECS * 1000) return false;
    try {
      const fiat = await fetchFiatRates();
      const built = buildRates(fiat, cryptoPrices, manualRates);
      saveRates(built);
      beginCooldown(Date.now());
      return true;
    } catch {
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cryptoPrices, manualRates]);

  const setManualRate = useCallback(
    (code: string, rate: number | null) => {
      const normalizedCode = code.trim().toUpperCase();
      if (!normalizedCode || normalizedCode === "JPY") return;
      setManualRates((prev) => {
        const next = { ...prev };
        if (rate !== null && Number.isFinite(rate) && rate > 0) {
          next[normalizedCode] = rate;
        } else {
          delete next[normalizedCode];
        }
        const saved = writeManualExchangeRates(next);
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
      const fiat = await fetchFiatRates();
      const built = buildRates(fiat, cryptoPrices, manualRates);
      saveRates(built);
      beginCooldown(Date.now());
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cryptoPrices, manualRates]);

  return {
    rates,
    cooldownRemaining,
    refresh,
    forceRefresh,
    manualRates,
    setManualRate,
    convert,
  };
}
