import { describe, expect, test } from "bun:test";
import {
  findInvalidMoneyField,
  fromStorageMoneyAmount,
  invalidMoneyResponse,
  moneyScale,
  rescaleStorageMoneyAmount,
  toStorageMoneyAmount,
} from "../src/lib/moneyValidation";

describe("money validation", () => {
  test("accepts integer money values and absent optional fields", () => {
    expect(
      findInvalidMoneyField([
        { path: "amount", value: 1000 },
        { path: "negative", value: -250 },
        { path: "zero", value: 0 },
        { path: "missing", value: undefined },
        { path: "nullable", value: null, nullable: true },
      ]),
    ).toBeNull();
  });

  test("returns the first non-integer money field", () => {
    expect(
      findInvalidMoneyField([
        { path: "lines[0].debit", value: 1000, currency: "JPY" },
        { path: "lines[0].credit", value: 1.25, currency: "JPY" },
        { path: "lines[1].debit", value: "2000" },
      ]),
    ).toBe("lines[0].credit");
  });

  test("encodes and decodes decimal currencies as minor-unit integers", () => {
    expect(toStorageMoneyAmount(12.34, "USD")).toBe(1234);
    expect(fromStorageMoneyAmount(1234, "USD")).toBe(12.34);
    expect(toStorageMoneyAmount(0.00000001, "BTC")).toBe(1);
    expect(fromStorageMoneyAmount(1, "BTC")).toBe(0.00000001);
  });

  test("uses ISO minor units for broad fiat currency coverage", () => {
    expect(moneyScale("KWD")).toBe(3);
    expect(moneyScale("VND")).toBe(0);
    expect(toStorageMoneyAmount(1.234, "KWD")).toBe(1234);
    expect(findInvalidMoneyField([{ path: "vnd", value: 1.2, currency: "VND" }])).toBe(
      "vnd",
    );
  });

  test("supports configured precision for custom currencies", () => {
    const scaleOptions = { decimalPlacesByCurrency: { POINTS: 4 } };

    expect(moneyScale("POINTS", scaleOptions)).toBe(4);
    expect(toStorageMoneyAmount(1.2345, "POINTS", scaleOptions)).toBe(12345);
    expect(
      findInvalidMoneyField([
        {
          path: "points",
          value: 1.23456,
          currency: "POINTS",
          decimalPlaces: 4,
        },
      ]),
    ).toBe("points");
  });

  test("rescales stored minor-unit values when currency precision changes", () => {
    expect(rescaleStorageMoneyAmount(1200, "USD", "JPY")).toBe(12);
    expect(rescaleStorageMoneyAmount(12, "JPY", "USD")).toBe(1200);
  });

  test("rejects values with more precision than the currency supports", () => {
    expect(
      findInvalidMoneyField([
        { path: "usd", value: 12.345, currency: "USD" },
      ]),
    ).toBe("usd");
    expect(
      findInvalidMoneyField([
        { path: "btc", value: 0.000000001, currency: "BTC" },
      ]),
    ).toBe("btc");
  });

  test("rejects non-finite, string, and non-nullable null values", () => {
    expect(findInvalidMoneyField([{ path: "amount", value: Infinity }])).toBe(
      "amount",
    );
    expect(findInvalidMoneyField([{ path: "amount", value: "100" }])).toBe(
      "amount",
    );
    expect(findInvalidMoneyField([{ path: "amount", value: null }])).toBe(
      "amount",
    );
  });

  test("builds a stable 400 response body", () => {
    expect(invalidMoneyResponse("amount", "USD")).toEqual({
      error: "invalid_money_amount",
      field: "amount",
      currency: "USD",
      message: "amount must be a valid USD amount",
    });
  });
});
