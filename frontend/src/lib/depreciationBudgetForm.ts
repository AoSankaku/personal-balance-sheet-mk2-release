import type { DepreciationBudgetMethod } from "@balance-sheet/shared";

export const DEPRECIATION_BUDGET_METHOD_ORDER = [
  "assigned",
  "special",
  "unallocated",
] as const satisfies readonly DepreciationBudgetMethod[];

export type DepreciationBudgetFormErrors = Partial<{
  purchaseCategory: "required";
  monthlySourceCategory: "required" | "must_differ";
  confirmUnallocated: "required";
}>;

export function getDepreciationBudgetFormErrors(input: {
  method: DepreciationBudgetMethod | null | undefined;
  purchaseCategoryId: number | null | undefined;
  monthlySourceCategoryId: number | null | undefined;
  confirmUnallocated?: boolean;
}): DepreciationBudgetFormErrors {
  if (!input.method) return {};

  if (input.method === "assigned") {
    const errors: DepreciationBudgetFormErrors = {};
    if (input.purchaseCategoryId == null) {
      errors.purchaseCategory = "required";
    }
    if (input.monthlySourceCategoryId == null) {
      errors.monthlySourceCategory = "required";
    } else if (input.purchaseCategoryId === input.monthlySourceCategoryId) {
      errors.monthlySourceCategory = "must_differ";
    }
    return errors;
  }

  if (input.method === "special") {
    return input.monthlySourceCategoryId == null
      ? { monthlySourceCategory: "required" }
      : {};
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
