import { memo, type CSSProperties } from "react";
import type { CryptoIconStyle } from "../lib/cryptoCurrencyIcons";
import {
  getCurrencyBadgeText,
  getDefaultCurrencyBadgeSymbol,
  getReadableTextColor,
  isCryptoCurrencyIconCode,
  normalizeCurrencyBackgroundColor,
} from "../lib/currencyIconDisplay";
import { CryptoCurrencyIcon } from "./CryptoCurrencyIcon";
import { CustomCurrencyIcon } from "./CustomCurrencyIcon";

interface CurrencyOptionIconProps {
  backgroundColor?: string | null;
  code: string;
  cryptoIconStyle: CryptoIconStyle;
  customIcon?: string | null;
  size?: number;
  symbol?: string | null;
}

function fontSizeForBadge(text: string, size: number): number {
  if (text.length <= 1) return Math.max(11, Math.round(size * 0.58));
  if (text.length === 2) return Math.max(9, Math.round(size * 0.48));
  return Math.max(8, Math.round(size * 0.36));
}

function CurrencyOptionIconComponent({
  backgroundColor,
  code,
  cryptoIconStyle,
  customIcon,
  size = 22,
  symbol,
}: CurrencyOptionIconProps) {
  const normalizedCode = code.trim().toUpperCase();

  if (isCryptoCurrencyIconCode(normalizedCode)) {
    return (
      <CryptoCurrencyIcon
        code={normalizedCode}
        styleMode={cryptoIconStyle}
        size={size}
      />
    );
  }

  if (customIcon && !getDefaultCurrencyBadgeSymbol(normalizedCode)) {
    return (
      <CustomCurrencyIcon
        backgroundColor={backgroundColor}
        icon={customIcon}
        size={size}
      />
    );
  }

  const normalizedBackground = normalizeCurrencyBackgroundColor(backgroundColor);
  const text = getCurrencyBadgeText(
    normalizedCode,
    symbol ?? getDefaultCurrencyBadgeSymbol(normalizedCode),
  );
  const style: CSSProperties = {
    alignItems: "center",
    background:
      normalizedBackground ??
      "light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))",
    border: normalizedBackground
      ? "1px solid rgba(255, 255, 255, 0.28)"
      : "1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))",
    borderRadius: 999,
    color: normalizedBackground
      ? getReadableTextColor(normalizedBackground)
      : "light-dark(var(--mantine-color-gray-8), var(--mantine-color-gray-1))",
    display: "inline-flex",
    flexShrink: 0,
    fontFamily: "var(--mantine-font-family-monospace)",
    fontSize: fontSizeForBadge(text, size),
    fontWeight: 700,
    height: size,
    justifyContent: "center",
    lineHeight: 1,
    width: size,
  };

  return (
    <span aria-hidden="true" style={style}>
      {text}
    </span>
  );
}

export const CurrencyOptionIcon = memo(CurrencyOptionIconComponent);
