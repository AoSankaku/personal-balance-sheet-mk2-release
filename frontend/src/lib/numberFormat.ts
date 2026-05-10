export function formatJPY(amount: number, locale: string): string {
  return new Intl.NumberFormat(locale === "ja" ? "ja-JP" : "en-US", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(amount);
}

// Crypto currencies not supported natively by Intl.NumberFormat
const CRYPTO_DECIMALS: Record<string, number> = {
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
  const intlLocale = locale === "ja" ? "ja-JP" : "en-US";
  const cryptoDecimals = CRYPTO_DECIMALS[currency];
  if (cryptoDecimals !== undefined) {
    return (
      amount.toLocaleString(intlLocale, {
        minimumFractionDigits: 0,
        maximumFractionDigits: cryptoDecimals,
      }) +
      "\u00a0" +
      currency
    );
  }
  if (displaySymbol && displaySymbol !== getCurrencySymbol(currency)) {
    return (
      displaySymbol +
      "\u00a0" +
      amount.toLocaleString(intlLocale, {
        minimumFractionDigits: 0,
        maximumFractionDigits: currency === "JPY" || currency === "KRW" ? 0 : 2,
      })
    );
  }
  try {
    return new Intl.NumberFormat(intlLocale, {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "JPY" || currency === "KRW" ? 0 : 2,
    }).format(amount);
  } catch {
    return amount.toFixed(2) + "\u00a0" + currency;
  }
}
