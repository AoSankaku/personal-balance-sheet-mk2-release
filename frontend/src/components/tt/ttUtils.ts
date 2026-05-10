import {
  deriveCreditCardStatus,
  paymentMonthForStatementMonth,
  paymentDateForStatementMonth,
  shiftCreditCardMonth,
  statementMonthForTransactionDate,
  statementMonthWithTransactionOffset,
  usagePeriodForStatementMonth,
} from "@balance-sheet/shared";
import type {
  Account,
  CreditCardSnapshotStatus,
  CreditCardSettings,
  JournalEntry,
} from "@balance-sheet/shared";
import { useLang } from "../../i18n";
import { systemAccountTranslationKey } from "../../lib/accountUtils";

// ──────────────────────────────────────────────
// Hook
// ──────────────────────────────────────────────

/** Returns the display name for an account, translating system account keys */
export function useAccountDisplayName() {
  const { t } = useLang();
  return (name: string) => {
    const key = systemAccountTranslationKey(name);
    if (key) return t(key);
    return name;
  };
}

// ──────────────────────────────────────────────
// Shared types
// ──────────────────────────────────────────────

export type GeneralValuesMap = Record<number, number | string>;

export type CreditCardDraftRow = {
  id: string;
  payment_month: string;
  amount: number | string;
  status: CreditCardSnapshotStatus;
};

export type CreditCardValuesMap = Record<number, CreditCardDraftRow[]>;

export const DEFAULT_CREDIT_CARD_VISIBLE_MONTHS = 6;
export const CREDIT_CARD_MONTH_DISPLAY_STEP = 3;

export interface WorksheetRow {
  id: string;
  account_id: number | null;
  amount: number | string;
  note: string;
}

export interface DeviationRow {
  account_id: number;
  account_name: string;
  book_value: number;
  actual_value: number;
  deviation: number; // actual - book
  match_key: string;
  match_from?: string;
  match_to?: string;
  out_of_scope_note?: string;
  /** Set on CC breakdown sub-rows. Excluded from global total and journal preview. */
  slot_label?: string;
}

export interface JournalPreviewEntry {
  debit_account: string;
  credit_account: string;
  amount: number;
  date: string;
}

export interface MatchingJournalEntry {
  entry: JournalEntry;
  delta: number;
  distanceToFix: number;
}

// ──────────────────────────────────────────────
// Budget consistency helpers (from PlPage)
// ──────────────────────────────────────────────

export function getBudgetCheckTotals(
  entry: JournalEntry,
  accountMap: Map<number, Account>,
  excludedExpenseAllocationCategoryId?: number | null,
) {
  const expenseLines = entry.lines.filter(
    (l) => accountMap.get(l.account_id)?.type === "expense",
  );
  const incomeLines = entry.lines.filter(
    (l) => accountMap.get(l.account_id)?.type === "income",
  );
  const totalExpense = expenseLines.reduce((s, l) => s + l.debit - l.credit, 0);
  const totalIncome = incomeLines.reduce((s, l) => s + l.credit - l.debit, 0);
  const totalExpenseAllocated = -(entry.budget_allocations ?? [])
    .filter((a) => a.budget_category_id !== excludedExpenseAllocationCategoryId)
    .reduce((s, a) => s + a.amount, 0);
  const totalIncomeAllocated = (entry.income_budget_allocations ?? []).reduce(
    (s, a) => s + a.amount,
    0,
  );
  return {
    expenseLines,
    incomeLines,
    totalExpense,
    totalIncome,
    totalExpenseAllocated,
    totalIncomeAllocated,
  };
}

