import type {
  Account,
  JournalEntry,
  UpsertLongTermLoanPlanRowInput,
} from "@balance-sheet/shared";
import { toIntlLocale, type Locale } from "../i18n";

/** Add N months to a YYYY-MM string */
export function addMonths(yearMonth: string, n: number): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export type PaymentMethod = "equal_principal" | "equal_payment";

/**
 * Calculate the fixed monthly payment for an annuity (元利均等払い).
 * Returns the ceiling so each payment covers at least the accrued interest.
 */
export function calcMonthlyPayment(
  totalPrincipal: number,
  annualInterestRate: number,
  months: number,
): number {
  if (months <= 0 || totalPrincipal <= 0) return 0;
  const r = annualInterestRate / 100 / 12;
  if (r <= 0) return Math.ceil(totalPrincipal / months);
  const pow = Math.pow(1 + r, months);
  return Math.ceil((totalPrincipal * r * pow) / (pow - 1));
}

/**
 * Estimate the number of months needed to repay a loan with a fixed monthly
 * payment. Returns null when the payment does not cover the first month's
 * interest (infinite loop guard).
 */
export function estimateMonths(
  totalPrincipal: number,
  annualInterestRate: number,
  monthlyPayment: number,
): number | null {
  if (monthlyPayment <= 0 || totalPrincipal <= 0) return null;
  const r = annualInterestRate / 100 / 12;
  if (r <= 0) return Math.ceil(totalPrincipal / monthlyPayment);
  const firstInterest = totalPrincipal * r;
  if (monthlyPayment <= firstInterest) return null; // payment insufficient
  return Math.ceil(
    Math.log(monthlyPayment / (monthlyPayment - firstInterest)) /
      Math.log(1 + r),
  );
}

/**
 * Generate monthly plan rows.
 *
 * method "equal_principal" (元金均等払い, default):
 *   Principal is split evenly; interest is calculated on the declining balance.
 *   Rounding error is absorbed in the last month.
 *
 * method "equal_payment" (元利均等払い):
 *   A fixed monthly payment covers interest first; the remainder reduces the
 *   principal. If fixedMonthlyPayment is omitted it is derived from months via
 *   the annuity formula. Rows are generated until the balance reaches zero
 *   (capped at 600 months).
 */
export function generatePlanRows(opts: {
  totalPrincipal: number;
  months?: number;
  annualInterestRate: number; // percent, e.g. 3.5 for 3.5%
  startYearMonth: string;
  method?: PaymentMethod;
  fixedMonthlyPayment?: number;
}): UpsertLongTermLoanPlanRowInput[] {
  const {
    totalPrincipal,
    annualInterestRate,
    startYearMonth,
    method = "equal_principal",
    fixedMonthlyPayment,
  } = opts;
  const months = opts.months;

  if (totalPrincipal <= 0) return [];
  const monthlyRate = annualInterestRate / 100 / 12;

  if (method === "equal_payment") {
    let payment = fixedMonthlyPayment ?? 0;
    if (!payment && months && months > 0) {
      payment = calcMonthlyPayment(totalPrincipal, annualInterestRate, months);
    }
    if (!payment) return [];

    const rows: UpsertLongTermLoanPlanRowInput[] = [];
    let remaining = totalPrincipal;
    for (let i = 0; remaining > 0 && i < 600; i++) {
      const interest =
        monthlyRate > 0 ? Math.round(remaining * monthlyRate) : 0;
      const principalPart = payment - interest;
      const isLast = principalPart >= remaining;
      const principal = isLast
        ? Math.round(remaining)
        : Math.max(1, principalPart);
      rows.push({
        year_month: addMonths(startYearMonth, i),
        principal_amount: principal,
        interest_amount: interest,
        note: null,
      });
      remaining -= principal;
    }
    return rows;
  }

  // equal_principal (original behaviour)
  if (!months || months <= 0) return [];
  const basePrincipal = Math.floor(totalPrincipal / months);
  const rows: UpsertLongTermLoanPlanRowInput[] = [];
  let remaining = totalPrincipal;

  for (let i = 0; i < months; i++) {
    const isLast = i === months - 1;
    const principal = isLast ? Math.round(remaining) : basePrincipal;
    const interest = monthlyRate > 0 ? Math.round(remaining * monthlyRate) : 0;
    rows.push({
      year_month: addMonths(startYearMonth, i),
      principal_amount: principal,
      interest_amount: interest,
      note: null,
    });
    remaining -= principal;
  }
  return rows;
}

