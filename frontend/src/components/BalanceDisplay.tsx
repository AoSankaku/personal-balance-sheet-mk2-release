import { Box, Text, type MantineSize } from "@mantine/core";
import { useLang } from "../i18n";
import { formatCurrency, CRYPTO_DECIMALS } from "../lib/numberFormat";
import { toIntlLocale } from "../i18n";
import { isPrivacyModeEnabled } from "../lib/privacy";

interface BalanceDisplayProps {
  amount: number;
  currency: string;
  displaySymbol?: string;
  fw?: number;
  c?: string;
  size?: MantineSize;
}

/** Responsive balance display that prevents horizontal overflow:
 *  - 3+ char currency units (crypto tickers) → ticker wraps to next line on narrow screens
 *  - 1-2 char units (¥, $, etc.) uses clamp() responsive font sizing with 2.5rem minimum */
export function BalanceDisplay({
  amount,
  currency,
  displaySymbol,
  fw,
  c,
  size,
}: BalanceDisplayProps) {
  const { locale } = useLang();
  const symbol = displaySymbol ?? "";
  const displayUnit = symbol || currency;
  const isLongUnit = displayUnit.trim().length >= 3;

  const heroFont = "clamp(2.5rem, 8vw, 2.5rem)";

  if (isPrivacyModeEnabled()) {
    const formatted = formatCurrency(amount, locale, currency, displaySymbol);
    return (
      <Text
        component="span"
        fw={fw}
        c={c}
        size={size}
        style={{
          fontSize: size == null ? heroFont : undefined,
          lineHeight: 1,
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {formatted}
      </Text>
    );
  }

  if (isLongUnit) {
    const decimals = CRYPTO_DECIMALS[currency] ?? 2;
    const intlLocale = toIntlLocale(locale);
    const numeric = amount.toLocaleString(intlLocale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    });
    return (
      <Box
        component="span"
        style={{
          display: "inline-flex",
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "baseline",
          columnGap: "0.3em",
          lineHeight: 1,
        }}
      >
        <Text component="span" fw={fw} c={c} size={size} style={{ fontSize: size == null ? heroFont : undefined, whiteSpace: "nowrap" }}>
          {numeric}
        </Text>
        <Text component="span" fw={fw} c={c} size={size} style={{ fontSize: size == null ? heroFont : undefined, whiteSpace: "nowrap" }}>
          {displayUnit.trim()}
        </Text>
      </Box>
    );
  }

  const formatted = formatCurrency(amount, locale, currency, displaySymbol);
  return (
    <Text
      component="span"
      fw={fw}
      c={c}
      size={size}
      style={{
        fontSize: size == null ? heroFont : undefined,
        lineHeight: 1,
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {formatted}
    </Text>
  );
}
