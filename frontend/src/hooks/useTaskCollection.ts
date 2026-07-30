import { useEffect, useState } from "react";
import {
  isShortTermBorrowingCategory,
  isShortTermLendingCategory,
  resolveMonthlyPayday,
  type IncomeTransferRequirementGroup,
} from "@balance-sheet/shared";
import { api } from "../api/client";
import { useAppData } from "../context/AppDataContext";
import { useLang } from "../i18n";
import { useOnlineStatus } from "./useOnlineStatus";
import { accountDisplayNameFromName } from "../lib/accountUtils";
import {
  computeCreditCardImportTasks,
  type CreditCardImportTask,
} from "../lib/creditCardImportTasks";
import {
  computeCreditCardWithdrawalRiskTasks,
  type CreditCardWithdrawalRiskTask,
} from "../lib/creditCardWithdrawalRisk";
import { useOfflineDrafts } from "../lib/offlineDrafts";
import {
  computeTrialBalanceTask,
  type TrialBalanceTask,
} from "../lib/trialBalanceTasks";
import { findOverdueShortTermLoanAccounts } from "../pages/dbPageUtils";

interface AppTask {
  id: string;
  message: string;
}

interface OverdueLoanTask extends AppTask {
  daysDiff: number;
}

interface BudgetNegativeTask {
  show: boolean;
  allocatableToday: number;
  allocatableTotal: number;
}

export interface TaskCollection {
  budgetTask: BudgetNegativeTask;
  creditCardImportTasks: CreditCardImportTask[];
  creditCardWithdrawalRiskTasks: CreditCardWithdrawalRiskTask[];
  incomeTransferTasks: IncomeTransferRequirementGroup[];
  negativeAccountTasks: AppTask[];
  overdueLoanTasks: OverdueLoanTask[];
  paydayTasks: AppTask[];
  pendingOfflineDrafts: ReturnType<typeof useOfflineDrafts>;
  totalCount: number;
  trialBalanceTask: TrialBalanceTask | null;
}

function usePaydayTasks(): AppTask[] {
  const { accounts, journal, taskSettings } = useAppData();
  const { t } = useLang();

  if (!taskSettings.payday_enabled) return [];

  const now = new Date();
  const todayDay = now.getDate();
  const thisYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const tasks: AppTask[] = [];

  for (const account of accounts) {
    if (account.type !== "income") continue;
    if (account.payday === null || account.payday === undefined) continue;
    const payday = resolveMonthlyPayday(thisYM, account.payday);
    if (todayDay < payday) continue;

    const hasEntry = journal.some(
      (entry) =>
        entry.date.startsWith(thisYM) &&
        entry.lines.some(
          (line) => line.account_id === account.id && line.credit > 0,
        ),
    );

    if (!hasEntry) {
      tasks.push({
        id: `payday-${account.id}`,
        message: accountDisplayNameFromName(account.name, t),
      });
    }
  }

  return tasks;
}

function useBudgetNegativeTask(): BudgetNegativeTask {
  const { allocatableToday, allocatableTotal, taskSettings } = useAppData();
  return {
    show:
      taskSettings.budget_negative_enabled &&
      (allocatableToday < 0 || allocatableTotal < 0),
    allocatableToday,
    allocatableTotal,
  };
}

