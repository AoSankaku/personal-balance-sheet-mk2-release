import type { EnabledCurrency } from "@balance-sheet/shared";

const FALLBACK_DECIMALS: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  BTC: 8,
  ETH: 8,
  BNB: 8,
  SOL: 9,
  SKR: 9,
  USDT: 6,
  USDC: 6,
};

export function balanceReconciliationTolerance(
  currency: string | null | undefined,
  enabledCurrencies: EnabledCurrency[],
): number {
  const code = (currency || "JPY").toUpperCase();
  const configured = enabledCurrencies.find((item) => item.code === code);
  const decimalPlaces =
    configured?.decimal_places ?? FALLBACK_DECIMALS[code] ?? 2;
  return 0.5 * 10 ** -decimalPlaces;
}

export function hasMaterialBalanceDifference(
  difference: number,
  currency: string | null | undefined,
  enabledCurrencies: EnabledCurrency[],
): boolean {
  return (
    Math.abs(difference) >=
    balanceReconciliationTolerance(currency, enabledCurrencies)
  );
}
