import type { Account, JournalEntry } from "@balance-sheet/shared";
import type { BudgetResetBoundary } from "./budgetFundingCompleteness";
import {
  getAllocatableAssetDelta,
  isEntryAfterBudgetReset,
} from "./budgetFundingCompleteness";

const BUDGET_ALLOCATION_EPSILON = 0.000_001;

export function hasBudgetAllocationMismatch(
  journalAmount: number,
  allocatedAmount: number,
): boolean {
  return Math.abs(journalAmount - allocatedAmount) > BUDGET_ALLOCATION_EPSILON;
}

function normalizedCurrency(currency?: string): string {
  return (currency || "JPY").toUpperCase();
}

function lineCurrencyMatches(lineCurrency: string | undefined, currency: string) {
  return normalizedCurrency(lineCurrency) === normalizedCurrency(currency);
}

function isAllocatableCash(account: Account | undefined): boolean {
  return Boolean(
    account &&
      account.type === "asset" &&
      account.category === "cash" &&
      account.include_in_allocatable !== false &&
      account.is_depreciable !== true,
  );
}

export function getUnallocatedAllocatableIncomeAmount(
  entry: JournalEntry,
  accountMap: Map<number, Account>,
  currency: string,
): number {
  if (
    (entry.income_budget_allocations ?? []).some((allocation) =>
      lineCurrencyMatches(allocation.currency, currency),
    )
  ) {
    return 0;
  }
  const income = entry.lines.reduce((sum, line) => {
    if (!lineCurrencyMatches(line.currency, currency)) return sum;
    if (accountMap.get(line.account_id)?.type !== "income") return sum;
    return sum + line.credit - line.debit;
  }, 0);
  if (income <= BUDGET_ALLOCATION_EPSILON) return 0;
  const allocatableIncrease = getAllocatableAssetDelta(
    entry,
    accountMap,
    currency,
  );
  return Math.max(0, Math.min(income, allocatableIncrease));
}

export function getExcludedCashBudgetConsumptionAmount(
  entry: JournalEntry,
  accountMap: Map<number, Account>,
  currency: string,
  excludedBudgetCategoryId?: number | null,
): number {
  const allocated = -(entry.budget_allocations ?? [])
    .filter(
      (allocation) =>
        allocation.budget_category_id !== excludedBudgetCategoryId &&
        normalizedCurrency(allocation.currency) === normalizedCurrency(currency),
    )
    .reduce((sum, allocation) => sum + allocation.amount, 0);
  if (allocated <= BUDGET_ALLOCATION_EPSILON) return 0;

  const excludedCashOutflow = entry.lines.reduce((sum, line) => {
    if (!lineCurrencyMatches(line.currency, currency)) return sum;
    const account = accountMap.get(line.account_id);
    if (
      !account ||
      account.type !== "asset" ||
      account.category !== "cash" ||
      isAllocatableCash(account)
    ) {
      return sum;
    }
    return sum + line.credit - line.debit;
  }, 0);

  return Math.max(0, Math.min(allocated, excludedCashOutflow));
}

export interface PreResetCreditCardSettlement {
  entry: JournalEntry;
  amount: number;
  credit_card_account_ids: number[];
}

function compareJournalPosition(left: JournalEntry, right: JournalEntry) {
  return (
    left.date.localeCompare(right.date) ||
    left.created_at.localeCompare(right.created_at) ||
    left.id - right.id
  );
}

export function findPreResetCreditCardSettlements(
  journal: JournalEntry[],
  accountMap: Map<number, Account>,
  boundary: BudgetResetBoundary | null,
  currency: string,
): PreResetCreditCardSettlement[] {
  if (!boundary) return [];
  const cardAccountIds = new Set(
    [...accountMap.values()]
      .filter(
        (account) =>
          account.type === "liability" && account.category === "credit_card",
      )
      .map((account) => account.id),
  );
  if (cardAccountIds.size === 0) return [];

  const carryoverByCard = new Map<number, number>();
  const afterReset: JournalEntry[] = [];
  for (const entry of [...journal].sort(compareJournalPosition)) {
    if (isEntryAfterBudgetReset(entry, boundary)) {
      afterReset.push(entry);
      continue;
    }
    for (const line of entry.lines) {
      if (
        !cardAccountIds.has(line.account_id) ||
        !lineCurrencyMatches(line.currency, currency)
      ) {
        continue;
      }
      carryoverByCard.set(
        line.account_id,
        (carryoverByCard.get(line.account_id) ?? 0) +
          line.credit -
          line.debit,
      );
    }
  }

  const result: PreResetCreditCardSettlement[] = [];
  for (const entry of afterReset) {
    let cashOutflow = Math.max(
      -getAllocatableAssetDelta(entry, accountMap, currency),
      0,
    );
    const settledCardIds: number[] = [];
    let settledAmount = 0;

    for (const line of entry.lines) {
      if (
        !cardAccountIds.has(line.account_id) ||
        !lineCurrencyMatches(line.currency, currency)
      ) {
        continue;
      }
      const cardReduction = Math.max(line.debit - line.credit, 0);
      const carryover = Math.max(carryoverByCard.get(line.account_id) ?? 0, 0);
      const oldPeriodReduction = Math.min(cardReduction, carryover);
      if (oldPeriodReduction <= BUDGET_ALLOCATION_EPSILON) continue;

      const cashSettlement = Math.min(
        oldPeriodReduction,
        Math.max(cashOutflow, 0),
      );
      if (cashSettlement > BUDGET_ALLOCATION_EPSILON) {
        settledAmount += cashSettlement;
        cashOutflow -= cashSettlement;
        settledCardIds.push(line.account_id);
      }
      carryoverByCard.set(line.account_id, carryover - oldPeriodReduction);
    }

    if (settledAmount > BUDGET_ALLOCATION_EPSILON) {
      result.push({
        entry,
        amount: settledAmount,
        credit_card_account_ids: settledCardIds,
      });
    }
  }

  return result;
}
