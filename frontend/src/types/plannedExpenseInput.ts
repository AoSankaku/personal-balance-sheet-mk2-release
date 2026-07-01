import type {
  PlannedExpenseKind,
  PlannedExpenseStatus,
  ShoppingPlanType,
} from "@balance-sheet/shared";

export interface ShoppingPlanCheckoutItemSnapshot {
  id: number;
  name: string;
  estimatedAmount: number;
  currency: string;
  status: PlannedExpenseStatus;
  keepOnRoutineClear: boolean;
  note: string | null;
}

export interface PlannedExpenseEntrySource {
  id: number;
  kind: PlannedExpenseKind;
  name: string;
  amount: number;
  currency: string;
  expenseAccountId: number | null;
  categoryId?: number | null;
  categoryShoppingPlanType?: ShoppingPlanType | null;
  categoryTargetDate?: string | null;
  checkoutItemIds?: number[];
  checkoutKeepItemIds?: number[];
  checkoutItems?: ShoppingPlanCheckoutItemSnapshot[];
}
