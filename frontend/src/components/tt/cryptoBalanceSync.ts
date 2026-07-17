import type { CryptoWallet } from "@balance-sheet/shared";
import type { GeneralValuesMap } from "./ttUtils";

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
