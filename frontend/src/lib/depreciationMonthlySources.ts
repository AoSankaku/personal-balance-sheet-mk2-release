import type {
  AccountBudgetRatio,
  DepreciationBudgetSourceAllocation,
  DepreciationBudgetSettings,
} from "@balance-sheet/shared";
import { resolveDepreciationMonthlySourceAllocations } from "@balance-sheet/shared";

export interface DepreciationMonthlySourceCategory {
  id: number;
  is_archived?: boolean;
}

/**
 * Freeze the expense account's current budget split for a newly created plan.
 * Categories without an account ratio remain available as zero-share editor
 * rows; the remainder is assigned to unallocated funds.
 */
export function buildDepreciationMonthlySourceDefaults(
  categories: readonly DepreciationMonthlySourceCategory[],
  accountRatios: readonly AccountBudgetRatio[] = [],
): DepreciationBudgetSourceAllocation[] {
  const ratios = new Map<number, number>();
  for (const item of accountRatios) {
    ratios.set(
      item.budget_category_id,
      (ratios.get(item.budget_category_id) ?? 0) + item.ratio,
    );
  }

  const activeAllocations: DepreciationBudgetSourceAllocation[] = categories
    .filter((category) => !category.is_archived)
    .map((category) => ({
      budget_category_id: category.id,
      ratio: ratios.get(category.id) ?? 0,
    }))
    .sort((left, right) => left.budget_category_id - right.budget_category_id);
  const total = activeAllocations.reduce((sum, item) => sum + item.ratio, 0);
  const positiveAllocations = activeAllocations.filter((item) => item.ratio > 0);
  const remainder = 100 - total;
  if (remainder > 0) {
    positiveAllocations.push({ budget_category_id: null, ratio: remainder });
  }
  return positiveAllocations;
}

/** Use account defaults only when the saved settings have no source snapshot. */
export function getDepreciationMonthlySourceAllocations(
  settings: DepreciationBudgetSettings | null | undefined,
  categories: readonly DepreciationMonthlySourceCategory[],
  accountRatios: readonly AccountBudgetRatio[] = [],
): DepreciationBudgetSourceAllocation[] {
  if (
    settings?.monthly_source_allocations !== undefined ||
    settings?.monthly_source_category_id != null
  ) {
    return resolveDepreciationMonthlySourceAllocations(settings ?? {});
  }
  return buildDepreciationMonthlySourceDefaults(categories, accountRatios);
}

/** Ensure newly submitted scheduled methods persist the displayed source split. */
export function snapshotDepreciationMonthlySourceSettings(
  settings: DepreciationBudgetSettings,
  categories: readonly DepreciationMonthlySourceCategory[],
  accountRatios: readonly AccountBudgetRatio[] = [],
): DepreciationBudgetSettings {
  if (settings.method === "unallocated") return settings;
  const allocations = getDepreciationMonthlySourceAllocations(
    settings,
    categories,
    accountRatios,
  );
  const legacySourceId = allocations.find(
    (allocation) => allocation.budget_category_id != null && allocation.ratio > 0,
  )?.budget_category_id ?? null;
  return {
    ...settings,
    monthly_source_allocations: allocations,
    monthly_source_category_id: legacySourceId,
  };
}

/** Match the worker's prorated monthly schedule using the configured currency scale. */
export function calculateFirstDepreciationMonthAmount(input: {
  totalAmount: number;
  months: number;
  purchaseDate: string;
  decimalPlaces: number;
}): number {
  return calculateDepreciationMonthlyAmounts(input)[0] ?? 0;
}

export function calculateDepreciationMonthlyAmounts(input: {
  totalAmount: number;
  months: number;
  purchaseDate: string;
  decimalPlaces: number;
}): number[] {
  const { totalAmount, months, purchaseDate } = input;
  const decimalPlaces = Math.max(0, Math.min(12, input.decimalPlaces));
  const scale = 10 ** decimalPlaces;
  const totalMinor = Math.round(totalAmount * scale);
  if (!Number.isFinite(totalMinor) || totalMinor <= 0) return [];
  if (months <= 1) return [totalMinor / scale];

  const [year, month, day] = purchaseDate.split("-").map(Number);
  if (!year || !month || !day) {
    const full = Math.floor(totalMinor / months);
    const amounts = Array<number>(months).fill(full);
    amounts[0] = (amounts[0] ?? 0) + totalMinor - full * months;
    return amounts.map((amount) => amount / scale);
  }
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeight = (daysInMonth - day + 1) / daysInMonth;
  const fullWeight = firstWeight + months - 1;
  const weights = [firstWeight, ...Array<number>(months - 1).fill(1)];
  const amounts = weights.map((weight) => Math.floor((totalMinor * weight) / fullWeight));
  const allocated = amounts.reduce((sum, amount) => sum + amount, 0);
  amounts[0] = (amounts[0] ?? 0) + (totalMinor - allocated);
  return amounts.map((amount) => amount / scale);
}

/** Mirror the worker's total target apportionment and month-number tie break. */
export function calculateBudgetedDepreciationMonthlyAmounts(input: {
  monthlyAmounts: readonly number[];
  budgetedPurchaseAmount: number;
  depreciationTotal: number;
  decimalPlaces: number;
}): number[] {
  const scale = 10 ** Math.max(0, Math.min(12, input.decimalPlaces));
  const monthlyMinor = input.monthlyAmounts.map((amount) => Math.max(0, Math.round(amount * scale)));
  const totalDepreciationMinor = monthlyMinor.reduce((sum, amount) => sum + amount, 0);
  const depreciationTotalMinor = Math.round(input.depreciationTotal * scale);
  const targetMinor = Math.round(input.budgetedPurchaseAmount * scale);
  if (depreciationTotalMinor <= 0 || totalDepreciationMinor <= 0 || targetMinor <= 0) {
    return monthlyMinor.map(() => 0);
  }
  const depreciableTargetMinor = Math.floor(
    (targetMinor * Math.min(totalDepreciationMinor, depreciationTotalMinor)) /
      depreciationTotalMinor,
  );
  const portions = monthlyMinor.map((weight, index) => {
    const exact = (depreciableTargetMinor * weight) / totalDepreciationMinor;
    const amount = Math.floor(exact);
    return { index, amount, remainder: exact - amount };
  });
  let remainder = depreciableTargetMinor - portions.reduce((sum, portion) => sum + portion.amount, 0);
  const remainderOrder = [...portions].sort(
    (left, right) => right.remainder - left.remainder || left.index - right.index,
  );
  for (let index = 0; remainder > 0; index++, remainder--) {
    remainderOrder[index % remainderOrder.length]!.amount++;
  }
  return portions.map((portion) => portion.amount / scale);
}
