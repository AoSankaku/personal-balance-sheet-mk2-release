import { toIntlLocale } from "../i18n";
import { isPrivacyModeEnabled, maskFormattedAmountDigits } from "./privacy";

export function formatJPY(amount: number, locale: string): string {
  const formatted = new Intl.NumberFormat(toIntlLocale(locale), {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(amount);
  return isPrivacyModeEnabled()
    ? maskFormattedAmountDigits(formatted)
    : formatted;
}

// Crypto currencies not supported natively by Intl.NumberFormat
export const CRYPTO_DECIMALS: Record<string, number> = {
  BTC: 8,
  ETH: 6,
  BNB: 4,
  SOL: 4,
  SKR: 4,
  USDT: 2,
  USDC: 2,
};

/** Returns the short currency symbol for use as a NumberInput prefix (e.g. "¥", "$", "€"). */
export function getCurrencySymbol(currency: string): string {
  if (CRYPTO_DECIMALS[currency] !== undefined) return currency + " ";
  try {
    const parts = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

/** Format an amount in any currency (fiat or crypto). */
export function formatCurrency(
  amount: number,
  locale: string,
  currency: string,
  displaySymbol?: string,
): string {
  const intlLocale = toIntlLocale(locale);
  const cryptoDecimals = CRYPTO_DECIMALS[currency];
  let formatted: string;
  if (cryptoDecimals !== undefined) {
    formatted =
      amount.toLocaleString(intlLocale, {
        minimumFractionDigits: 0,
        maximumFractionDigits: cryptoDecimals,
      }) +
      "\u00a0" +
      currency;
    return isPrivacyModeEnabled()
      ? maskFormattedAmountDigits(formatted)
      : formatted;
  }
  if (displaySymbol && displaySymbol !== getCurrencySymbol(currency)) {
    formatted =
      displaySymbol +
      "\u00a0" +
      amount.toLocaleString(intlLocale, {
        minimumFractionDigits: 0,
        maximumFractionDigits: currency === "JPY" || currency === "KRW" ? 0 : 2,
      });
    return isPrivacyModeEnabled()
      ? maskFormattedAmountDigits(formatted)
      : formatted;
  }
  try {
    formatted = new Intl.NumberFormat(intlLocale, {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "JPY" || currency === "KRW" ? 0 : 2,
    }).format(amount);
  } catch {
    formatted = amount.toFixed(2) + "\u00a0" + currency;
  }
  return isPrivacyModeEnabled()
    ? maskFormattedAmountDigits(formatted)
    : formatted;
}
