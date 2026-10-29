import type {
  Account,
  BudgetCategory,
  BudgetFilter,
  BudgetFilterStep,
  CreateJournalLineInput,
} from "@balance-sheet/shared";
import { budgetAccountDelta, isBudgetAccount, isBudgetAsset } from "../../../shared/budgetScope";
import { calculateJournalIncomeBudgetImpact } from "../../../shared/journalIncomeBudget";
import {
  buildExpenseBudgetAllocations,
  computeFilterPreview,
  type BudgetDistributionAllocation,
} from "./simpleEntryUtils";
import {
  calculateMultiLineBudgetFundingImpact,
  type FundingImpactComponent,
} from "./multiLineBudgetFunding";

export type BudgetDistributionIssue =
  | "invalid"
  | "unbalanced"
  | "unknown_account"
  | "unsupported"
  | "ambiguous"
  | "funding"
  | "filter_currency"
  | "overallocated"
  | "invalid_category"
  | "unassigned";

export interface BudgetDistributionResult {
  supported: boolean;
  issue?: BudgetDistributionIssue;
  /** Expense consumption is negative; refunds are positive. */
  expense: Record<number, number>;
  /** Income allocation is positive; income reversals are negative. */
  income: Record<number, number>;
  expenseTarget: number;
  incomeTarget: number;
  /** Signed portion not yet assigned to a budget category. */
  expenseUnassigned: number;
  /** Signed portion not yet assigned to a budget category. */
  incomeUnassigned: number;
  /** Signed expense target covered by allocatable cash/card budget scope. */
  expenseActiveTarget: number | null;
  /** Signed expense target covered by excluded/reference cash. */
  expenseReferenceTarget: number | null;
  /** Net change in configured budget resources, as a debit-normal amount. */
  resourceDelta: number;
  fundingComponents: FundingImpactComponent[];
  canApply: boolean;
}

export interface CalculateAccountBudgetDistributionInput {
  account: Account | undefined;
  amount: number;
  direction: "debit" | "credit";
  categories: BudgetCategory[];
  filter?: BudgetFilter | null;
  fallbackCategoryId?: number | null;
  currency: string;
  decimalPlaces: number;
}

export interface CalculateJournalBudgetDistributionInput {
  lines: CreateJournalLineInput[];
  accounts: Account[];
  categories: BudgetCategory[];
  filter?: BudgetFilter | null;
  fallbackCategoryId?: number | null;
  currency: string;
  decimalPlaces: number;
}

function emptyResult(
  supported = false,
  issue?: BudgetDistributionIssue,
): BudgetDistributionResult {
  return {
    supported,
    ...(issue ? { issue } : {}),
    expense: {},
    income: {},
    expenseTarget: 0,
    incomeTarget: 0,
    expenseUnassigned: 0,
    incomeUnassigned: 0,
    expenseActiveTarget: null,
    expenseReferenceTarget: null,
    resourceDelta: 0,
    fundingComponents: [],
    canApply: false,
  };
}

function validCurrencyPrecision(currency: string, decimalPlaces: number): boolean {
  return typeof currency === "string" && currency.trim().length > 0 &&
    currency.trim() === currency &&
    Number.isInteger(decimalPlaces) && decimalPlaces >= 0 && decimalPlaces <= 12;
}

function scaleFor(decimalPlaces: number): number {
  return 10 ** decimalPlaces;
}

function toUnits(amount: number, decimalPlaces: number): number | null {
  if (!Number.isFinite(amount)) return null;
  const scaled = amount * scaleFor(decimalPlaces);
  const units = Math.round(scaled);
  if (!Number.isSafeInteger(units) || Math.abs(scaled - units) > 1e-6) return null;
  return units;
}

function fromUnits(units: number, decimalPlaces: number): number {
  return Number((units / scaleFor(decimalPlaces)).toFixed(decimalPlaces));
}

function isValidCategories(categories: BudgetCategory[]): boolean {
  return Array.isArray(categories) && categories.every((category) => category && Number.isSafeInteger(category.id) && category.id > 0) &&
    new Set(categories.map((category) => category.id)).size === categories.length;
}

