import { describe, expect, test } from "bun:test";
import { formatCurrency, parseCurrencyInputValue } from "./numberFormat";

describe("formatCurrency configured precision", () => {
  test("uses enabled-currency precision when supplied", () => {
    expect(formatCurrency(0.00001234, "en", "BTC", undefined, 8)).toContain(
      "0.00001234",
    );
    expect(formatCurrency(1.25, "en", "JPY", undefined, 2)).toContain("1.25");
  });

  test("keeps the usual currency precision when no override is supplied", () => {
    expect(formatCurrency(1.25, "en", "JPY")).not.toContain("1.25");
  });

  test("parses entered amounts with fiat and crypto prefixes", () => {
    expect(parseCurrencyInputValue("¥ 3", "¥")).toBe(3);
    expect(parseCurrencyInputValue("$ 2.50", "$ ")).toBe(2.5);
    expect(parseCurrencyInputValue("BTC 0.00001234", "BTC ")).toBe(0.00001234);
  });
});
