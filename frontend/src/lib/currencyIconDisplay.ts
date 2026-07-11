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

export function normalizeCurrencyBackgroundColor(
  color: string | null | undefined,
): string | undefined {
  const trimmed = color?.trim();
  if (!trimmed || !/^#[0-9a-fA-F]{6}$/.test(trimmed)) return undefined;
  return trimmed.toUpperCase();
}

export function getReadableTextColor(backgroundColor: string): "#111827" | "#FFFFFF" {
  const normalized = normalizeCurrencyBackgroundColor(backgroundColor);
  if (!normalized) return "#111827";

  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.62 ? "#111827" : "#FFFFFF";
}
