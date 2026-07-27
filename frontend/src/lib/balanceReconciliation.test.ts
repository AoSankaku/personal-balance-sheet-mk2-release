import { describe, expect, it } from "bun:test";
import type { EnabledCurrency } from "@balance-sheet/shared";
import {
  balanceReconciliationTolerance,
  hasMaterialBalanceDifference,
} from "./balanceReconciliation";

function currency(code: string, decimalPlaces: number): EnabledCurrency {
  return {
    id: 1,
    code,
    sort_order: 0,
    symbol_priority: 0,
    custom_symbol: null,
    custom_icon: null,
    background_color: null,
    decimal_places: decimalPlaces,
  };
}

describe("balance reconciliation precision", () => {
  const currencies = [currency("JPY", 0), currency("BTC", 8)];

  it("uses half of the smallest configured unit as the tolerance", () => {
    expect(balanceReconciliationTolerance("JPY", currencies)).toBe(0.5);
    expect(balanceReconciliationTolerance("BTC", currencies)).toBe(0.000000005);
  });

  it("treats fractional crypto differences as material", () => {
    expect(hasMaterialBalanceDifference(0.1, "BTC", currencies)).toBe(true);
  });

  it("ignores sub-unit rounding noise", () => {
    expect(hasMaterialBalanceDifference(0.4, "JPY", currencies)).toBe(false);
    expect(
      hasMaterialBalanceDifference(0.000000001, "BTC", currencies),
    ).toBe(false);
  });
});
