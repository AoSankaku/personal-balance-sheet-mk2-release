import { describe, expect, test } from "bun:test";

import { parseManualExchangeRate } from "../src/lib/manualExchangeRates";

describe("manual exchange rates", () => {
  test("accepts positive finite JPY rates", () => {
    expect(parseManualExchangeRate(123.45)).toBe(123.45);
  });

  test("rejects missing, zero, negative, and non-finite rates", () => {
    expect(parseManualExchangeRate(undefined)).toBeNull();
    expect(parseManualExchangeRate(0)).toBeNull();
    expect(parseManualExchangeRate(-1)).toBeNull();
    expect(parseManualExchangeRate(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
