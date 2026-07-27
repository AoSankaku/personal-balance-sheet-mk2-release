import type { CryptoChain, CryptoWallet } from "@balance-sheet/shared";
import type { GeneralValuesMap } from "./ttUtils";

const CHAINS_BY_CURRENCY: Readonly<Record<string, readonly CryptoChain[]>> = {
  BTC: ["btc"],
  ETH: ["eth"],
  SOL: ["sol", "msol", "sol_stake"],
  SKR: ["skr"],
};

export function currencyForCryptoWallet(wallet: CryptoWallet): string {
  switch (wallet.chain) {
    case "btc":
      return "BTC";
    case "eth":
      return "ETH";
    case "sol":
    case "msol":
    case "sol_stake":
      return "SOL";
    case "skr":
      return "SKR";
    case "binance":
      return wallet.address.trim().toUpperCase();
  }
}

export function cryptoChainsForCurrency(currency: string): CryptoChain[] {
  return [...(CHAINS_BY_CURRENCY[currency.trim().toUpperCase()] ?? [])];
}

export function walletsForCurrency(
  wallets: CryptoWallet[],
  currency: string,
): CryptoWallet[] {
  const selectedCurrency = currency.trim().toUpperCase();
  return wallets.filter(
    (wallet) => currencyForCryptoWallet(wallet) === selectedCurrency,
  );
}

export function mergeFetchedCryptoBalances(
  current: GeneralValuesMap,
  wallets: CryptoWallet[],
  balances: Map<number, number>,
  protectedAccountIds: ReadonlySet<number> = new Set(),
): GeneralValuesMap {
  const next = { ...current };
  for (const wallet of wallets) {
    const balance = balances.get(wallet.account_id);
    if (balance === undefined || protectedAccountIds.has(wallet.account_id)) {
      continue;
    }
    next[wallet.account_id] = balance;
  }
  return next;
}