function useOverdueLoanTasks(): OverdueLoanTask[] {
  const { accounts, journal, taskSettings } = useAppData();
  const { t } = useLang();

  if (!taskSettings.loan_overdue_enabled) return [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const loanAccounts = accounts.flatMap((account) => {
    const isShortTerm =
      isShortTermLendingCategory(account.category as never) ||
      isShortTermBorrowingCategory(account.category as never);
    if (!isShortTerm) return [];

    const entries = journal
      .filter((entry) =>
        entry.lines.some((line) => line.account_id === account.id),
      )
      .map((entry) => {
        let netChange = 0;
        for (const line of entry.lines) {
          if (line.account_id !== account.id) continue;
          if (account.type === "asset" || account.type === "expense") {
            netChange += line.debit - line.credit;
          } else {
            netChange += line.credit - line.debit;
          }
        }
        return { entry, netChange };
      });

    return [{ account, entries }];
  });

  return findOverdueShortTermLoanAccounts(
    loanAccounts,
    taskSettings.loan_overdue_days,
    today,
  ).map(({ account, daysDiff }) => ({
    id: `loan-overdue-${account.id}`,
    message: accountDisplayNameFromName(account.name, t),
    daysDiff,
  }));
}

function useNegativeAccountTasks(): AppTask[] {
  const { accounts, taskSettings } = useAppData();
  const { t } = useLang();

  if (!taskSettings.account_negative_enabled) return [];

  return accounts.flatMap((account) => {
    if (account.name === "__system:unknown_funds__") return [];
    if ((account.balance ?? 0) >= -0.001) return [];
    return [{
      id: `account-negative-${account.id}`,
      message: accountDisplayNameFromName(account.name, t),
    }];
  });
}

function useCreditCardWithdrawalRiskTasks(): CreditCardWithdrawalRiskTask[] {
  const { accounts, creditCardSettings, creditCardState, taskSettings } =
    useAppData();

  if (!taskSettings.credit_card_withdrawal_risk_enabled) return [];

  return computeCreditCardWithdrawalRiskTasks({
    today: new Date(),
    accounts,
    creditCardSettings,
    creditCardState,
  });
}

function useCreditCardImportTasks(): CreditCardImportTask[] {
  const {
    accounts,
    creditCardSettings,
    creditCardStatementCompletions,
    taskSettings,
  } = useAppData();

  if (!taskSettings.credit_card_import_enabled) return [];

  return computeCreditCardImportTasks({
    today: new Date(),
    accounts,
    creditCardSettings,
    completions: creditCardStatementCompletions,
  });
}

function useTrialBalanceTask(): TrialBalanceTask | null {
  const { latestTrialBalanceDate, loading, taskSettings } = useAppData();
  return computeTrialBalanceTask({
    today: new Date(),
    enabled: taskSettings.trial_balance_enabled && !loading,
    day: taskSettings.trial_balance_day,
    latestSnapshotDate: latestTrialBalanceDate,
  });
}

function useIncomeTransferTasks(): IncomeTransferRequirementGroup[] {
  const { journal } = useAppData();
  const [groups, setGroups] = useState<IncomeTransferRequirementGroup[]>([]);

  useEffect(() => {
    let cancelled = false;
    void api.incomeTransferRequirements
      .list("pending")
      .then((result) => {
        if (!cancelled) setGroups(result.groups);
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
      });
    return () => {
      cancelled = true;
    };
  }, [journal]);

  return groups;
}

export function formatTaskMonth(yearMonth: string, locale: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
  }).format(new Date(year, month - 1, 1));
}

export function useTaskCollection(): TaskCollection {
  const paydayTasks = usePaydayTasks();
  const budgetTask = useBudgetNegativeTask();
  const overdueLoanTasks = useOverdueLoanTasks();
  const negativeAccountTasks = useNegativeAccountTasks();
  const creditCardImportTasks = useCreditCardImportTasks();
  const creditCardWithdrawalRiskTasks = useCreditCardWithdrawalRiskTasks();
  const trialBalanceTask = useTrialBalanceTask();
  const incomeTransferTasks = useIncomeTransferTasks();
  const isOnline = useOnlineStatus();
  const offlineDrafts = useOfflineDrafts();
  const pendingOfflineDrafts = isOnline ? offlineDrafts : [];
  const totalCount =
    pendingOfflineDrafts.length +
    paydayTasks.length +
    creditCardImportTasks.length +
    incomeTransferTasks.length +
    (trialBalanceTask ? 1 : 0) +
    (budgetTask.show ? 1 : 0) +
    (overdueLoanTasks.length > 0 ? 1 : 0) +
    (negativeAccountTasks.length > 0 ? 1 : 0) +
    (creditCardWithdrawalRiskTasks.length > 0 ? 1 : 0);

  return {
    budgetTask,
    creditCardImportTasks,
    creditCardWithdrawalRiskTasks,
    incomeTransferTasks,
    negativeAccountTasks,
    overdueLoanTasks,
    paydayTasks,
    pendingOfflineDrafts,
    totalCount,
    trialBalanceTask,
  };
}
