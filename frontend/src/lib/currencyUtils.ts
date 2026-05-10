import type { EnabledCurrency } from "@balance-sheet/shared";
import { fallbackSymbolForCustomCurrencyIcon } from "./customCurrencySymbols";

export const CURRENCY_SYMBOLS: Record<string, string> = {
  JPY: "¥",
  USD: "$",
  EUR: "€",
  GBP: "£",
  AUD: "A$",
  CAD: "C$",
  CHF: "Fr.",
  CNY: "¥",
  HKD: "HK$",
  KRW: "₩",
  SGD: "S$",
  THB: "฿",
  IDR: "Rp",
  MYR: "RM",
  PHP: "₱",
  INR: "₹",
  SEK: "kr",
  NOK: "kr",
  DKK: "kr",
  NZD: "NZ$",
  MXN: "Mex$",
  BRL: "R$",
  ZAR: "R",
  TRY: "₺",
  PLN: "zł",
  CZK: "Kč",
  HUF: "Ft",
  BTC: "₿",
  ETH: "Ξ",
  SOL: "◎",
  USDT: "₮",
  ADA: "₳",
  DOGE: "Ð",
  LTC: "Ł",
};

function getRawSymbol(
  code: string,
  currencies: EnabledCurrency[],
): string | undefined {
  const rec = currencies.find((c) => c.code === code);
  return (
    rec?.custom_symbol ||
    (rec?.custom_icon ? fallbackSymbolForCustomCurrencyIcon(rec.custom_icon) : undefined) ||
    CURRENCY_SYMBOLS[code]
  );
}

/** Returns the effective display symbol for a currency, respecting custom_symbol overrides and conflict resolution. */
export function getEffectiveSymbol(
  code: string,
  enabledCurrencies: EnabledCurrency[],
): string {
  const raw = getRawSymbol(code, enabledCurrencies);
  if (!raw) return code;
  const sharing = enabledCurrencies.filter(
    (c) => getRawSymbol(c.code, enabledCurrencies) === raw,
  );
  if (sharing.length <= 1) return raw;
  const winner = [...sharing].sort(
    (a, b) =>
      b.symbol_priority - a.symbol_priority || a.sort_order - b.sort_order,
  )[0];
  return winner.code === code ? raw : code;
}
