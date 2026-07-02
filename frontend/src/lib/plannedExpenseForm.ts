export function plannedExpenseCategorySelectValue(
  categoryId?: number | null,
): string | null {
  return categoryId == null ? null : String(categoryId);
}

export function shouldShowPlannedExpenseStatusField(
  editingItem?: { id: number } | null,
): boolean {
  return editingItem != null;
}

export function plannedExpenseItemNameLineClamp(): number {
  return 2;
}

export function shouldShowWishlistItemInMainList(item: {
  status: string;
}): boolean {
  return item.status !== "completed" && item.status !== "cancelled";
}

export function shouldShowWishlistItemInCompletedList(item: {
  status: string;
}): boolean {
  return item.status === "completed" || item.status === "cancelled";
}

export function shouldShowCompletedWishlistAmountTotal(): boolean {
  return false;
}

export type PlannedExpenseCompletionResult =
  | "none"
  | "completed"
  | "shopping_list_archived";

export function plannedExpenseCompletionFeedbackKey(
  result: PlannedExpenseCompletionResult | "pending",
):
  | "transactionSaved"
  | "transactionSavedWithPlannedExpenseCompleted"
  | "transactionSavedWithShoppingListArchived" {
  if (result === "shopping_list_archived") {
    return "transactionSavedWithShoppingListArchived";
  }
  if (result === "completed") {
    return "transactionSavedWithPlannedExpenseCompleted";
  }
  return "transactionSaved";
}

export type PlannedExpenseConfirmableAction =
  | "delete_category"
  | "delete_item"
  | "cancel_item"
  | "complete_item";

export function plannedExpenseActionRequiresConfirmation(
  action: PlannedExpenseConfirmableAction,
): boolean {
  return action === "delete_category" ||
    action === "delete_item" ||
    action === "cancel_item" ||
    action === "complete_item";
}
