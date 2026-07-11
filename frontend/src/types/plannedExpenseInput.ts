import type {
  PlannedExpenseKind,
  PlannedExpenseRecurrenceType,
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
  /** Stable for the lifetime of this input flow so a retried submit cannot duplicate a journal. */
  idempotencyKey: string;
  kind: PlannedExpenseKind;
  name: string;
  amount: number;
  currency: string;
  inputAmount?: number;
  inputCurrency?: string;
  recurrenceType?: PlannedExpenseRecurrenceType;
  expenseAccountId: number | null;
  categoryId?: number | null;
  categoryShoppingPlanType?: ShoppingPlanType | null;
  categoryTargetDate?: string | null;
  occurrenceDate?: string | null;
  nextDueDateAfterOccurrence?: string | null;
  completedDates?: string | null;
  completionStatusAfterOccurrence?: PlannedExpenseStatus;
  checkoutItemIds?: number[];
  checkoutKeepItemIds?: number[];
  checkoutItems?: ShoppingPlanCheckoutItemSnapshot[];
}
