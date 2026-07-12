import type {
  Account,
  CreditCardSettings,
  CreditCardStateEntry,
  JournalEntry,
} from "@balance-sheet/shared";
import {
  creditCardBillingOffsetMonths,
  resolveCreditCardMonthDay,
  shiftCreditCardMonth,
  usagePeriodForStatementMonth,
} from "@balance-sheet/shared";

export interface CreditCardImportTask {
  id: string;
  accountId: number;
  creditCardName: string;
  statementMonth: string;
  paymentMonth: string;
  usagePeriod: { start: string; end: string };
}

interface ComputeCreditCardImportTasksInput {
  today: Date;
  accounts: Account[];
  creditCardSettings: CreditCardSettings[];
  creditCardState: CreditCardStateEntry[];
  journal: JournalEntry[];
}

export function computeCreditCardImportTasks({
  today,
  accounts,
  creditCardSettings,
  creditCardState,
  journal,
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
    const usagePeriod = usagePeriodForStatementMonth(
      statementMonth,
      settings.closing_day,
    );
    const hasUsage = journal.some(
      (entry) =>
        entry.date >= usagePeriod.start &&
        entry.date <= usagePeriod.end &&
        entry.lines.some(
          (line) =>
            line.account_id === settings.account_id && line.credit > 0,
        ),
    );
    if (!hasUsage) return [];

    const hasImportedStatement = creditCardState.some(
      (entry) =>
        entry.account_id === settings.account_id &&
        entry.payment_month === paymentMonth,
    );
    if (hasImportedStatement) return [];

    const account = accountById.get(settings.account_id);
    if (!account) return [];

    return [
      {
        id: `credit-card-import-${settings.account_id}-${statementMonth}`,
        accountId: settings.account_id,
        creditCardName: account.name,
        statementMonth,
        paymentMonth,
        usagePeriod,
      },
    ];
  });
}
