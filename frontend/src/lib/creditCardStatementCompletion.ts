import type {
  CompleteCreditCardStatementInput,
  CreditCardSettings,
  CreditCardStatementCompletion,
  UpsertCreditCardStateInput,
} from "@balance-sheet/shared";
import {
  creditCardBillingOffsetMonths,
  resolveCreditCardMonthDay,
  paymentMonthForStatementMonth,
  shiftCreditCardMonth,
  statementMonthForTransactionDate,
} from "@balance-sheet/shared";
import type { CsvFormat, ParsedTransaction } from "../utils/csvParser";

function mostFrequentMonth(months: string[]): string | null {
  const counts = new Map<string, number>();
  for (const month of months) {
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  return (
    [...counts.entries()].sort(
      ([monthA, countA], [monthB, countB]) =>
        countB - countA || monthB.localeCompare(monthA),
    )[0]?.[0] ?? null
  );
}

export function getConfirmedCsvCreditCardState({
  format,
  transactions,
  settings,
}: {
  format: CsvFormat;
  transactions: ParsedTransaction[];
  settings: CreditCardSettings | undefined;
}): UpsertCreditCardStateInput | null {
  if (
    !settings ||
    transactions.length === 0 ||
    (format !== "smbc-confirmed" && format !== "rakuten-confirmed")
  ) {
    return null;
  }

  const paymentMonth =
    format === "rakuten-confirmed"
      ? mostFrequentMonth(
          transactions.map((transaction) => transaction.paymentMonth),
        )
      : (() => {
          const statementMonth = mostFrequentMonth(
            transactions.map((transaction) =>
              statementMonthForTransactionDate(
                transaction.date,
                settings.closing_day,
              ),
            ),
          );
          return statementMonth
            ? paymentMonthForStatementMonth(statementMonth, settings)
            : null;
        })();
  if (!paymentMonth) return null;

  return {
    account_id: settings.account_id,
    payment_month: paymentMonth,
    amount: transactions.reduce(
      (sum, transaction) =>
        sum +
        (transaction.direction === "deposit"
          ? -transaction.amount
          : transaction.amount),
      0,
    ),
    status: "confirmed",
  };
}

export function getDefaultStatementMonth({
  format,
  transactions,
  settings,
  selectableStatementMonths,
}: {
  format: CsvFormat;
  transactions: ParsedTransaction[];
  settings: CreditCardSettings | undefined;
  selectableStatementMonths: string[];
}): string | null {
  const selectableMonths = [...selectableStatementMonths].sort();
  const latestSelectableMonth = selectableMonths.at(-1) ?? null;
  if (
    !settings ||
    transactions.length === 0 ||
    format === "unknown" ||
    format === "smbc-bank" ||
    format === "sbi-bank"
  ) {
    return latestSelectableMonth;
  }

  const selectableSet = new Set(selectableMonths);
  const counts = new Map<string, number>();
  for (const transaction of transactions) {
    const statementMonth =
      format === "smbc-confirmed"
        ? statementMonthForTransactionDate(
            transaction.date,
            settings.closing_day,
          )
        : /^\d{4}-\d{2}$/.test(transaction.paymentMonth)
          ? shiftCreditCardMonth(
              transaction.paymentMonth,
              -creditCardBillingOffsetMonths(settings),
            )
          : statementMonthForTransactionDate(
              transaction.date,
              settings.closing_day,
            );
    if (!selectableSet.has(statementMonth)) continue;
    counts.set(statementMonth, (counts.get(statementMonth) ?? 0) + 1);
  }

  return (
    [...counts.entries()].sort(
      ([monthA, countA], [monthB, countB]) =>
        countB - countA || monthB.localeCompare(monthA),
    )[0]?.[0] ?? latestSelectableMonth
  );
}

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

export function getManualStatementCompletion(
  today: Date,
  settings: CreditCardSettings | undefined,
): CompleteCreditCardStatementInput | null {
  if (!settings) return null;
  const target = getReadyStatementTarget(today, settings);
  return target
    ? { ...target, completion_method: "manual_confirmation" }
    : null;
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
  const settingsCreationMonth = /^\d{4}-\d{2}/.test(settings.created_at)
    ? settings.created_at.slice(0, 7)
    : latestReadyStatementMonth;
  const firstSelectableMonth = settingsCreationMonth;
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
