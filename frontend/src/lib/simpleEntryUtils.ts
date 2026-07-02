import type {
  Account,
  BudgetFilterStep,
  BudgetFilterStepType,
} from "@balance-sheet/shared";

interface StepAllocationPreview {
  budget_category_id: number;
  name: string;
  amount: number;
  ratio?: number; // only for remainder steps
}

export interface StepPreview {
  step_order: number;
  step_type: BudgetFilterStepType;
  inputAmount: number;
  allocations: StepAllocationPreview[];
  outputAmount: number;
}

export interface BudgetDistributionAllocation {
  budget_category_id: number;
  ratio: number;
  amount?: number;
}

export interface BudgetDistributionSummary {
  totalRatio: number;
  displayRatio: number;
  allocatedAmount: number;
  targetAmount: number;
  isExactAmount: boolean;
  isComplete: boolean;
  isOverAllocated: boolean;
  isUnderAllocated: boolean;
}

export interface AmountDistributionItem {
  amount: number;
}

export interface AmountDistributionSummary {
  displayRatio: number;
  allocatedAmount: number;
  targetAmount: number;
  isComplete: boolean;
  isOverAllocated: boolean;
  isUnderAllocated: boolean;
}

export interface IncomeDistributionItem {
  budget_category_id: number;
  name: string;
  amount: number;
}

type DistributionRatioDirection = "exact" | "over" | "under";

export function getIncomeDescriptionForSubmit(
  description: string,
  incomeAccount: Pick<Account, "category" | "name"> | undefined,
): string {
  if (description.trim().length > 0) return description;
  return incomeAccount?.category === "salary" ? incomeAccount.name : "";
}

/**
 * Distribute `pool` across `items` by exact ratios, then give leftover yen
 * one-by-one to items with the largest fractional parts (largest remainder method).
 * Returns integer amounts that sum exactly to `pool`.
 */
export function distributeWithLargestRemainder(
  pool: number,
  items: { id: number; exact: number }[],
): Map<number, number> {
  const floors = items.map((item) => ({
    id: item.id,
    floor: Math.floor(item.exact),
    frac: item.exact % 1,
  }));
  let leftover = pool - floors.reduce((s, f) => s + f.floor, 0);
  // Sort by fractional part descending; ties broken by id for determinism
  floors.sort((a, b) => b.frac - a.frac || a.id - b.id);
  for (const f of floors) {
    if (leftover <= 0) break;
    f.floor += 1;
    leftover -= 1;
  }
  return new Map(floors.map((f) => [f.id, f.floor]));
}

export function computeBudgetDistributionAmounts(
  totalAmount: number,
  distribution: BudgetDistributionAllocation[],
): Map<number, number> {
  const base = Math.max(0, Number(totalAmount) || 0);
  const items = distribution
    .filter((item) => item.ratio > 0)
    .map((item) => ({
      id: item.budget_category_id,
      exact: (base * item.ratio) / 100,
    }));
  const pool = Math.round(items.reduce((sum, item) => sum + item.exact, 0));

  return distributeWithLargestRemainder(pool, items);
}

export function buildExpenseBudgetAllocations(
  totalAmount: number,
  distribution: BudgetDistributionAllocation[],
): { budget_category_id: number; amount: number }[] {
  const computedAmounts = computeBudgetDistributionAmounts(
    totalAmount,
    distribution,
  );

  return distribution
    .map((item) => {
      const amount =
        item.amount != null
          ? Math.max(0, Math.round(Number(item.amount) || 0))
          : (computedAmounts.get(item.budget_category_id) ?? 0);

      return {
        budget_category_id: item.budget_category_id,
        amount: -amount,
      };
    })
    .filter((allocation) => allocation.amount < 0);
}

export function summarizeBudgetDistribution(
  totalAmount: number,
  distribution: BudgetDistributionAllocation[],
): BudgetDistributionSummary {
  const base = Math.max(0, Number(totalAmount) || 0);
  const totalRatio = distribution.reduce((sum, item) => sum + item.ratio, 0);
  const computedAmounts = computeBudgetDistributionAmounts(base, distribution);
  const allocatedAmount = distribution.reduce((sum, item) => {
    const amount =
      item.amount != null
        ? Math.max(0, Math.round(Number(item.amount) || 0))
        : (computedAmounts.get(item.budget_category_id) ?? 0);
    return sum + amount;
  }, 0);
  const targetAmount = Math.round((base * totalRatio) / 100);
  const isExactAmount = allocatedAmount === targetAmount;
  const rawDisplayRatio = base > 0 ? (allocatedAmount / base) * 100 : totalRatio;
  const ratioDirection =
    allocatedAmount > targetAmount || totalRatio > 100
      ? "over"
      : allocatedAmount < targetAmount || (totalRatio > 0 && totalRatio < 100)
        ? "under"
        : "exact";
  const displayRatio =
    ratioDirection === "exact"
      ? normalizeDistributionRatio(totalRatio, "exact")
      : normalizeDistributionRatio(rawDisplayRatio, ratioDirection);

  return {
    totalRatio,
    displayRatio,
    allocatedAmount,
    targetAmount,
    isExactAmount,
    isComplete: totalRatio === 100 && allocatedAmount === base,
    isOverAllocated: totalRatio > 100 || allocatedAmount > targetAmount,
    isUnderAllocated:
      (totalRatio > 0 && totalRatio < 100) || allocatedAmount < targetAmount,
  };
}

export function formatBudgetDistributionRatio(ratio: number): string {
  return ratio.toFixed(2);
}

