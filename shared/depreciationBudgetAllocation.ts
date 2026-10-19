import type {
  DepreciationBudgetSourceAllocation,
} from "./depreciationBudget";

const TOTAL_RATIO_TOLERANCE = 1e-6;

export type DepreciationBudgetSourceValue = {
  monthly_source_category_id?: number | null;
  monthly_source_allocations?: DepreciationBudgetSourceAllocation[];
};

function compareAllocations(
  left: DepreciationBudgetSourceAllocation,
  right: DepreciationBudgetSourceAllocation,
): number {
  if (left.budget_category_id == null) return right.budget_category_id == null ? 0 : 1;
  if (right.budget_category_id == null) return -1;
  return left.budget_category_id - right.budget_category_id;
}

/**
 * Resolve a saved allocation snapshot. A missing array is the legacy format,
 * where the old category field represents a 100% allocation. An explicitly
 * present array always takes precedence over that field.
 */
export function resolveDepreciationMonthlySourceAllocations(
  value: DepreciationBudgetSourceValue,
): DepreciationBudgetSourceAllocation[] {
  if (value?.monthly_source_allocations !== undefined) {
    if (!Array.isArray(value.monthly_source_allocations)) return [];
    if (value.monthly_source_allocations.some((allocation) =>
      !allocation || typeof allocation !== "object" || Array.isArray(allocation),
    )) {
      // Preserve malformed entries for validation to reject without throwing
      // while decoding untrusted API JSON.
      return value.monthly_source_allocations;
    }
    return value.monthly_source_allocations
      .map((allocation) => ({
        budget_category_id: allocation?.budget_category_id,
        ratio: allocation?.ratio,
      }))
      .sort(compareAllocations);
  }
  const legacyCategoryId = value?.monthly_source_category_id ?? null;
  return legacyCategoryId == null
    ? []
    : [{ budget_category_id: legacyCategoryId, ratio: 100 }];
}

/** Validate the shape, uniqueness, and total of an explicit allocation array. */
export function validateDepreciationMonthlySourceAllocations(
  value: unknown,
): string | null {
  if (!Array.isArray(value) || value.length === 0) {
    return "invalid_monthly_source_allocations";
  }
  const seen = new Set<number | null>();
  let total = 0;
  for (const allocation of value as unknown[]) {
    if (!allocation || typeof allocation !== "object" || Array.isArray(allocation)) {
      return "invalid_monthly_source_allocations";
    }
    const candidate = allocation as Partial<DepreciationBudgetSourceAllocation>;
    const id = candidate.budget_category_id;
    if (id !== null && (!Number.isSafeInteger(id) || (id as number) <= 0)) {
      return "invalid_monthly_source_allocations";
    }
    const ratio = candidate.ratio;
    if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0 || ratio > 100) {
      return "invalid_monthly_source_allocations";
    }
    if (seen.has(id as number | null)) return "invalid_monthly_source_allocations";
    seen.add(id as number | null);
    total += ratio;
  }
  return Math.abs(total - 100) <= TOTAL_RATIO_TOLERANCE
    ? null
    : "monthly_source_ratios_must_total_100";
}

/**
 * Split integer currency minor units by largest remainder. Category IDs break
 * equal remainders in ascending order, with the unallocated portion last.
 */
export function splitDepreciationMonthlySourceAllocations(
  minorUnits: number,
  allocations: readonly DepreciationBudgetSourceAllocation[],
): Array<DepreciationBudgetSourceAllocation & { amount: number }> {
  if (!Number.isFinite(minorUnits) || minorUnits < 0) {
    throw new RangeError("minorUnits must be a finite non-negative amount");
  }
  if (validateDepreciationMonthlySourceAllocations(allocations)) {
    throw new TypeError("allocations must be a valid 100% distribution");
  }
  const total = Math.round(minorUnits);
  const ordered = allocations.map((allocation) => ({ ...allocation })).sort(compareAllocations);
  const ratioTotal = ordered.reduce((sum, allocation) => sum + allocation.ratio, 0);
  const portions = ordered.map((allocation) => {
    const exact = (total * allocation.ratio) / ratioTotal;
    const amount = Math.floor(exact);
    return { ...allocation, amount, remainder: exact - amount };
  });
  let remainder = total - portions.reduce((sum, portion) => sum + portion.amount, 0);
  const remainderOrder = [...portions].sort((left, right) =>
    right.remainder - left.remainder || compareAllocations(left, right),
  );
  for (let index = 0; remainder > 0; index++, remainder--) {
    remainderOrder[index % remainderOrder.length]!.amount++;
  }
  return portions.map(({ remainder: _remainder, ...portion }) => portion);
}
