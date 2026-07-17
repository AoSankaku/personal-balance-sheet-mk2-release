import { describe, expect, it } from "bun:test";
import type { CryptoWallet } from "@balance-sheet/shared";
import {
  currencyForCryptoWallet,
  mergeFetchedCryptoBalances,
} from "./cryptoBalanceSync";

function wallet(
  accountId: number,
  chain: CryptoWallet["chain"],
  address = "wallet-address",
): CryptoWallet {
  return {
    id: accountId,
    account_id: accountId,
    address,
    chain,
    created_at: "2026-07-16T00:00:00Z",
  };
}

describe("currencyForCryptoWallet", () => {
  it.each([
    ["btc", "BTC"],
    ["eth", "ETH"],
    ["sol", "SOL"],
    ["skr", "SKR"],
    ["msol", "SOL"],
    ["sol_stake", "SOL"],
  ] as const)("maps %s balances to %s", (chain, expected) => {
    expect(currencyForCryptoWallet(wallet(1, chain))).toBe(expected);
  });

  it("uses the Binance asset ticker as the currency", () => {
    expect(currencyForCryptoWallet(wallet(1, "binance", "usdt"))).toBe(
      "USDT",
    );
  });
});

describe("mergeFetchedCryptoBalances", () => {
  const wallets = [wallet(1, "btc"), wallet(2, "eth"), wallet(3, "sol")];
  const balances = new Map([
    [1, 0.125],
    [2, 1.5],
  ]);

  it("fills empty linked accounts and ignores unavailable balances", () => {
    expect(mergeFetchedCryptoBalances({}, wallets, balances)).toEqual({
      1: 0.125,
      2: 1.5,
    });
  });

  it("preserves manually entered values while refreshing other accounts", () => {
    expect(
      mergeFetchedCryptoBalances(
        { 1: 0.2, 2: "" },
        wallets,
        balances,
        new Set([1]),
      ),
    ).toEqual({ 1: 0.2, 2: 1.5 });
  });

  it("keeps duplicate currencies independent by account id", () => {
    const duplicateBtcWallets = [wallet(1, "btc"), wallet(2, "btc")];
    const duplicateBtcBalances = new Map([
      [1, 0.125],
      [2, 0.75],
    ]);

    expect(
      mergeFetchedCryptoBalances(
        { 1: 0.2 },
        duplicateBtcWallets,
        duplicateBtcBalances,
        new Set([1]),
      ),
    ).toEqual({ 1: 0.2, 2: 0.75 });
  });
});
