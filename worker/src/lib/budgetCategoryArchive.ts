export interface BudgetCategoryArchiveFlag {
  is_archived?: boolean | number | null;
}

export function isBudgetCategoryArchived(
  category: BudgetCategoryArchiveFlag,
): boolean {
  return category.is_archived === true || category.is_archived === 1;
}

export function filterBudgetCategoriesForVisibility<
  T extends BudgetCategoryArchiveFlag,
>(categories: T[], includeArchived = false): T[] {
  if (includeArchived) return categories;
  return categories.filter((category) => !isBudgetCategoryArchived(category));
}