function categoryIdsAreKnown(
  ids: number[],
  categories: BudgetCategory[],
): boolean {
  const known = new Set(categories.map((category) => category.id));
  return ids.every((id) => Number.isSafeInteger(id) && known.has(id));
}

function validFallback(
  fallbackCategoryId: number | null | undefined,
  categories: BudgetCategory[],
): boolean {
  return fallbackCategoryId == null || categoryIdsAreKnown([fallbackCategoryId], categories);
}

function sumUnits(amounts: Record<number, number>, decimalPlaces: number): number {
  return Object.values(amounts).reduce((sum, amount) => sum + (toUnits(amount, decimalPlaces) ?? 0), 0);
}

function addAmount(target: Record<number, number>, id: number, amount: number, decimalPlaces: number): void {
  if (amount === 0) return;
  const combined = (toUnits(target[id] ?? 0, decimalPlaces) ?? 0) + (toUnits(amount, decimalPlaces) ?? 0);
  if (combined === 0) delete target[id];
  else target[id] = fromUnits(combined, decimalPlaces);
}

function applyFallback(
  amounts: Record<number, number>,
  target: number,
  fallbackCategoryId: number | null | undefined,
  decimalPlaces: number,
): number {
  const targetUnits = toUnits(target, decimalPlaces) ?? 0;
  const remainderUnits = targetUnits - sumUnits(amounts, decimalPlaces);
  const remainder = fromUnits(remainderUnits, decimalPlaces);
  if (fallbackCategoryId != null && remainderUnits !== 0) {
    addAmount(amounts, fallbackCategoryId, remainder, decimalPlaces);
    return 0;
  }
  return remainder;
}

function expenseAllocationsForAccount(
  account: Account,
  amount: number,
  sign: 1 | -1,
  categories: BudgetCategory[],
  decimalPlaces: number,
): { allocations: Record<number, number>; issue?: BudgetDistributionIssue } {
  const rows: BudgetDistributionAllocation[] = account.budget_ratios ?? [];
  if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== "object")) {
    return { allocations: {}, issue: "invalid" };
  }
  const ids = rows.map((row) => row.budget_category_id);
  if (!categoryIdsAreKnown(ids, categories)) return { allocations: {}, issue: "invalid_category" };
  if (rows.some((row) => !Number.isFinite(row.ratio) || row.ratio < 0)) {
    return { allocations: {}, issue: "invalid" };
  }
  if (rows.reduce((sum, row) => sum + row.ratio, 0) > 100) {
    return { allocations: {}, issue: "overallocated" };
  }

  // Keep ratios literal. The helpers round to minor currency units and do not
  // scale partial account distributions up to 100 percent.
  const rowsWithAmounts = buildExpenseBudgetAllocations(
    amount,
    rows,
    sign,
    decimalPlaces,
  );
  const allocations: Record<number, number> = {};
  for (const row of rowsWithAmounts) addAmount(allocations, row.budget_category_id, row.amount, decimalPlaces);
  return { allocations };
}

function scaledFilterSteps(
  filter: BudgetFilter,
  categories: BudgetCategory[],
  decimalPlaces: number,
): BudgetFilterStep[] | BudgetDistributionIssue {
  if (!filter || !Array.isArray(filter.steps) || filter.steps.some((step) =>
    !step || !Array.isArray(step.allocations) || step.allocations.some((allocation) => !allocation || typeof allocation !== "object"),
  )) return "invalid";
  const ids = filter.steps.flatMap((step) => step.allocations.map((allocation) => allocation.budget_category_id));
  if (!categoryIdsAreKnown(ids, categories)) return "invalid_category";

  const steps: BudgetFilterStep[] = [];
  for (const step of filter.steps) {
    if (!Number.isSafeInteger(step.step_order) || !["fixed", "capped", "remainder"].includes(step.step_type)) return "invalid";
    const allocations = [];
    for (const allocation of step.allocations) {
      if (allocation.amount != null) {
        if (!Number.isFinite(allocation.amount) || allocation.amount < 0) return "invalid";
        const amountUnits = toUnits(allocation.amount, decimalPlaces);
        if (amountUnits == null) return "invalid";
        allocations.push({ ...allocation, amount: amountUnits, ratio: allocation.ratio });
      } else {
        allocations.push({ ...allocation });
      }
      if (allocation.ratio != null && (!Number.isFinite(allocation.ratio) || allocation.ratio < 0)) return "invalid";
      if (allocation.ratio != null && allocation.ratio > 1) return "overallocated";
      if (step.step_type === "remainder" && allocation.ratio == null) return "invalid";
      if (step.step_type !== "remainder" && allocation.amount == null) return "invalid";
    }
    steps.push({ ...step, allocations });
  }
  // The helper is intentionally run in minor units, so fixed/capped amounts
  // and the total share the same unit.
  return steps;
}

