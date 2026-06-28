import { CURRENCY_SYMBOLS } from "./currencyUtils";

const CRYPTO_CURRENCY_ICON_CODES = new Set([
  "BTC",
  "ETH",
  "SOL",
  "SKR",
  "BNB",
  "USDT",
  "USDC",
  "XRP",
  "ADA",
  "DOGE",
  "AVAX",
  "DOT",
  "LINK",
  "LTC",
  "ATOM",
]);

export function isCryptoCurrencyIconCode(code: string): boolean {
  return CRYPTO_CURRENCY_ICON_CODES.has(code.trim().toUpperCase());
}

export function getCurrencyBadgeText(
  code: string,
  symbol: string | null | undefined,
): string {
  const normalizedCode = code.trim().toUpperCase();
  const normalizedSymbol = symbol?.trim();

  if (normalizedSymbol && normalizedSymbol.length <= 3) {
    return normalizedSymbol;
  }

  if (normalizedCode.length <= 3) {
    return normalizedCode;
  }

  return normalizedCode.slice(0, 1);
}

export function getDefaultCurrencyBadgeSymbol(code: string): string | undefined {
  return CURRENCY_SYMBOLS[code.trim().toUpperCase()];
}