export function summarizeAmountDistribution(
  totalAmount: number,
  distribution: AmountDistributionItem[],
): AmountDistributionSummary {
  const targetAmount = Math.max(0, Math.round(Number(totalAmount) || 0));
  const allocatedAmount = distribution.reduce(
    (sum, item) => sum + Math.max(0, Math.round(Number(item.amount) || 0)),
    0,
  );
  const displayRatio =
    targetAmount > 0
      ? normalizeDistributionRatio(
          (allocatedAmount / targetAmount) * 100,
          allocatedAmount > targetAmount
            ? "over"
            : allocatedAmount < targetAmount
              ? "under"
              : "exact",
        )
      : 0;

  return {
    displayRatio,
    allocatedAmount,
    targetAmount,
    isComplete: allocatedAmount === targetAmount,
    isOverAllocated: allocatedAmount > targetAmount,
    isUnderAllocated: allocatedAmount > 0 && allocatedAmount < targetAmount,
  };
}

function normalizeDistributionRatio(
  ratio: number,
  direction: DistributionRatioDirection,
): number {
  const scaled = ratio * 100;
  if (direction === "over") return Math.ceil(scaled) / 100;
  if (direction === "under") return Math.floor(scaled) / 100;
  return Math.round(scaled) / 100;
}

export function mergeIncomeDistributionDefaults({
  defaultRows,
  currentRows,
  dirtyCategoryIds,
}: {
  defaultRows: IncomeDistributionItem[];
  currentRows: IncomeDistributionItem[];
  dirtyCategoryIds: ReadonlySet<number>;
}): IncomeDistributionItem[] {
  const currentById = new Map(
    currentRows.map((row) => [row.budget_category_id, row]),
  );
  const defaultIds = new Set(defaultRows.map((row) => row.budget_category_id));
  const mergedRows = defaultRows.map((row) => {
    const current = currentById.get(row.budget_category_id);
    return dirtyCategoryIds.has(row.budget_category_id) && current
      ? { ...row, amount: current.amount }
      : row;
  });

  for (const row of currentRows) {
    if (
      dirtyCategoryIds.has(row.budget_category_id) &&
      !defaultIds.has(row.budget_category_id)
    ) {
      mergedRows.push(row);
    }
  }

  return mergedRows;
}

export function computeFilterSteps(
  steps: BudgetFilterStep[],
  totalAmount: number,
  getCatName: (id: number) => string,
): StepPreview[] {
  const result: StepPreview[] = [];
  let remaining = totalAmount;
  for (const step of [...steps].sort((a, b) => a.step_order - b.step_order)) {
    const inputAmount = remaining;
    const allocations: StepAllocationPreview[] = [];
    if (step.step_type === "fixed") {
      for (const alloc of step.allocations) {
        const amt = Math.min(remaining, alloc.amount ?? 0);
        allocations.push({
          budget_category_id: alloc.budget_category_id,
          name: getCatName(alloc.budget_category_id),
          amount: amt,
        });
        remaining -= amt;
      }
    } else if (step.step_type === "capped") {
      const cap = step.allocations.reduce((s, a) => s + (a.amount ?? 0), 0);
      const pool = Math.min(remaining, cap);
      if (cap > 0) {
        const items = step.allocations.map((a) => ({
          id: a.budget_category_id,
          exact: (pool * (a.amount ?? 0)) / cap,
        }));
        const dist = distributeWithLargestRemainder(pool, items);
        for (const alloc of step.allocations) {
          allocations.push({
            budget_category_id: alloc.budget_category_id,
            name: getCatName(alloc.budget_category_id),
            amount: dist.get(alloc.budget_category_id) ?? 0,
            ratio: (alloc.amount ?? 0) / cap,
          });
        }
      }
      remaining -= pool;
    } else if (step.step_type === "remainder") {
      const items = step.allocations.map((a) => ({
        id: a.budget_category_id,
        exact: remaining * (a.ratio ?? 0),
      }));
      const dist = distributeWithLargestRemainder(remaining, items);
      for (const alloc of step.allocations) {
        allocations.push({
          budget_category_id: alloc.budget_category_id,
          name: getCatName(alloc.budget_category_id),
          amount: dist.get(alloc.budget_category_id) ?? 0,
          ratio: alloc.ratio ?? 0,
        });
      }
      remaining = 0;
    }
    result.push({
      step_order: step.step_order,
      step_type: step.step_type,
      inputAmount,
      allocations,
      outputAmount: remaining,
    });
  }
  return result;
}

export function computeFilterPreview(
  steps: BudgetFilterStep[],
  amount: number,
): Record<number, number> {
  const result: Record<number, number> = {};
  let remaining = amount;
  for (const step of [...steps].sort((a, b) => a.step_order - b.step_order)) {
    if (step.step_type === "fixed") {
      for (const alloc of step.allocations) {
        const toAlloc = Math.min(remaining, alloc.amount ?? 0);
        result[alloc.budget_category_id] =
          (result[alloc.budget_category_id] ?? 0) + toAlloc;
        remaining -= toAlloc;
      }
    } else if (step.step_type === "capped") {
      const cap = step.allocations.reduce((s, a) => s + (a.amount ?? 0), 0);
      const pool = Math.min(remaining, cap);
      if (cap > 0) {
        const items = step.allocations.map((a) => ({
          id: a.budget_category_id,
          exact: (pool * (a.amount ?? 0)) / cap,
        }));
        const dist = distributeWithLargestRemainder(pool, items);
        for (const [id, amt] of dist) {
          result[id] = (result[id] ?? 0) + amt;
        }
      }
      remaining -= pool;
    } else if (step.step_type === "remainder") {
      const items = step.allocations.map((a) => ({
        id: a.budget_category_id,
        exact: remaining * (a.ratio ?? 0),
      }));
      const dist = distributeWithLargestRemainder(remaining, items);
      for (const [id, amt] of dist) {
        result[id] = (result[id] ?? 0) + amt;
      }
      remaining = 0;
    }
  }
  return result;
}
