import type {
  CompleteCreditCardStatementInput,
  CreditCardSettings,
} from "@balance-sheet/shared";
import {
  creditCardBillingOffsetMonths,
  resolveCreditCardMonthDay,
  shiftCreditCardMonth,
} from "@balance-sheet/shared";
import type { CsvFormat } from "../utils/csvParser";

function getReadyStatementTarget(
  today: Date,
  settings: CreditCardSettings,
): Pick<
  CompleteCreditCardStatementInput,
  "account_id" | "statement_month" | "payment_month"
> | null {
  const paymentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const confirmationDay = resolveCreditCardMonthDay(
    paymentMonth,
    settings.confirmation_day,
  );
  if (today.getDate() < confirmationDay) return null;

  return {
    account_id: settings.account_id,
    statement_month: shiftCreditCardMonth(
      paymentMonth,
      -creditCardBillingOffsetMonths(settings),
    ),
    payment_month: paymentMonth,
  };
}

export function getAutomaticStatementCompletion({
  today,
  settings,
  format,
  parsedTransactionCount,
  unresolvedTransactionCount,
}: {
  today: Date;
  settings: CreditCardSettings | undefined;
  format: CsvFormat;
  parsedTransactionCount: number;
  unresolvedTransactionCount: number;
}): CompleteCreditCardStatementInput | null {
  if (
    !settings ||
    (format !== "smbc-confirmed" && format !== "rakuten-confirmed") ||
    parsedTransactionCount === 0 ||
    unresolvedTransactionCount !== 0
  ) {
    return null;
  }
  const target = getReadyStatementTarget(today, settings);
  return target ? { ...target, completion_method: "csv_import" } : null;
}

export function getZeroAmountStatementCompletion(
  today: Date,
  settings: CreditCardSettings | undefined,
): CompleteCreditCardStatementInput | null {
  if (!settings) return null;
  const target = getReadyStatementTarget(today, settings);
  return target ? { ...target, completion_method: "zero_amount" } : null;
}
