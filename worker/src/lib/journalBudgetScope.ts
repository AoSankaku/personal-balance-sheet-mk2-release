import { inArray } from "drizzle-orm";
import { isBudgetAccount, isBudgetAsset } from "../../../shared/budgetScope";
import { calculateJournalIncomeBudgetImpact } from "../../../shared/journalIncomeBudget";
import { createDb } from "../db";
import { accounts } from "../db/schema";
import { splitAmountByLargestRemainder } from "./budgetFundingImpact";
import { fromStorageMoneyAmount, moneyScale, toStorageMoneyAmount, type MoneyScaleOptions } from "./moneyValidation";

interface Allocation { budget_category_id: number; amount: number; currency?: string; is_reference?: boolean }
interface BudgetEntryInput {
  is_currency_exchange?: boolean;
  lines: { account_id: number; debit?: number; credit?: number; currency?: string }[];
  budget_allocations?: Allocation[];
  income_budget_allocations?: { budget_category_id: number; amount: number; currency?: string; adjustment_type?: string }[];
  income_transfer_destinations?: { budget_category_id: number; from_account_id: number; amount: number; currency?: string }[];
}

/** Canonicalize budget effects from actual financial sources, never a trusted UI flag. */
export async function normalizeJournalBudgetScope(
  db: ReturnType<typeof createDb>, body: BudgetEntryInput, scale: MoneyScaleOptions,
): Promise<string | null> {
  const rows = await db.select().from(accounts).where(inArray(accounts.id, [...new Set(body.lines.map((line) => line.account_id))]));
  const byId = new Map(rows.map((account) => [account.id, account]));
  if (body.is_currency_exchange && rows.some((account) => account.type !== "asset" && account.type !== "liability")) {
    return "Currency exchange accounts must be assets or liabilities";
  }
  const defaultCurrency = (body.lines[0]?.currency || "JPY").toUpperCase();
  const currencies = new Set(body.lines.map((line) => (line.currency || "JPY").toUpperCase()));
  const normalized: Allocation[] = [];
  for (const currency of currencies) {
    const lines = body.lines.filter((line) => (line.currency || "JPY").toUpperCase() === currency);
    let expense = 0;
    for (const line of lines) {
      const account = byId.get(line.account_id);
      if (!account) return "Unknown journal account";
      const delta = (line.debit ?? 0) - (line.credit ?? 0);
      if (account.type === "expense") expense += delta;
    }
    const allocations = (body.budget_allocations ?? []).filter((allocation) => (allocation.currency || defaultCurrency).toUpperCase() === currency);
    const distributions = (body.income_budget_allocations ?? []).filter((allocation) => allocation.adjustment_type !== "transfer" && (allocation.currency || defaultCurrency).toUpperCase() === currency);
    const transferTasks = (body.income_transfer_destinations ?? []).filter((task) => (task.currency || defaultCurrency).toUpperCase() === currency);
    // Recognizing receivable/noncash income is valid accounting, but cannot
    // distribute cash that has not crossed the budget boundary. Gross income
    // and an expense paid from the same tracked receipt remain independent.
    const incomeImpact = calculateJournalIncomeBudgetImpact({
      lines,
      accounts: rows,
      currency,
      decimalPlaces: moneyScale(currency, scale),
    });
    const income = lines.reduce((sum, line) => byId.get(line.account_id)?.type === "income"
      ? sum + (line.credit ?? 0) - (line.debit ?? 0) : sum, 0);
    if (incomeImpact.excludedCash !== 0 && income !== 0 && expense !== 0 && (allocations.length || distributions.length)) {
      return "Ambiguous budget sources: record tracked and untracked income/expenses separately";
    }
    const incomeDirection = income < 0 ? -1 : 1;
    const incomeCapacity = incomeImpact.incomeCapacity;
    if (distributions.some((allocation) => allocation.amount * incomeDirection < 0)) {
      return "Income budget allocations must match the income or cancellation direction";
    }
    if (distributions.reduce((sum, allocation) => sum + Math.abs(allocation.amount), 0) > incomeCapacity + 1e-9) {
      return "Income budget allocations exceed income received inside the budget boundary";
    }
    const transferCapacity = incomeImpact.isInvestmentSale
      ? incomeImpact.totalCapacity
      : income > 0
        ? incomeCapacity
        : 0;
    if (transferTasks.some((task) => task.amount <= 0) || transferTasks.reduce((sum, task) => sum + task.amount, 0) > transferCapacity + 1e-9) {
      return "Income transfer destinations exceed income received inside the budget boundary";
    }
    if (incomeImpact.isInvestmentSale) {
      const principalAllocations = (body.income_budget_allocations ?? []).filter(
        allocation => allocation.adjustment_type === "transfer" &&
          (allocation.currency || defaultCurrency).toUpperCase() === currency,
      );
      if (principalAllocations.some(allocation => allocation.amount < 0) ||
          principalAllocations.reduce((sum, allocation) => sum + allocation.amount, 0) > incomeImpact.investmentReturnCapacity + 1e-9) {
        return "Investment principal allocations exceed returned principal";
      }
      if (transferTasks.some(task =>
        task.amount > (incomeImpact.trackedCashInflowByAccount[task.from_account_id] ?? 0) + 1e-9)) {
        return "Income transfer destination source must receive tracked cash in this entry";
      }
      const allocatableByCategory = new Map<number, number>();
      for (const allocation of body.income_budget_allocations ?? []) {
        if ((allocation.currency || defaultCurrency).toUpperCase() !== currency || allocation.amount <= 0) continue;
        allocatableByCategory.set(allocation.budget_category_id,
          (allocatableByCategory.get(allocation.budget_category_id) ?? 0) + allocation.amount);
      }
      const taskAmountsByCategory = new Map<number, number>();
      const taskAmountsBySource = new Map<number, number>();
      for (const task of transferTasks) {
        taskAmountsByCategory.set(task.budget_category_id,
          (taskAmountsByCategory.get(task.budget_category_id) ?? 0) + task.amount);
        taskAmountsBySource.set(task.from_account_id,
          (taskAmountsBySource.get(task.from_account_id) ?? 0) + task.amount);
      }
      if ([...taskAmountsBySource].some(([accountId, amount]) =>
        amount > (incomeImpact.trackedCashInflowByAccount[accountId] ?? 0) + 1e-9)) {
        return "Income transfer destinations exceed tracked cash received from their source account";
      }
      if ([...taskAmountsByCategory].some(([categoryId, amount]) =>
        amount > (allocatableByCategory.get(categoryId) ?? 0) + 1e-9)) {
        return "Income transfer destinations exceed the allocation for their budget category";
      }
    }
    if (!allocations.length) continue;
    const active = allocations.filter((allocation) => !allocation.is_reference);
    const references = allocations.filter((allocation) => allocation.is_reference);
    // For one-sided expenses/refunds, explicit allocations apply up to the tracked
    // portion; the excluded remainder stays visible solely as reference history.
    const hasExcludedSource = (expense > 0 && incomeImpact.excludedCash < 0) || (expense < 0 && incomeImpact.excludedCash > 0);
    if (!hasExcludedSource) {
      // A one-sided tracked expense/refund cannot distribute more than its
      // actual amount. Keep compound expenses/refunds and noncash flows separate.
      const expenseDirection = Math.sign(expense);
      const isTrackedExpense = expense !== 0 && lines.every((line) => {
        const account = byId.get(line.account_id)!;
        const delta = (line.debit ?? 0) - (line.credit ?? 0);
        if (delta === 0) return true;
        return account.type === "expense"
          ? Math.sign(delta) === expenseDirection
          : isBudgetAccount(account);
      });
      if (isTrackedExpense) {
        if (active.some((allocation) => allocation.amount !== 0 && Math.sign(allocation.amount) !== -expenseDirection)) {
          return "Budget allocation direction does not match the expense or refund";
        }
        const expenseUnits = lines.reduce((sum, line) => byId.get(line.account_id)!.type === "expense"
          ? sum + toStorageMoneyAmount(line.debit ?? 0, currency, scale) - toStorageMoneyAmount(line.credit ?? 0, currency, scale)
          : sum, 0);
        const allocatedUnits = active.reduce((sum, allocation) => sum + Math.abs(toStorageMoneyAmount(allocation.amount, currency, scale)), 0);
        if (allocatedUnits > Math.abs(expenseUnits)) {
          return "Budget allocations exceed the expense or refund amount";
        }
      }
      normalized.push(...allocations);
      continue;
    }
    if (active.some((allocation) => allocation.amount !== 0 && Math.sign(allocation.amount) !== -Math.sign(expense))) {
      return "Budget allocation direction does not match the expense or refund";
    }
    const units = active.map((allocation) => Math.abs(toStorageMoneyAmount(allocation.amount, currency, scale)));
    const total = units.reduce((sum, amount) => sum + amount, 0);
    const capacity = toStorageMoneyAmount(Math.max(0, Math.abs(expense) - Math.abs(incomeImpact.excludedCash)), currency, scale);
    const portions = splitAmountByLargestRemainder(Math.min(total, capacity), units.map((weight, index) => ({ key: index, weight })));
    normalized.push(...references);
    active.forEach((allocation, index) => {
      const applied = portions[index]?.amount ?? 0;
      const sign = Math.sign(allocation.amount);
      if (applied) normalized.push({ ...allocation, currency, amount: fromStorageMoneyAmount(sign * applied, currency, scale), is_reference: false });
      const reference = units[index]! - applied;
      if (reference) normalized.push({ ...allocation, currency, amount: fromStorageMoneyAmount(sign * reference, currency, scale), is_reference: true });
    });
  }
  // Explicit foreign-currency allocations cannot silently disappear on an entry
  // that has no corresponding financial currency.
  if ([...(body.budget_allocations ?? []), ...(body.income_budget_allocations ?? []), ...(body.income_transfer_destinations ?? [])].some((allocation) => allocation.currency && !currencies.has(allocation.currency.toUpperCase()))) {
    return "Budget allocation currency must exist in journal lines";
  }
  if (body.budget_allocations) body.budget_allocations = normalized;
  if (body.lines.some((line) => !byId.has(line.account_id))) return "Unknown journal account";
  return null;
}