function distributeIncome(
  target: number,
  categories: BudgetCategory[],
  filter: BudgetFilter | null | undefined,
  fallbackCategoryId: number | null | undefined,
  currency: string,
  decimalPlaces: number,
): { allocations: Record<number, number>; unassigned: number; issue?: BudgetDistributionIssue } {
  if (!filter && fallbackCategoryId == null) {
    return { allocations: {}, unassigned: target, issue: "unassigned" };
  }
  if (filter && (typeof filter.currency !== "string" || filter.currency.toUpperCase() !== currency.toUpperCase())) {
    return { allocations: {}, unassigned: target, issue: "filter_currency" };
  }

  const allocations: Record<number, number> = {};
  const sign: 1 | -1 = target < 0 ? -1 : 1;
  const amountUnits = toUnits(Math.abs(target), decimalPlaces);
  if (amountUnits == null) return { allocations, unassigned: target, issue: "invalid" };

  if (filter) {
    const steps = scaledFilterSteps(filter, categories, decimalPlaces);
    if (typeof steps === "string") return { allocations, unassigned: target, issue: steps };
    const preview = computeFilterPreview(steps, amountUnits);
    for (const [idText, units] of Object.entries(preview)) {
      const id = Number(idText);
      if (!Number.isSafeInteger(units) || units < 0) return { allocations: {}, unassigned: target, issue: "invalid" };
      const amount = fromUnits(units, decimalPlaces) * sign;
      addAmount(allocations, id, amount, decimalPlaces);
    }
  }

  const allocatedUnits = sumUnits(allocations, decimalPlaces);
  const targetUnits = toUnits(target, decimalPlaces) ?? 0;
  const overBy = sign * (allocatedUnits - targetUnits);
  if (overBy > 0) return { allocations, unassigned: fromUnits(targetUnits - allocatedUnits, decimalPlaces), issue: "overallocated" };
  const unassigned = applyFallback(allocations, target, fallbackCategoryId, decimalPlaces);
  return { allocations, unassigned };
}

function finishResult(
  result: BudgetDistributionResult,
  issue?: BudgetDistributionIssue,
): BudgetDistributionResult {
  const complete = result.expenseUnassigned === 0 && result.incomeUnassigned === 0;
  const overallocated = issue === "overallocated";
  return {
    ...result,
    ...(issue ? { issue } : {}),
    canApply: result.supported && complete && !overallocated,
  };
}

export function calculateAccountBudgetDistribution(
  input: CalculateAccountBudgetDistributionInput,
): BudgetDistributionResult {
  if (!validCurrencyPrecision(input.currency, input.decimalPlaces)) return emptyResult(false, "invalid");
  if (input.direction !== "debit" && input.direction !== "credit") return emptyResult(false, "invalid");
  if (!input.account || !Number.isSafeInteger(input.account.id)) return emptyResult(false, "unknown_account");
  if (input.account.type !== "expense" && input.account.type !== "income") return emptyResult(false, "unsupported");
  if (!isValidCategories(input.categories) || !validFallback(input.fallbackCategoryId, input.categories)) return emptyResult(false, "invalid_category");
  const units = toUnits(input.amount, input.decimalPlaces);
  if (units == null || units <= 0) return emptyResult(false, "invalid");

  const result = emptyResult(true);
  const amount = fromUnits(units, input.decimalPlaces);
  let issue: BudgetDistributionIssue | undefined;
  if (input.account.type === "expense") {
    const target = amount * (input.direction === "debit" ? -1 : 1);
    const distribution = expenseAllocationsForAccount(
      input.account,
      amount,
      input.direction === "debit" ? -1 : 1,
      input.categories,
      input.decimalPlaces,
    );
    if (distribution.issue) return emptyResult(false, distribution.issue);
    result.expenseTarget = target;
    result.expense = distribution.allocations;
    result.expenseUnassigned = applyFallback(result.expense, target, input.fallbackCategoryId, input.decimalPlaces);
    result.expenseActiveTarget = target;
    result.expenseReferenceTarget = 0;
    issue = result.expenseUnassigned === 0 ? undefined : "unassigned";
  } else {
    const target = amount * (input.direction === "credit" ? 1 : -1);
    const distribution = distributeIncome(
      target,
      input.categories,
      input.filter,
      input.fallbackCategoryId,
      input.currency,
      input.decimalPlaces,
    );
    if (distribution.issue === "invalid_category" || distribution.issue === "invalid" || distribution.issue === "filter_currency" || distribution.issue === "overallocated") {
      return emptyResult(false, distribution.issue);
    }
    result.incomeTarget = target;
    result.income = distribution.allocations;
    result.incomeUnassigned = distribution.unassigned;
    issue = distribution.issue ?? (result.incomeUnassigned === 0 ? undefined : "unassigned");
  }
  return finishResult(result, issue);
}