/** Format a YYYY-MM string as a locale-friendly month label */
export function formatYearMonth(yearMonth: string, locale: Locale): string {
  const [y, m] = yearMonth.split("-").map(Number);
  try {
    return new Date(y, m - 1, 1).toLocaleDateString(
      toIntlLocale(locale),
      { year: "numeric", month: "short" },
    );
  } catch {
    return yearMonth;
  }
}

/** Get the current YYYY-MM */
export function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export interface ClassifiedEntry {
  entry: JournalEntry;
  /** Net change to the loan/lending account itself (positive = increase, negative = decrease/repayment) */
  principalChange: number;
  /** Sum of income (lend) or expense (loan) lines in the same entry — represents interest/fees */
  feeAmount: number;
  /** Running balance before this entry */
  balanceBefore: number;
  /** Running balance after this entry */
  balanceAfter: number;
}

/**
 * Walk journal entries that touch `accountId`, split each entry into
 * principal (asset/liability change) vs fee (income/expense change),
 * and compute running balance.
 *
 * isAsset=true  → long-term lending (asset account)
 * isAsset=false → long-term loan    (liability account)
 *
 * Fee convention:
 *   lend: income lines in the same entry = interest received
 *   loan: expense lines in the same entry = interest paid
 */
export function classifyEntries(
  journal: JournalEntry[],
  accountId: number,
  isAsset: boolean,
  accountsMap: Map<number, Account>,
): ClassifiedEntry[] {
  const relevant = journal
    .filter((e) => e.lines.some((l) => l.account_id === accountId))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

  let running = 0;
  return relevant.map((entry) => {
    let principalChange = 0;
    let feeAmount = 0;

    // If the entry contains any asset/liability lines besides the loan account
    // itself (e.g. a bank account), those are the real economic counterpart of
    // the principal change. Income/expense lines in the same entry are then
    // unrelated to the loan (e.g. Mercari sale proceeds entered as a compound
    // entry) and must not be mistaken for interest.
    const hasOtherBalanceSheetLine = entry.lines.some((l) => {
      if (l.account_id === accountId) return false;
      const a = accountsMap.get(l.account_id);
      return a && (a.type === "asset" || a.type === "liability");
    });

    for (const line of entry.lines) {
      if (line.account_id === accountId) {
        principalChange += isAsset
          ? line.debit - line.credit
          : line.credit - line.debit;
      } else if (!hasOtherBalanceSheetLine) {
        // Only treat income/expense as fee when the sole counterpart is an
        // income or expense account (i.e. a dedicated interest entry).
        const acct = accountsMap.get(line.account_id);
        if (!acct) continue;
        if (isAsset && acct.type === "income") {
          feeAmount += line.credit - line.debit;
        } else if (!isAsset && acct.type === "expense") {
          feeAmount += line.debit - line.credit;
        }
      }
    }

    const balanceBefore = running;
    running += principalChange;
    return {
      entry,
      principalChange,
      feeAmount,
      balanceBefore,
      balanceAfter: running,
    };
  });
}

/**
 * Annualised implied interest rate for a single payment.
 * Returns null when balance before was zero or fee was zero.
 */
export function impliedAnnualRate(
  feeAmount: number,
  balanceBefore: number,
): number | null {
  if (balanceBefore <= 0 || feeAmount <= 0) return null;
  return (feeAmount / balanceBefore) * 12 * 100;
}

/**
 * Calculate the interest that *should* be paid on a repayment given
 * an annual rate (percent) and the outstanding balance before repayment.
 */
export function calcExpectedInterest(
  balanceBefore: number,
  annualRatePct: number,
): number {
  return Math.round((balanceBefore * annualRatePct) / 100 / 12);
}
