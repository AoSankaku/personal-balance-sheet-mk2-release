import { describe, expect, it } from "bun:test";
import {
  balanceMapAmountForDisplayMode,
  balanceMapAmountInCurrency,
  lineAmountForDisplayMode,
  lineAmountInCurrency,
  type ConvertCurrency,
} from "../src/lib/displayCurrencyAmounts";

describe("display currency amount helpers", () => {
  const convertCurrency: ConvertCurrency = (amount, from, to) => {
    if (from === to) return amount;
    if (from === "USD" && to === "YMD") return amount * 150;
    if (from === "JPY" && to === "YMD") return amount / 2;
    return 0;
  };

  it("keeps same-currency balance maps as-is", () => {
    expect(
      balanceMapAmountInCurrency({ YMD: 196_000 }, "YMD", convertCurrency),
    ).toBe(196_000);
  });

  it("converts mixed balance maps per source currency before summing", () => {
    expect(
      balanceMapAmountInCurrency(
        { YMD: 5, USD: 10, JPY: 200 },
        "YMD",
        convertCurrency,
      ),
    ).toBe(1_605);
  });

  it("keeps same-currency journal line amounts as-is", () => {
    expect(lineAmountInCurrency(12_000, "YMD", "YMD", convertCurrency)).toBe(
      12_000,
    );
  });

  it("selects only the target currency when all-currency mode is off", () => {
    expect(
      balanceMapAmountForDisplayMode(
        { YMD: 5, USD: 10, JPY: 200 },
        "YMD",
        convertCurrency,
        false,
      ),
    ).toBe(5);
  });

  it("includes converted currencies when all-currency mode is on", () => {
    expect(
      balanceMapAmountForDisplayMode(
        { YMD: 5, USD: 10, JPY: 200 },
        "YMD",
        convertCurrency,
        true,
      ),
    ).toBe(1_605);
  });

  it("drops non-target journal lines when all-currency mode is off", () => {
    expect(
      lineAmountForDisplayMode(10, "USD", "YMD", convertCurrency, false),
    ).toBe(0);
    expect(
      lineAmountForDisplayMode(10, "YMD", "YMD", convertCurrency, false),
    ).toBe(10);
  });
});
