import { describe, expect, test } from "bun:test";

import {
  hasDuplicatePlannedExpenseCategoryName,
  hasDuplicatePlannedExpenseItemName,
  normalizePlannedExpenseCategoryName,
  normalizePlannedExpenseItemName,
} from "../../shared/types";

describe("planned expense category duplicate detection", () => {
  test("normalizes surrounding whitespace before comparing category names", () => {
    expect(normalizePlannedExpenseCategoryName("  Camera gear  ")).toBe(
      "Camera gear",
    );
    expect(
      hasDuplicatePlannedExpenseCategoryName({
        name: " Camera gear ",
        kind: "wishlist",
        currency: "JPY",
        categories: [
          { id: 1, kind: "wishlist", name: "Camera gear", currency: "JPY" },
          { id: 2, kind: "wishlist", name: "Travel", currency: "JPY" },
        ],
      }),
    ).toBe(true);
  });

  test("allows the same name in another planned-expense kind", () => {
    expect(
      hasDuplicatePlannedExpenseCategoryName({
        name: "Travel",
        kind: "wishlist",
        currency: "JPY",
        categories: [
          { id: 1, kind: "shopping_list", name: "Travel", currency: "JPY" },
          { id: 2, kind: "scheduled_payment", name: "Travel", currency: "JPY" },
        ],
      }),
    ).toBe(false);
  });

  test("ignores the edited category id", () => {
    expect(
      hasDuplicatePlannedExpenseCategoryName({
        name: "Travel",
        kind: "wishlist",
        currency: "JPY",
        excludeId: 1,
        categories: [
          { id: 1, kind: "wishlist", name: "Travel", currency: "JPY" },
          { id: 2, kind: "wishlist", name: "Books", currency: "JPY" },
        ],
      }),
    ).toBe(false);
  });

  test("allows the same category name in another currency", () => {
    expect(
      hasDuplicatePlannedExpenseCategoryName({
        name: "Travel",
        kind: "wishlist",
        currency: "USD",
        categories: [
          { id: 1, kind: "wishlist", name: "Travel", currency: "JPY" },
        ],
      }),
    ).toBe(false);
  });
});

describe("planned expense item duplicate detection", () => {
  test("prevents the same item name in the same category", () => {
    expect(normalizePlannedExpenseItemName("  Camera  ")).toBe("Camera");
    expect(
      hasDuplicatePlannedExpenseItemName({
        name: "Camera",
        kind: "wishlist",
        categoryId: 10,
        currency: "JPY",
        items: [
          { id: 1, kind: "wishlist", category_id: 10, name: "Camera", currency: "JPY" },
          { id: 2, kind: "wishlist", category_id: 10, name: "Tripod", currency: "JPY" },
        ],
      }),
    ).toBe(true);
  });

  test("allows the same item name in a different category", () => {
    expect(
      hasDuplicatePlannedExpenseItemName({
        name: "Camera",
        kind: "wishlist",
        categoryId: 20,
        currency: "JPY",
        items: [
          { id: 1, kind: "wishlist", category_id: 10, name: "Camera", currency: "JPY" },
        ],
      }),
    ).toBe(false);
  });

  test("ignores the edited item id", () => {
    expect(
      hasDuplicatePlannedExpenseItemName({
        name: "Camera",
        kind: "wishlist",
        categoryId: 10,
        currency: "JPY",
        excludeId: 1,
        items: [
          { id: 1, kind: "wishlist", category_id: 10, name: "Camera", currency: "JPY" },
        ],
      }),
    ).toBe(false);
  });

  test("allows the same uncategorized item name in another currency", () => {
    expect(
      hasDuplicatePlannedExpenseItemName({
        name: "Camera",
        kind: "wishlist",
        categoryId: null,
        currency: "USD",
        items: [
          { id: 1, kind: "wishlist", category_id: null, name: "Camera", currency: "JPY" },
        ],
      }),
    ).toBe(false);
  });
});
