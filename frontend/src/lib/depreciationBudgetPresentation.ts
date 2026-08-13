import type { BudgetSummary } from "@balance-sheet/shared";

export type DepreciationBudgetStatus = "active" | "post_reset" | "recognized";

export interface DepreciationBudgetPresentation {
  activePurchaseReserve: number;
  recognizedThisMonth: number;
  postResetNonCashOffset: number;
  hasActivity: boolean;
  status: DepreciationBudgetStatus;
}

export function summarizeDepreciationBudget(
  summary: BudgetSummary | null | undefined,
): DepreciationBudgetPresentation {
  const categories = summary?.categories ?? [];
  const activePurchaseReserve =
    summary?.total_depreciation_reserve ??
    categories.reduce(
      (total, category) => total + (category.depreciation_reserve ?? 0),
      0,
    );
  const recognizedThisMonth = categories.reduce(
    (total, category) => total + (category.depreciation_spent ?? 0),
    0,
  );
  const postResetNonCashOffset =
    summary?.total_depreciation_non_cash_offset ??
    categories.reduce(
      (total, category) =>
        total + (category.depreciation_non_cash_offset ?? 0),
      0,
    );
  const reservationAddedThisMonth = categories.reduce(
    (total, category) =>
      total + (category.depreciation_reservation_added ?? 0),
    0,
  );

  return {
    activePurchaseReserve,
    recognizedThisMonth,
    postResetNonCashOffset,
    hasActivity:
      activePurchaseReserve !== 0 ||
      recognizedThisMonth !== 0 ||
      postResetNonCashOffset !== 0 ||
      reservationAddedThisMonth !== 0,
    status:
      activePurchaseReserve > 0
        ? "active"
        : postResetNonCashOffset > 0
          ? "post_reset"
          : "recognized",
  };
}
