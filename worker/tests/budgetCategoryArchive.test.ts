import { describe, expect, test } from "bun:test";

import {
  filterBudgetCategoriesForVisibility,
  isBudgetCategoryArchived,
} from "../src/lib/budgetCategoryArchive";

describe("budget category archive visibility", () => {
  test("hides archived budget categories by default", () => {
    const categories = [
      { id: 1, name: "Active", is_archived: 0 },
      { id: 2, name: "Archived", is_archived: 1 },
    ];

    expect(filterBudgetCategoriesForVisibility(categories)).toEqual([
      categories[0],
    ]);
  });

  test("includes archived budget categories when requested", () => {
    const categories = [
      { id: 1, name: "Active", is_archived: 0 },
      { id: 2, name: "Archived", is_archived: 1 },
    ];

    expect(filterBudgetCategoriesForVisibility(categories, true)).toEqual(
      categories,
    );
  });

  test("normalizes sqlite archive flags", () => {
    expect(isBudgetCategoryArchived({ is_archived: 1 })).toBe(true);
    expect(isBudgetCategoryArchived({ is_archived: true })).toBe(true);
    expect(isBudgetCategoryArchived({ is_archived: 0 })).toBe(false);
    expect(isBudgetCategoryArchived({})).toBe(false);
  });
});
