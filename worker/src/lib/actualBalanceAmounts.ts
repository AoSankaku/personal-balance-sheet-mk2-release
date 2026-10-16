import {
  fromStorageMoneyAmount,
  moneyScale,
  normalizeMoneyCurrency,
  toStorageMoneyAmount,
  type MoneyScaleOptions,
} from "./moneyValidation";

export type ActualBalanceAmountInput = {
  account_id: number;
  amount: number;
  currency?: string | null;
};

export function prepareActualBalanceEntry(
  snapshotId: number,
  entry: ActualBalanceAmountInput,
  options: MoneyScaleOptions = {},
) {
  const currency = normalizeMoneyCurrency(entry.currency);
  return {
    snapshot_id: snapshotId,
    account_id: entry.account_id,
    amount: toStorageMoneyAmount(entry.amount, currency, options),
    money_scale: moneyScale(currency, options),
    currency,
  };
}

export function decodeActualBalanceAmount(
  amount: number,
  currency: string | null | undefined,
  storedScale?: number | null,
) {
  return fromStorageMoneyAmount(
    amount,
    currency,
    storedScale == null ? {} : { decimalPlaces: storedScale },
  );
}
