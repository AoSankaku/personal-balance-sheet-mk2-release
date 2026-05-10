import { useCallback, useEffect, useRef, useState } from "react";
import type { CryptoPrices } from "@balance-sheet/shared";

export const LS_CRYPTO_PROVIDER_KEY = "crypto_price_provider";
export type CryptoProvider = "coingecko" | "coinpaprika";

export function getCryptoProvider(): CryptoProvider {
  try {
    const val = localStorage.getItem(LS_CRYPTO_PROVIDER_KEY);
    return val === "coinpaprika" ? "coinpaprika" : "coingecko";
  } catch {
    return "coingecko";
  }
}

// ── CoinGecko ──────────────────────────────────────────────────────────────
const TICKER_TO_COINGECKO: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  SKR: "seeker",
  BNB: "binancecoin",
  USDT: "tether",
  USDC: "usd-coin",
};
const COINGECKO_IDS = Object.values(TICKER_TO_COINGECKO).join(",");
const COINGECKO_URL = `https://api.coingecko.com/api/v3/simple/price?ids=${COINGECKO_IDS}&vs_currencies=jpy`;

async function fetchCoinGecko(): Promise<CryptoPrices> {
  const res = await fetch(COINGECKO_URL);
  if (!res.ok) throw new Error("CoinGecko fetch failed");
  const data = (await res.json()) as Record<string, { jpy: number }>;
  const byTicker: Record<string, number> = {};
  for (const [ticker, id] of Object.entries(TICKER_TO_COINGECKO)) {
    if (data[id]?.jpy != null) byTicker[ticker] = data[id]!.jpy;
  }
  return {
    bitcoin: data.bitcoin?.jpy ?? 0,
    ethereum: data.ethereum?.jpy ?? 0,
    solana: data.solana?.jpy ?? 0,
    skr: data.seeker?.jpy ?? null,
    bnb: data.binancecoin?.jpy ?? null,
    byTicker,
  };
}

// ── CoinPaprika ────────────────────────────────────────────────────────────
const TICKER_TO_COINPAPRIKA: Record<string, string> = {
  BTC: "btc-bitcoin",
  ETH: "eth-ethereum",
  SOL: "sol-solana",
  SKR: "skr-seeker",
  BNB: "bnb-binance-coin",
  USDT: "usdt-tether",
  USDC: "usdc-usd-coin",
};

async function fetchCoinPaprika(): Promise<CryptoPrices> {
  const entries = Object.entries(TICKER_TO_COINPAPRIKA);
  const results = await Promise.allSettled(
    entries.map(async ([, id]) => {
      const res = await fetch(
        `https://api.coinpaprika.com/v1/tickers/${id}?quotes=JPY`,
      );
      if (!res.ok) throw new Error(`${id} not found`);
      const data = (await res.json()) as {
        quotes?: { JPY?: { price?: number } };
      };
      return data.quotes?.JPY?.price ?? null;
    }),
  );
  const byTicker: Record<string, number> = {};
  for (const [i, result] of results.entries()) {
    const ticker = entries[i][0];
    if (result.status === "fulfilled" && result.value != null) {
      byTicker[ticker] = result.value;
    }
  }
  return {
    bitcoin: byTicker.BTC ?? 0,
    ethereum: byTicker.ETH ?? 0,
    solana: byTicker.SOL ?? 0,
    skr: byTicker.SKR ?? null,
    bnb: byTicker.BNB ?? null,
    byTicker,
  };
}

// ── Dispatcher ────────────────────────────────────────────────────────────
const COOLDOWN_SECS = 60;
const LS_LAST_FETCH_KEY = "crypto_prices_last_fetch_at";
const LS_PRICES_KEY = "crypto_prices_cache";

async function doFetch(): Promise<CryptoPrices> {
  return getCryptoProvider() === "coinpaprika"
    ? fetchCoinPaprika()
    : fetchCoinGecko();
}

export interface UseCryptoPricesResult {
  prices: CryptoPrices | null;
  /** Manually refresh prices. Returns false if still on cooldown. */
  refresh: () => Promise<boolean>;
  /** Force refresh bypassing cooldown (use when switching provider). */
  forceRefresh: () => Promise<void>;
  /** Seconds remaining in the 1-minute cooldown (0 = ready to refresh) */
  cooldownRemaining: number;
}

function readCachedLastFetchAt(): number {
  try {
    return parseInt(localStorage.getItem(LS_LAST_FETCH_KEY) ?? "0", 10) || 0;
  } catch {
    return 0;
  }
}

function readCachedPrices(): CryptoPrices | null {
  try {
    const raw = localStorage.getItem(LS_PRICES_KEY);
    return raw ? (JSON.parse(raw) as CryptoPrices) : null;
  } catch {
    return null;
  }
}

export function useCryptoPrices(): UseCryptoPricesResult {
  const [prices, setPrices] = useState<CryptoPrices | null>(() =>
    readCachedPrices(),
  );
  const [cooldownRemaining, setCooldownRemaining] = useState(() => {
    const elapsed = Math.floor((Date.now() - readCachedLastFetchAt()) / 1000);
    return Math.max(0, COOLDOWN_SECS - elapsed);
  });

  // Refs so beginCooldown / refresh don't need to re-create on every render
  const lastFetchAt = useRef(readCachedLastFetchAt());
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
      const remaining = Math.max(
        0,
        COOLDOWN_SECS - Math.floor((Date.now() - lastFetchAt.current) / 1000),
      );
      setCooldownRemaining(remaining);
      if (remaining === 0 && tickerRef.current) {
        clearInterval(tickerRef.current);
        tickerRef.current = null;
      }
    }, 1000);
  }

  function savePrices(p: CryptoPrices) {
    setPrices(p);
    try {
      localStorage.setItem(LS_PRICES_KEY, JSON.stringify(p));
    } catch {}
  }

  // On mount: start cooldown ticker if still cooling down; fetch if expired
  useEffect(() => {
    const cachedAt = readCachedLastFetchAt();
    const elapsed = Date.now() - cachedAt;
    if (elapsed < COOLDOWN_SECS * 1000) {
      // Still within cooldown — just resume the ticker
      beginCooldown(cachedAt);
      return () => {
        if (tickerRef.current) clearInterval(tickerRef.current);
      };
    }

    // Cooldown expired — fetch fresh prices
    let alive = true;
    doFetch()
      .then((p) => {
        if (!alive) return;
        savePrices(p);
        beginCooldown(Date.now());
      })
      .catch(() => {}); // silently ignore network errors

    return () => {
      alive = false;
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (Date.now() - lastFetchAt.current < COOLDOWN_SECS * 1000) return false;
    try {
      const p = await doFetch();
      savePrices(p);
      beginCooldown(Date.now());
      return true;
    } catch {
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const forceRefresh = useCallback(async (): Promise<void> => {
    try {
      localStorage.removeItem(LS_PRICES_KEY);
      localStorage.setItem(LS_LAST_FETCH_KEY, "0");
    } catch {}
    lastFetchAt.current = 0;
    try {
      const p = await doFetch();
      savePrices(p);
      beginCooldown(Date.now());
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { prices, refresh, forceRefresh, cooldownRemaining };
}
