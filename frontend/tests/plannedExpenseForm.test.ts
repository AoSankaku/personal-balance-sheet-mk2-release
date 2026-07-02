import { describe, expect, test } from "bun:test";

import {
  plannedExpenseActionRequiresConfirmation,
  plannedExpenseItemNameLineClamp,
  plannedExpenseCategorySelectValue,
  plannedExpenseCompletionFeedbackKey,
  shouldShowCompletedWishlistAmountTotal,
  shouldShowWishlistItemInCompletedList,
  shouldShowWishlistItemInMainList,
  shouldShowPlannedExpenseStatusField,
} from "../src/lib/plannedExpenseForm";

describe("planned expense form helpers", () => {
  test("preselects a category when opening item creation from a category header", () => {
    expect(plannedExpenseCategorySelectValue(42)).toBe("42");
  });

  test("keeps the category blank when no category is specified", () => {
    expect(plannedExpenseCategorySelectValue(null)).toBeNull();
    expect(plannedExpenseCategorySelectValue(undefined)).toBeNull();
  });

  test("hides the status field when creating a planned expense item", () => {
    expect(shouldShowPlannedExpenseStatusField(null)).toBe(false);
    expect(shouldShowPlannedExpenseStatusField(undefined)).toBe(false);
  });

  test("shows the status field when editing an existing planned expense item", () => {
    expect(shouldShowPlannedExpenseStatusField({ id: 1 })).toBe(true);
  });

  test("allows item names to use two lines in dense mobile layouts", () => {
    expect(plannedExpenseItemNameLineClamp()).toBe(2);
  });

  test("keeps completed and cancelled wishlist items out of the main list", () => {
    expect(shouldShowWishlistItemInMainList({ status: "open" })).toBe(true);
    expect(shouldShowWishlistItemInMainList({ status: "cancelled" })).toBe(false);
    expect(shouldShowWishlistItemInMainList({ status: "completed" })).toBe(false);
  });

  test("shows completed and cancelled wishlist items in the completed accordion", () => {
    expect(shouldShowWishlistItemInCompletedList({ status: "open" })).toBe(false);
    expect(shouldShowWishlistItemInCompletedList({ status: "cancelled" })).toBe(true);
    expect(shouldShowWishlistItemInCompletedList({ status: "completed" })).toBe(true);
  });

  test("does not show amount totals for completed and cancelled wishlist groups", () => {
    expect(shouldShowCompletedWishlistAmountTotal()).toBe(false);
  });

  test("uses a distinct feedback message when source item completion also finished", () => {
    expect(plannedExpenseCompletionFeedbackKey("none")).toBe("transactionSaved");
    expect(plannedExpenseCompletionFeedbackKey("pending")).toBe("transactionSaved");
    expect(plannedExpenseCompletionFeedbackKey("completed")).toBe(
      "transactionSavedWithPlannedExpenseCompleted",
    );
    expect(plannedExpenseCompletionFeedbackKey("shopping_list_archived")).toBe(
      "transactionSavedWithShoppingListArchived",
    );
  });

  test("requires confirmation for destructive planned expense actions", () => {
    expect(plannedExpenseActionRequiresConfirmation("delete_category")).toBe(true);
    expect(plannedExpenseActionRequiresConfirmation("delete_item")).toBe(true);
    expect(plannedExpenseActionRequiresConfirmation("cancel_item")).toBe(true);
    expect(plannedExpenseActionRequiresConfirmation("complete_item")).toBe(true);
  });
});
