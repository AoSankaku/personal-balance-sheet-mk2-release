import type {
  Account,
  CreditCardSettings,
  CreditCardStatementCompletion,
} from "@balance-sheet/shared";
import {
  creditCardBillingOffsetMonths,
  resolveCreditCardMonthDay,
  shiftCreditCardMonth,
} from "@balance-sheet/shared";

export interface CreditCardImportTask {
  id: string;
  accountId: number;
  creditCardName: string;
  statementMonth: string;
  paymentMonth: string;
}

interface ComputeCreditCardImportTasksInput {
  today: Date;
  accounts: Account[];
  creditCardSettings: CreditCardSettings[];
  completions: CreditCardStatementCompletion[];
}

export function computeCreditCardImportTasks({
  today,
  accounts,
  creditCardSettings,
  completions,
}: ComputeCreditCardImportTasksInput): CreditCardImportTask[] {
  const paymentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const todayDay = today.getDate();
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  return creditCardSettings.flatMap((settings) => {
    const confirmationDay = resolveCreditCardMonthDay(
      paymentMonth,
      settings.confirmation_day,
    );
    if (todayDay < confirmationDay) return [];

    const statementMonth = shiftCreditCardMonth(
      paymentMonth,
      -creditCardBillingOffsetMonths(settings),
    );
    const hasCompletedStatement = completions.some(
      (entry) =>
        entry.account_id === settings.account_id &&
        entry.statement_month === statementMonth,
    );
    if (hasCompletedStatement) return [];

    const account = accountById.get(settings.account_id);
    if (!account) return [];

    return [
      {
        id: `credit-card-import-${settings.account_id}-${statementMonth}`,
        accountId: settings.account_id,
        creditCardName: account.name,
        statementMonth,
        paymentMonth,
      },
    ];
  });
}
