import { toStorageMoneyAmount, type MoneyScaleOptions } from "./moneyValidation";

interface Line {
  account_id: number;
  debit?: number;
  credit?: number;
  currency?: string;
}

/** Validate before constructing a write batch; a client flag cannot waive balance. */
export function journalBalanceError(lines: Line[], exchange: boolean, options: MoneyScaleOptions): string | null {
  const totals = new Map<string, bigint>();
  for (const line of lines) {
    if ((line.debit ?? 0) < 0 || (line.credit ?? 0) < 0 || ((line.debit ?? 0) > 0 && (line.credit ?? 0) > 0)) {
      return "journal lines must contain a nonnegative debit or credit";
    }
    const currency = (line.currency || "JPY").toUpperCase();
    const debit = BigInt(toStorageMoneyAmount(line.debit ?? 0, currency, options));
    const credit = BigInt(toStorageMoneyAmount(line.credit ?? 0, currency, options));
    totals.set(currency, (totals.get(currency) ?? 0n) + debit - credit);
  }
  if ([...totals.values()].every((total) => total === 0n)) return null;
  if (!exchange) return "Unbalanced entry in currency smallest units";
  // FX consists of exactly one giving leg and one receiving leg in distinct currencies.
  // The rate is implied by the explicitly supplied amounts, never by nominal summation.
  if (lines.length !== 2 || totals.size !== 2 ||
      lines.filter((line) => (line.debit ?? 0) > 0).length !== 1 ||
      lines.filter((line) => (line.credit ?? 0) > 0).length !== 1) {
    return "Currency exchange requires two positive opposite legs in different currencies";
  }
  return null;
}
