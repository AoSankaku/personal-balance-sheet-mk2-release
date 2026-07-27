import {
  fromStorageMoneyAmount,
  normalizeMoneyCurrency,
  toStorageMoneyAmount,
} from "./moneyValidation";

export type ActualBalanceAmountInput = {
  account_id: number;
  amount: number;
  currency?: string | null;
};

export function prepareActualBalanceEntry(
  snapshotId: number,
  entry: ActualBalanceAmountInput,
) {
  const currency = normalizeMoneyCurrency(entry.currency);
  return {
    snapshot_id: snapshotId,
    account_id: entry.account_id,
    amount: toStorageMoneyAmount(entry.amount, currency),
    currency,
  };
}

export function decodeActualBalanceAmount(
  amount: number,
  currency: string | null | undefined,
) {
  return fromStorageMoneyAmount(amount, currency);
}