export function getSuspiciousReasons(
  entry: JournalEntry,
  accountMap: Map<number, Account>,
  locale: string,
  excludedExpenseAllocationCategoryId?: number | null,
): string[] {
  const reasons: string[] = [];
  const {
    expenseLines,
    incomeLines,
    totalExpense,
    totalIncome,
    totalExpenseAllocated,
    totalIncomeAllocated,
  } = getBudgetCheckTotals(
    entry,
    accountMap,
    excludedExpenseAllocationCategoryId,
  );
  if (expenseLines.length > 0) {
    const hasExplicitExpenseAllocations = (entry.budget_allocations ?? []).some(
      (allocation) =>
        allocation.budget_category_id !== excludedExpenseAllocationCategoryId,
    );
    if (hasExplicitExpenseAllocations) {
      const totalAllocated = totalExpenseAllocated;
      if (Math.abs(totalExpenseAllocated - totalExpense) > 1) {
        const fmt = (n: number) => Math.round(n).toLocaleString();
        reasons.push(
          locale === "ja"
            ? `費用額と予算配分の差異: 実際¥${fmt(totalExpense)} / 配分¥${fmt(totalAllocated)}`
            : `Expense vs allocation gap: actual ¥${fmt(totalExpense)} / allocated ¥${fmt(totalAllocated)}`,
        );
      }
    }
  }

  if (incomeLines.length > 0) {
    const totalIncomeLine = totalIncome;
    const incomeAllocs = entry.income_budget_allocations ?? [];
    if (incomeAllocs.length > 0) {
      const totalDistributed = totalIncomeAllocated;
      if (Math.abs(totalDistributed - totalIncomeLine) > 1) {
        const fmt = (n: number) => Math.round(n).toLocaleString();
        reasons.push(
          locale === "ja"
            ? `収入額と予算分配の差異: 実際¥${fmt(totalIncomeLine)} / 分配¥${fmt(totalDistributed)}`
            : `Income vs distribution gap: actual ¥${fmt(totalIncomeLine)} / distributed ¥${fmt(totalDistributed)}`,
        );
      }
    }
  }

  return reasons;
}

// ──────────────────────────────────────────────
// Credit card utility helpers
// ──────────────────────────────────────────────

export function monthKeyFromDate(dateStr: string) {
  return dateStr.slice(0, 7);
}

export function getCreditCardWindowMeta(
  snapshotDate: string,
  statementMonth: string,
  setting: CreditCardSettings | undefined,
  locale: string,
) {
  const period = setting
    ? usagePeriodForStatementMonth(statementMonth, setting.closing_day)
    : null;
  const confirmationDate = period?.end ?? snapshotDate;
  const paymentDate = setting
    ? paymentDateForStatementMonth(
        statementMonth,
        setting.withdrawal_day,
        setting,
      )
    : null;
  const status = deriveCreditCardStatus(snapshotDate, statementMonth, setting);
  const periodEnd =
    status === "open" && statementMonth === monthKeyFromDate(snapshotDate)
      ? snapshotDate
      : confirmationDate;

  return {
    status,
    period,
    periodEnd,
    periodLabel: period
      ? `${fmtMD(period.start, locale)} - ${fmtMD(periodEnd, locale)}`
      : "-",
    paymentDate,
  };
}

export function formatConfiguredDay(day: number, locale: string) {
  if (day === 0) {
    return locale === "ja" ? "月末" : "End of month";
  }
  return locale === "ja" ? `${day}日` : `day ${day}`;
}

export function formatBillingOffsetMonths(offset: number, locale: string) {
  return locale === "ja" ? `翌月+${offset}ヶ月` : `next month + ${offset} mo`;
}

export function formatCreditCardPaymentLabel(
  statementMonth: string,
  setting: CreditCardSettings | undefined,
  locale: string,
) {
  const paymentMonth = paymentMonthForStatementMonth(statementMonth, setting);
  return locale === "ja" ? `${paymentMonth}支払分` : `${paymentMonth} payment`;
}

export function createOpenCreditCardRow(month: string): CreditCardDraftRow {
  return {
    id: `open-${month}`,
    payment_month: month,
    amount: "",
    status: "open",
  };
}

export function sortCreditCardRows(rows: CreditCardDraftRow[]) {
  const order = { open: 0, confirmed: 1, paid: 2 };
  return [...rows].sort((a, b) => {
    if (a.payment_month !== b.payment_month) {
      return a.payment_month < b.payment_month ? 1 : -1;
    }
    return order[a.status] - order[b.status];
  });
}

export function normalizeCreditCardRows(
  rows: CreditCardDraftRow[],
  currentMonth: string,
): CreditCardDraftRow[] {
  const rowsByMonth = new Map<string, CreditCardDraftRow>();
  for (const row of rows) {
    if (!/^\d{4}-\d{2}$/.test(row.payment_month)) continue;
    if (!rowsByMonth.has(row.payment_month)) {
      rowsByMonth.set(row.payment_month, row);
    }
  }
  const recentRows = Array.from(
    { length: DEFAULT_CREDIT_CARD_VISIBLE_MONTHS },
    (_, index) => {
      const paymentMonth = shiftCreditCardMonth(currentMonth, -index);
      const row = rowsByMonth.get(paymentMonth);
      return {
        ...(row ?? createOpenCreditCardRow(paymentMonth)),
        id: row?.id || (index === 0 ? `open-${currentMonth}` : `recent-${paymentMonth}`),
        payment_month: paymentMonth,
        status: index === 0 ? ("open" as const) : (row?.status ?? "confirmed"),
      };
    },
  );
  const recentMonths = new Set(recentRows.map((row) => row.payment_month));
  const otherRows = rows.filter(
    (row) =>
      !recentMonths.has(row.payment_month) &&
      /^\d{4}-\d{2}$/.test(row.payment_month),
  );
  return sortCreditCardRows([
    ...recentRows,
    ...otherRows.map((row) => ({ ...row, id: row.id || crypto.randomUUID() })),
  ]);
}

