import type {
  CompleteCreditCardStatementInput,
  CreditCardSettings,
  CreditCardStatementCompletion,
} from "@balance-sheet/shared";
import {
  creditCardBillingOffsetMonths,
  resolveCreditCardMonthDay,
  paymentMonthForStatementMonth,
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

  const statementMonth = shiftCreditCardMonth(
    paymentMonth,
    -creditCardBillingOffsetMonths(settings),
  );
  const settingsCreationMonth = /^\d{4}-\d{2}/.test(settings.created_at)
    ? settings.created_at.slice(0, 7)
    : statementMonth;
  if (statementMonth < settingsCreationMonth) return null;

  return {
    account_id: settings.account_id,
    statement_month: statementMonth,
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

export function getSelectableZeroAmountCompletions(
  today: Date,
  settings: CreditCardSettings | undefined,
  completions: CreditCardStatementCompletion[],
): CompleteCreditCardStatementInput[] {
  if (!settings) return [];

  const currentPaymentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const currentConfirmationDay = resolveCreditCardMonthDay(
    currentPaymentMonth,
    settings.confirmation_day,
  );
  const latestReadyPaymentMonth =
    today.getDate() >= currentConfirmationDay
      ? currentPaymentMonth
      : shiftCreditCardMonth(currentPaymentMonth, -1);
  const latestReadyStatementMonth = shiftCreditCardMonth(
    latestReadyPaymentMonth,
    -creditCardBillingOffsetMonths(settings),
  );

  const accountCompletions = completions.filter(
    (completion) => completion.account_id === settings.account_id,
  );
  const latestCompletedStatementMonth = accountCompletions.reduce<
    string | null
  >(
    (latest, completion) =>
      latest === null || completion.statement_month > latest
        ? completion.statement_month
        : latest,
    null,
  );
  const settingsCreationMonth = /^\d{4}-\d{2}/.test(settings.created_at)
    ? settings.created_at.slice(0, 7)
    : latestReadyStatementMonth;
  const firstSelectableMonth = latestCompletedStatementMonth
    ? shiftCreditCardMonth(latestCompletedStatementMonth, 1)
    : settingsCreationMonth;
  if (firstSelectableMonth > latestReadyStatementMonth) return [];

  const completedMonths = new Set(
    accountCompletions.map((completion) => completion.statement_month),
  );
  const targets: CompleteCreditCardStatementInput[] = [];
  for (
    let statementMonth = firstSelectableMonth;
    statementMonth <= latestReadyStatementMonth;
    statementMonth = shiftCreditCardMonth(statementMonth, 1)
  ) {
    if (completedMonths.has(statementMonth)) continue;
    targets.push({
      account_id: settings.account_id,
      statement_month: statementMonth,
      payment_month: paymentMonthForStatementMonth(statementMonth, settings),
      completion_method: "zero_amount",
    });
  }
  return targets;
}