function isExcludedCash(account: Account): boolean {
  return account.type === "asset" && account.category === "cash" && !isBudgetAsset(account);
}

function isSupportedBudgetCounterAccount(account: Account): boolean {
  return isBudgetAsset(account) || (account.type === "liability" && isBudgetAccount(account));
}

function addNetByAccount(map: Map<number, number>, line: CreateJournalLineInput, units: number): void {
  map.set(line.account_id, (map.get(line.account_id) ?? 0) + units);
}

export function calculateJournalBudgetDistribution(
  input: CalculateJournalBudgetDistributionInput,
): BudgetDistributionResult {
  if (!validCurrencyPrecision(input.currency, input.decimalPlaces)) return emptyResult(false, "invalid");
  if (!Array.isArray(input.lines) || !Array.isArray(input.accounts)) return emptyResult(false, "invalid");
  if (!isValidCategories(input.categories) || !validFallback(input.fallbackCategoryId, input.categories)) return emptyResult(false, "invalid_category");
  if (input.lines.length < 2 || input.accounts.length === 0) return emptyResult(false, "invalid");
  if (input.accounts.some((account) => !account || !Number.isSafeInteger(account.id) || account.id <= 0)) return emptyResult(false, "invalid");

  const accountsById = new Map(input.accounts.map((account) => [account.id, account]));
  if (accountsById.size !== input.accounts.length) return emptyResult(false, "invalid");
  const normalizedLines: CreateJournalLineInput[] = [];
  let debitUnits = 0;
  let creditUnits = 0;
  for (const line of input.lines) {
    if (!line || typeof line !== "object") return emptyResult(false, "invalid");
    const account = accountsById.get(line.account_id);
    if (!account) return emptyResult(false, "unknown_account");
    if (line.currency != null && (typeof line.currency !== "string" || line.currency.toUpperCase() !== input.currency.toUpperCase())) {
      return emptyResult(false, "unsupported");
    }
    const debit = toUnits(line.debit, input.decimalPlaces);
    const credit = toUnits(line.credit, input.decimalPlaces);
    if (debit == null || credit == null || debit < 0 || credit < 0 || (debit > 0 && credit > 0)) {
      return emptyResult(false, "invalid");
    }
    debitUnits += debit;
    creditUnits += credit;
    if (!Number.isSafeInteger(debitUnits) || !Number.isSafeInteger(creditUnits)) return emptyResult(false, "invalid");
    normalizedLines.push({ ...line, debit: fromUnits(debit, input.decimalPlaces), credit: fromUnits(credit, input.decimalPlaces), currency: input.currency });
  }
  if (debitUnits !== creditUnits) return emptyResult(false, "unbalanced");
  if (debitUnits === 0) return emptyResult(false, "invalid");
  const effectiveLines = normalizedLines.filter((line) => line.debit !== 0 || line.credit !== 0);
  if (effectiveLines.length < 2) return emptyResult(false, "invalid");

  const resourceDelta = fromUnits(budgetAccountDelta(effectiveLines, input.accounts, input.currency) * scaleFor(input.decimalPlaces), input.decimalPlaces);
  const funding = calculateMultiLineBudgetFundingImpact({
    lines: effectiveLines,
    accounts: input.accounts,
    currency: input.currency,
    decimalPlaces: input.decimalPlaces,
  });
  if (funding.components.length > 0) {
    return {
      ...emptyResult(false, "funding"),
      resourceDelta,
      fundingComponents: funding.components,
    };
  }

  const touched = new Set(effectiveLines.map((line) => line.account_id));
  const expenseUnitsByAccount = new Map<number, number>();
  const incomeUnitsByAccount = new Map<number, number>();
  const netUnitsByAccount = new Map<number, number>();
  let excludedCashUnits = 0;
  let hasExcludedCashActivity = false;
  for (const line of effectiveLines) {
    const debit = toUnits(line.debit, input.decimalPlaces)!;
    const credit = toUnits(line.credit, input.decimalPlaces)!;
    const delta = debit - credit;
    const account = accountsById.get(line.account_id)!;
    addNetByAccount(netUnitsByAccount, line, delta);
    if (account.type === "expense") addNetByAccount(expenseUnitsByAccount, line, delta);
    if (account.type === "income") addNetByAccount(incomeUnitsByAccount, line, -delta);
    if (isExcludedCash(account)) {
      excludedCashUnits += delta;
      hasExcludedCashActivity ||= debit !== 0 || credit !== 0;
    }
  }

  const expenseRawUnits = [...expenseUnitsByAccount.values()].reduce((sum, units) => sum + units, 0);
  const incomeRawUnits = [...incomeUnitsByAccount.values()].reduce((sum, units) => sum + units, 0);
  const hasExpense = effectiveLines.some((line) => {
    const account = accountsById.get(line.account_id)!;
    return account.type === "expense" && (line.debit > 0 || line.credit > 0);
  });
  const hasIncome = incomeRawUnits !== 0;
  const hasInvestment = [...touched].some((id) => {
    const account = accountsById.get(id)!;
    return account.type === "asset" && account.category === "investment";
  });
  const incomeImpact = calculateJournalIncomeBudgetImpact({
    lines: effectiveLines,
    accounts: input.accounts,
    currency: input.currency,
    decimalPlaces: input.decimalPlaces,
  });

  if (hasInvestment) {
    const saleAccountsOnly = [...touched].every((id) => {
      const account = accountsById.get(id)!;
      return (account.type === "asset" && (account.category === "cash" || account.category === "investment")) ||
        account.type === "income" ||
        (account.type === "expense" && account.category === "investment_loss");
    });
    if (!saleAccountsOnly || !incomeImpact.isInvestmentSale) return emptyResult(false, "unsupported");
    const result = emptyResult(true);
    result.incomeTarget = incomeImpact.totalCapacity;
    result.expenseTarget = 0;
    result.income = {};
    const distribution = distributeIncome(
      result.incomeTarget,
      input.categories,
      input.filter,
      input.fallbackCategoryId,
      input.currency,
      input.decimalPlaces,
    );
    if (distribution.issue === "invalid_category" || distribution.issue === "invalid" || distribution.issue === "filter_currency" || distribution.issue === "overallocated") {
      return { ...emptyResult(false, distribution.issue), resourceDelta };
    }
    result.income = distribution.allocations;
    result.incomeUnassigned = distribution.unassigned;
    result.resourceDelta = resourceDelta;
    result.expenseActiveTarget = 0;
    result.expenseReferenceTarget = 0;
    return finishResult(result, distribution.issue ?? (result.incomeUnassigned === 0 ? undefined : "unassigned"));
  }

  const hasExcludedReferenceSource =
    (expenseRawUnits > 0 && excludedCashUnits < 0) ||
    (expenseRawUnits < 0 && excludedCashUnits > 0);
  const hasPositiveExpenseNet = [...expenseUnitsByAccount.values()].some((units) => units > 0);
  const hasNegativeExpenseNet = [...expenseUnitsByAccount.values()].some((units) => units < 0);
  if (hasExcludedReferenceSource && hasPositiveExpenseNet && hasNegativeExpenseNet) {
    return { ...emptyResult(false, "ambiguous"), resourceDelta };
  }

  if (hasExpense && hasIncome && hasExcludedCashActivity) {
    return { ...emptyResult(false, "ambiguous"), resourceDelta };
  }

  const allTouchedSupported = [...touched].every((id) => {
    const account = accountsById.get(id)!;
    return account.type === "expense" || account.type === "income" || isExcludedCash(account) || isSupportedBudgetCounterAccount(account);
  });
  if (!allTouchedSupported) return emptyResult(false, "unsupported");

  const zeroNetExpenseReclassification = hasExpense && !hasIncome && expenseRawUnits === 0 &&
    [...touched].every((id) => accountsById.get(id)!.type === "expense");
  if ((hasExpense || hasIncome) && !zeroNetExpenseReclassification && ![...touched].some((id) => {
    const account = accountsById.get(id)!;
    return isExcludedCash(account) || isSupportedBudgetCounterAccount(account);
  })) return { ...emptyResult(false, "unsupported"), resourceDelta };

  if (!hasExpense && !hasIncome) {
    const allTrackedBudgetAccounts = [...touched].every((id) => isSupportedBudgetCounterAccount(accountsById.get(id)!));
    if (!allTrackedBudgetAccounts || resourceDelta !== 0) return emptyResult(false, "unsupported");
    const result = emptyResult(true);
    result.resourceDelta = resourceDelta;
    result.expenseActiveTarget = 0;
    result.expenseReferenceTarget = 0;
    return finishResult(result);
  }

  const result = emptyResult(true);
  result.resourceDelta = resourceDelta;
  result.expenseTarget = fromUnits(-expenseRawUnits, input.decimalPlaces);
  result.incomeTarget = hasIncome
    ? Math.sign(incomeRawUnits) * (incomeImpact.isInvestmentSale ? incomeImpact.totalCapacity : incomeImpact.incomeCapacity)
    : 0;

  for (const [accountId, netUnits] of expenseUnitsByAccount) {
    if (netUnits === 0) continue;
    const account = accountsById.get(accountId)!;
    const target = fromUnits(-netUnits, input.decimalPlaces);
    const distribution = expenseAllocationsForAccount(
      account,
      fromUnits(Math.abs(netUnits), input.decimalPlaces),
      target < 0 ? -1 : 1,
      input.categories,
      input.decimalPlaces,
    );
    if (distribution.issue) return { ...emptyResult(false, distribution.issue), resourceDelta };
    for (const [idText, amount] of Object.entries(distribution.allocations)) addAmount(result.expense, Number(idText), amount, input.decimalPlaces);
  }
  result.expenseUnassigned = applyFallback(result.expense, result.expenseTarget, input.fallbackCategoryId, input.decimalPlaces);

  if (result.incomeTarget !== 0) {
    const distribution = distributeIncome(
      result.incomeTarget,
      input.categories,
      input.filter,
      input.fallbackCategoryId,
      input.currency,
      input.decimalPlaces,
    );
    if (distribution.issue === "invalid_category" || distribution.issue === "invalid" || distribution.issue === "filter_currency" || distribution.issue === "overallocated") {
      return { ...emptyResult(false, distribution.issue), resourceDelta };
    }
    result.income = distribution.allocations;
    result.incomeUnassigned = distribution.unassigned;
  } else if (hasIncome && !input.filter && input.fallbackCategoryId == null) {
    // All-excluded cash income has zero budget capacity and requires no split.
    result.incomeUnassigned = 0;
  }

  const expenseTargetUnits = toUnits(result.expenseTarget, input.decimalPlaces)!;
  const excludedSpendUnits = hasExcludedReferenceSource ? Math.abs(excludedCashUnits) : 0;
  const activeUnits = Math.sign(expenseTargetUnits) * Math.max(0, Math.abs(expenseTargetUnits) - excludedSpendUnits);
  const referenceUnits = expenseTargetUnits - activeUnits;
  result.expenseActiveTarget = fromUnits(activeUnits, input.decimalPlaces);
  result.expenseReferenceTarget = fromUnits(referenceUnits, input.decimalPlaces);
  const issue = result.expenseUnassigned !== 0 || result.incomeUnassigned !== 0 ? "unassigned" : undefined;
  return finishResult(result, issue);
}