/** Format a YYYY-MM-DD string as "M/D" (ja) or "MMM D" (en) for compact labels */
export function fmtMD(dateStr: string, locale: string): string {
  const [, m, d] = dateStr.split("-");
  if (locale === "ja") return `${Number(m)}/${Number(d)}`;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[Number(m) - 1]} ${Number(d)}`;
}

/**
 * Credit-card book change within [from, to].
 * Purchases increase the balance via credit; returns/refunds decrease it via debit.
 * Repayment debits paired with an asset credit are excluded.
 */
export function cardBookChangeInPeriod(
  accountId: number,
  statementMonth: string,
  snapshotDate: string,
  from: string,
  to: string,
  settings: CreditCardSettings | undefined,
  journal: JournalEntry[],
  accounts: Account[],
): number {
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  return journal
    .filter((e) => e.date <= snapshotDate)
    .reduce((sum, entry) => {
      const cardLines = entry.lines.filter(
        (line) => line.account_id === accountId,
      );
      if (cardLines.length === 0) return sum;

      const hasAssetCreditCounterpart = entry.lines.some(
        (line) =>
          line.account_id !== accountId &&
          line.credit > 0 &&
          accountMap.get(line.account_id)?.type === "asset",
      );

      return (
        sum +
        cardLines.reduce((lineSum, line) => {
          // If CC settings exist, derive the statement month purely from the
          // transaction date and offset (offset=null treated as 0 = normal cycle).
          // This correctly handles offset > 0, where a transaction from a prior
          // billing period shifts forward into a later statement month.
          // Without settings, fall back to the date-range window.
          const resolvedStatementMonth = settings
            ? statementMonthWithTransactionOffset(
                entry.date,
                settings.closing_day,
                line.credit_card_billing_offset_months ?? 0,
              )
            : entry.date >= from && entry.date <= to
              ? statementMonth
              : null;
          if (resolvedStatementMonth !== statementMonth) {
            return lineSum;
          }
          const debit =
            line.debit > 0 && hasAssetCreditCounterpart ? 0 : line.debit;
          return lineSum + line.credit - debit;
        }, 0)
      );
    }, 0);
}

export function cardWithdrawalAmountForStatementMonth(
  accountId: number,
  statementMonth: string,
  snapshotDate: string,
  settings: CreditCardSettings | undefined,
  journal: JournalEntry[],
  accounts: Account[],
): number {
  const paymentMonth = paymentMonthForStatementMonth(statementMonth, settings);
  const accountMap = new Map(accounts.map((account) => [account.id, account]));

  return journal
    .filter(
      (entry) =>
        entry.date <= snapshotDate &&
        entry.date.slice(0, 7) === paymentMonth,
    )
    .reduce((sum, entry) => {
      const hasAssetCreditCounterpart = entry.lines.some(
        (line) =>
          line.account_id !== accountId &&
          line.credit > 0 &&
          accountMap.get(line.account_id)?.type === "asset",
      );
      if (!hasAssetCreditCounterpart) {
        return sum;
      }

      const withdrawn = entry.lines
        .filter((line) => line.account_id === accountId)
        .reduce((lineSum, line) => lineSum + line.debit, 0);

      return sum + withdrawn;
    }, 0);
}

// ──────────────────────────────────────────────
// Page size / date helpers
// ──────────────────────────────────────────────

export { toDateStr } from "../../lib/dateUtils";

export function getPageSize(key: string, fallback: number) {
  const raw = localStorage.getItem(key);
  const n = Number(raw);
  return raw && !isNaN(n) && n > 0 ? n : fallback;
}

// ──────────────────────────────────────────────
// Shared: statementMonthForTransactionDate re-export
// ──────────────────────────────────────────────
export {
  statementMonthForTransactionDate,
  statementMonthWithTransactionOffset,
};
