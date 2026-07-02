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
        categories: [
          { id: 1, kind: "wishlist", name: "Camera gear" },
          { id: 2, kind: "wishlist", name: "Travel" },
        ],
      }),
    ).toBe(true);
  });

  test("allows the same name in another planned-expense kind", () => {
    expect(
      hasDuplicatePlannedExpenseCategoryName({
        name: "Travel",
        kind: "wishlist",
        categories: [
          { id: 1, kind: "shopping_list", name: "Travel" },
          { id: 2, kind: "scheduled_payment", name: "Travel" },
        ],
      }),
    ).toBe(false);
  });

  test("ignores the edited category id", () => {
    expect(
      hasDuplicatePlannedExpenseCategoryName({
        name: "Travel",
        kind: "wishlist",
        excludeId: 1,
        categories: [
          { id: 1, kind: "wishlist", name: "Travel" },
          { id: 2, kind: "wishlist", name: "Books" },
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
        items: [
          { id: 1, kind: "wishlist", category_id: 10, name: "Camera" },
          { id: 2, kind: "wishlist", category_id: 10, name: "Tripod" },
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
        items: [
          { id: 1, kind: "wishlist", category_id: 10, name: "Camera" },
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
        excludeId: 1,
        items: [
          { id: 1, kind: "wishlist", category_id: 10, name: "Camera" },
        ],
      }),
    ).toBe(false);
  });
});
