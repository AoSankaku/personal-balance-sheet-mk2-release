import type { Account, CreateJournalInput } from "@balance-sheet/shared";
import { isBudgetAccount, isBudgetAsset } from "../../../shared/budgetScope";

export type BusinessAdvanceEntryKind = "send" | "recover" | "dispose";

function getCurrencyScale(decimalPlaces: number) {
  const places = Number.isFinite(decimalPlaces)
    ? Math.min(9, Math.max(0, Math.trunc(decimalPlaces)))
    : 0;
  return 10 ** places;
}

export function toCurrencyMinorUnits(amount: number, decimalPlaces: number) {
  const scale = getCurrencyScale(decimalPlaces);
  return Math.round((amount + Number.EPSILON) * scale);
}

export function fromCurrencyMinorUnits(amount: number, decimalPlaces: number) {
  return amount / getCurrencyScale(decimalPlaces);
}

export function sumCurrencyBalance(
  lines: readonly { debit: number; credit: number }[],
  decimalPlaces: number,
) {
  const minorUnits = lines.reduce(
    (total, line) =>
      total +
      toCurrencyMinorUnits(line.debit, decimalPlaces) -
      toCurrencyMinorUnits(line.credit, decimalPlaces),
    0,
  );
  return fromCurrencyMinorUnits(minorUnits, decimalPlaces);
}

export function requiresExpenseAccountForSimpleEntry(
  entryType: "expense" | "business_advance" | string,
  businessRatio: number,
  depreciationEnabled: boolean,
) {
  if (depreciationEnabled) return false;
  if (entryType === "expense") return true;
  return entryType === "business_advance" && businessRatio < 100;
}

function roundMoney(amount: number, decimalPlaces: number) {
  return fromCurrencyMinorUnits(
    toCurrencyMinorUnits(amount, decimalPlaces),
    decimalPlaces,
  );
}

export function splitBusinessExpenseAmount(
  total: number,
  businessRatio: number,
  decimalPlaces: number,
) {
  const roundedTotal = roundMoney(total, decimalPlaces);
  const ratio = Math.min(100, Math.max(0, businessRatio));
  const businessAmount =
    ratio === 100
      ? roundedTotal
      : roundMoney((roundedTotal * ratio) / 100, decimalPlaces);
  return {
    businessAmount,
    personalAmount: roundMoney(roundedTotal - businessAmount, decimalPlaces),
  };
}

export function buildBusinessAdvanceJournalPayload({
  kind,
  date,
  description,
  amount,
  currency,
  decimalPlaces = 2,
  advanceAccount,
  otherAccount,
  budgetCategoryId,
}: {
  kind: BusinessAdvanceEntryKind;
  date: string;
  description: string;
  amount: number;
  currency: string;
  decimalPlaces?: number;
  advanceAccount: Account;
  /** Source account for sends; receiving asset or loss expense for settlements. */
  otherAccount: Account;
  budgetCategoryId?: number | null;
}): CreateJournalInput {
  if (advanceAccount.type !== "asset" || isBudgetAsset(advanceAccount)) {
    throw new TypeError("Business advance account must be a non-budget asset account");
  }
  if (advanceAccount.id === otherAccount.id) {
    throw new TypeError("Business advance accounts must be different");
  }
  if (
    (kind === "send" &&
      (otherAccount.type !== "asset" || otherAccount.category !== "cash")) ||
    (kind === "recover" && otherAccount.type !== "asset") ||
    (kind === "dispose" && otherAccount.type !== "expense")
  ) {
    throw new TypeError("Business advance entry uses an incompatible account");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new RangeError("Business advance amount must be a positive finite number");
  }

  const normalizedCurrency = currency.toUpperCase();
  const normalizedAmount = roundMoney(amount, decimalPlaces);
  if (normalizedAmount <= 0) {
    throw new RangeError("Business advance amount is below currency precision");
  }

  const advanceLine = {
    account_id: advanceAccount.id,
    debit: 0,
    credit: 0,
    currency: normalizedCurrency,
  };
  const otherLine = {
    account_id: otherAccount.id,
    debit: 0,
    credit: 0,
    currency: normalizedCurrency,
  };

  const lines =
    kind === "send"
      ? [
          { ...advanceLine, debit: normalizedAmount },
          { ...otherLine, credit: normalizedAmount },
        ]
      : [
          { ...otherLine, debit: normalizedAmount },
          { ...advanceLine, credit: normalizedAmount },
        ];

  const budget_allocations =
    kind === "send" && budgetCategoryId != null
      ? [
          {
            budget_category_id: budgetCategoryId,
            amount: -normalizedAmount,
            currency: normalizedCurrency,
            is_reference: !isBudgetAccount(otherAccount),
          },
        ]
      : undefined;

  return {
    date,
    description,
    lines,
    budget_source: "simple",
    ...(budget_allocations ? { budget_allocations } : {}),
  };
}
