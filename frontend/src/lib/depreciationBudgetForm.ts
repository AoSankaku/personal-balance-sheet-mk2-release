import type { DepreciationBudgetMethod } from "@balance-sheet/shared";
import {
  resolveDepreciationMonthlySourceAllocations,
  validateDepreciationMonthlySourceAllocations,
} from "@balance-sheet/shared";

export const DEPRECIATION_BUDGET_METHOD_ORDER = [
  "assigned",
  "special",
  "unallocated",
] as const satisfies readonly DepreciationBudgetMethod[];

export type DepreciationBudgetFormErrors = Partial<{
  purchaseCategory: "required";
  monthlySourceCategory: "required" | "must_differ";
  monthlySourceAllocations: "invalid";
  confirmUnallocated: "required";
  confirmMonthlyUnallocated: "required";
}>;

export function getDepreciationBudgetFormErrors(input: {
  method: DepreciationBudgetMethod | null | undefined;
  purchaseCategoryId: number | null | undefined;
  monthlySourceCategoryId: number | null | undefined;
  monthlySourceAllocations?: Array<{ budget_category_id: number | null; ratio: number }>;
  confirmUnallocated?: boolean;
  confirmMonthlyUnallocated?: boolean;
}): DepreciationBudgetFormErrors {
  if (!input.method) return {};

  const allocations = resolveDepreciationMonthlySourceAllocations({
    monthly_source_category_id: input.monthlySourceCategoryId,
    monthly_source_allocations: input.monthlySourceAllocations,
  });
  const hasExplicitAllocations = input.monthlySourceAllocations !== undefined;
  const hasMonthlySource =
    hasExplicitAllocations || input.monthlySourceCategoryId != null;

  if (input.method === "assigned") {
    const errors: DepreciationBudgetFormErrors = {};
    if (input.purchaseCategoryId == null) {
      errors.purchaseCategory = "required";
    }
    if (!hasMonthlySource) {
      errors.monthlySourceCategory = "required";
    } else if (
      allocations.some(
        (allocation) =>
          allocation.budget_category_id != null &&
          allocation.ratio > 0 &&
          input.purchaseCategoryId === allocation.budget_category_id,
      )
    ) {
      errors.monthlySourceCategory = "must_differ";
    }
    if (hasExplicitAllocations && validateDepreciationMonthlySourceAllocations(allocations)) {
      errors.monthlySourceAllocations = "invalid";
    }
    if (
      allocations.some(
        (allocation) => allocation.budget_category_id == null && allocation.ratio > 1e-6,
      ) &&
      !input.confirmMonthlyUnallocated
    ) {
      errors.confirmMonthlyUnallocated = "required";
    }
    return errors;
  }

  if (input.method === "special") {
    const errors: DepreciationBudgetFormErrors = {};
    if (!hasMonthlySource) errors.monthlySourceCategory = "required";
    if (hasExplicitAllocations && validateDepreciationMonthlySourceAllocations(allocations)) {
      errors.monthlySourceAllocations = "invalid";
    }
    if (
      allocations.some(
        (allocation) => allocation.budget_category_id == null && allocation.ratio > 1e-6,
      ) &&
      !input.confirmMonthlyUnallocated
    ) {
      errors.confirmMonthlyUnallocated = "required";
    }
    return errors;
  }

  return input.confirmUnallocated
    ? {}
    : { confirmUnallocated: "required" };
}

export function wouldOverdrawDepreciationPurchaseCategory(
  availableBalance: number,
  purchaseAmount: number,
) {
  return availableBalance - purchaseAmount < 0;
}
