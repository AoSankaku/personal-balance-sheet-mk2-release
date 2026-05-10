import { resolveCreditCardMonthDay } from "@balance-sheet/shared";
import type {
  Account,
  CreditCardSettings,
  CreditCardStateEntry,
} from "@balance-sheet/shared";

const WITHDRAWAL_RISK_LOOKAHEAD_DAYS = 14;

export interface CreditCardWithdrawalRiskNotification {
  id: string;
  creditCardAccountId: number;
  creditCardName: string;
  withdrawalAccountId: number;
  withdrawalAccountName: string;
  paymentMonth: string;
  withdrawalDate: string;
  amount: number;
  projectedBalance: number;
  combinedAmount: number;
  combinedProjectedBalance: number;
  riskyCardNames: string[];
}

interface ComputeInput {
  today: Date;
  accounts: Account[];
  creditCardSettings: CreditCardSettings[];
  creditCardState: CreditCardStateEntry[];
}

interface UpcomingWithdrawal {
  setting: CreditCardSettings;
  card: Account;
  withdrawalAccount: Account;
  paymentMonth: string;
  withdrawalDate: string;
  amount: number;
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function daysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function accountBalance(account: Account): number {
  return account.balances?.JPY ?? account.balance ?? 0;
}

function getWithdrawalDate(paymentMonth: string, withdrawalDay: number): string {
  const day = resolveCreditCardMonthDay(paymentMonth, withdrawalDay);
  return `${paymentMonth}-${String(day).padStart(2, "0")}`;
}

function getUpcomingPaymentMonths(today: Date): string[] {
  return [monthKey(today), monthKey(addMonths(today, 1))];
}

export function computeCreditCardWithdrawalRiskNotifications({
  today,
  accounts,
  creditCardSettings,
  creditCardState,
}: ComputeInput): CreditCardWithdrawalRiskNotification[] {
  const enabledStates = new Map<string, CreditCardStateEntry>();
  for (const state of creditCardState) {
    if (state.status === "paid") continue;
    if (state.amount <= 0) continue;
    enabledStates.set(`${state.account_id}:${state.payment_month}`, state);
  }

  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  const upcoming: UpcomingWithdrawal[] = [];
  const paymentMonths = getUpcomingPaymentMonths(today);

  for (const setting of creditCardSettings) {
    if (!setting.withdrawal_account_id) continue;

    const card = accountMap.get(setting.account_id);
    const withdrawalAccount = accountMap.get(setting.withdrawal_account_id);
    if (!card || !withdrawalAccount) continue;

    for (const paymentMonth of paymentMonths) {
      const withdrawalDate = getWithdrawalDate(
        paymentMonth,
        setting.withdrawal_day,
      );
      const daysUntil = daysBetween(
        today,
        new Date(`${withdrawalDate}T00:00:00`),
      );
      if (daysUntil < 0 || daysUntil > WITHDRAWAL_RISK_LOOKAHEAD_DAYS) {
        continue;
      }

      const state = enabledStates.get(`${setting.account_id}:${paymentMonth}`);
      if (!state) continue;

      upcoming.push({
        setting,
        card,
        withdrawalAccount,
        paymentMonth,
        withdrawalDate,
        amount: state.amount,
      });
    }
  }

  const grouped = new Map<string, UpcomingWithdrawal[]>();
  for (const withdrawal of upcoming) {
    const key = `${withdrawal.withdrawalAccount.id}:${withdrawal.withdrawalDate}`;
    grouped.set(key, [...(grouped.get(key) ?? []), withdrawal]);
  }

  return [...grouped.values()].flatMap((withdrawals) => {
    const first = withdrawals[0];
    if (!first) return [];

    const balance = accountBalance(first.withdrawalAccount);
    const combinedAmount = withdrawals.reduce(
      (sum, item) => sum + item.amount,
      0,
    );
    const combinedProjectedBalance = balance - combinedAmount;
    const riskyCardNames = withdrawals.map((item) => item.card.name);

    return withdrawals.flatMap((withdrawal) => {
      const projectedBalance = balance - withdrawal.amount;
      if (projectedBalance >= 0 && combinedProjectedBalance >= 0) return [];

      return [
        {
          id: `cc-withdrawal-risk-${withdrawal.setting.account_id}-${withdrawal.withdrawalDate}`,
          creditCardAccountId: withdrawal.setting.account_id,
          creditCardName: withdrawal.card.name,
          withdrawalAccountId: withdrawal.withdrawalAccount.id,
          withdrawalAccountName: withdrawal.withdrawalAccount.name,
          paymentMonth: withdrawal.paymentMonth,
          withdrawalDate: withdrawal.withdrawalDate,
          amount: withdrawal.amount,
          projectedBalance,
          combinedAmount,
          combinedProjectedBalance,
          riskyCardNames,
        },
      ];
    });
  });
}
