import type { CreditCardStateEntry } from "@balance-sheet/shared";
import {
  normalizeCreditCardRows,
  sortCreditCardRows,
  type CreditCardDraftRow,
} from "../components/tt/ttUtils";

/** Seeds an account once, then merges newly discovered months without changing existing drafts. */
export function mergeCreditCardDraftRows({
  currentRows,
  persistedRows,
  derivedMonths,
  currentMonth,
  suppressedMonths = new Set(),
}: {
  currentRows: CreditCardDraftRow[] | undefined;
  persistedRows: CreditCardStateEntry[];
  derivedMonths: ReadonlySet<string>;
  currentMonth: string;
  suppressedMonths?: ReadonlySet<string>;
}): CreditCardDraftRow[] {
  if (!currentRows) {
    const seeded: CreditCardDraftRow[] = persistedRows.map((entry) => ({
      id: `seed-${entry.account_id}-${entry.payment_month}`,
      payment_month: entry.payment_month,
      amount: entry.amount,
      status: entry.status,
    }));
    for (const paymentMonth of derivedMonths) {
      if (seeded.some((row) => row.payment_month === paymentMonth)) continue;
      seeded.push({
        id: `derived-${paymentMonth}`,
        payment_month: paymentMonth,
        amount: "",
        status: paymentMonth === currentMonth ? "open" : "confirmed",
      });
    }
    return normalizeCreditCardRows(seeded, currentMonth);
  }

  const seeded = [...currentRows];
  const knownMonths = new Set(currentRows.map((row) => row.payment_month));
  for (const paymentMonth of derivedMonths) {
    if (knownMonths.has(paymentMonth) || suppressedMonths.has(paymentMonth)) continue;
    knownMonths.add(paymentMonth);
    seeded.push({
      id: `derived-${paymentMonth}`,
      payment_month: paymentMonth,
      amount: "",
      status: paymentMonth === currentMonth ? "open" : "confirmed",
    });
  }
  return sortCreditCardRows(
    normalizeCreditCardRows(seeded, currentMonth).filter(
      (row) =>
        row.payment_month === currentMonth ||
        knownMonths.has(row.payment_month) ||
        !suppressedMonths.has(row.payment_month),
    ),
  );
}
