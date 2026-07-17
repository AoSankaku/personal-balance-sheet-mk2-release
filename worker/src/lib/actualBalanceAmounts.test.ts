import { describe, expect, it } from "bun:test";
import {
  decodeActualBalanceAmount,
  prepareActualBalanceEntry,
} from "./actualBalanceAmounts";

describe("actual balance amount storage", () => {
  it("stores fractional BTC quantities as scaled integers", () => {
    expect(
      prepareActualBalanceEntry(7, {
        account_id: 3,
        amount: 0.12345678,
        currency: "btc",
      }),
    ).toEqual({
      snapshot_id: 7,
      account_id: 3,
      amount: 12_345_678,
      currency: "BTC",
    });
  });

  it("keeps zero-decimal JPY amounts unchanged", () => {
    expect(
      prepareActualBalanceEntry(7, {
        account_id: 3,
        amount: 1200,
        currency: "JPY",
      }).amount,
    ).toBe(1200);
  });

  it("decodes stored quantities using the entry currency", () => {
    expect(decodeActualBalanceAmount(12_345_678, "BTC")).toBe(0.12345678);
  });
});
