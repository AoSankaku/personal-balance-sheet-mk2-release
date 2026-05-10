export interface TransferBudgetCategory {
  id: number;
  name: string;
  sort_order?: number;
  target_accounts?: { account_id: number; ratio: number }[];
}

export interface TransferBudgetAdjustment {
  budget_category_id: number;
  amount: number;
  adjustment_type: "transfer";
}

function categorySort(a: TransferBudgetCategory, b: TransferBudgetCategory) {
  const orderDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
  if (orderDiff !== 0) return orderDiff;
  return a.name.localeCompare(b.name, "ja");
}

function findCategoriesInAccountGroup(
  budgetCategories: TransferBudgetCategory[],
  accountId: number | null,
): TransferBudgetCategory[] {
  if (accountId == null) return [];

  const categoryById = new Map(
    budgetCategories.map((category) => [category.id, category]),
  );
  const categoryToAccounts = new Map<number, Set<number>>();
  const accountToCategories = new Map<number, Set<number>>();

  for (const category of budgetCategories) {
    for (const target of category.target_accounts ?? []) {
      if (target.ratio <= 0) continue;
      const accounts = categoryToAccounts.get(category.id) ?? new Set<number>();
      accounts.add(target.account_id);
      categoryToAccounts.set(category.id, accounts);

      const categories =
        accountToCategories.get(target.account_id) ?? new Set<number>();
      categories.add(category.id);
      accountToCategories.set(target.account_id, categories);
    }
  }

  const categoryIds = new Set<number>();
  const accountIds = new Set<number>();
  const accountQueue = [accountId];
  const categoryQueue: number[] = [];

  while (accountQueue.length > 0 || categoryQueue.length > 0) {
    while (accountQueue.length > 0) {
      const currentAccountId = accountQueue.pop()!;
      if (accountIds.has(currentAccountId)) continue;
      accountIds.add(currentAccountId);
      for (const categoryId of accountToCategories.get(currentAccountId) ?? []) {
        if (!categoryIds.has(categoryId)) categoryQueue.push(categoryId);
      }
    }

    while (categoryQueue.length > 0) {
      const categoryId = categoryQueue.pop()!;
      if (categoryIds.has(categoryId)) continue;
      categoryIds.add(categoryId);
      for (const nextAccountId of categoryToAccounts.get(categoryId) ?? []) {
        if (!accountIds.has(nextAccountId)) accountQueue.push(nextAccountId);
      }
    }
  }

  return [...categoryIds]
    .map((categoryId) => categoryById.get(categoryId))
    .filter((category): category is TransferBudgetCategory => !!category)
    .sort(categorySort);
}

export function getTransferBudgetCategoryOptions({
  budgetCategories,
  fromAccountId,
  toAccountId,
}: {
  budgetCategories: TransferBudgetCategory[];
  fromAccountId: number | null;
  toAccountId: number | null;
}) {
  return {
    sourceOptions: findCategoriesInAccountGroup(
      budgetCategories,
      fromAccountId,
    ).map((category) => ({
      value: String(category.id),
      label: category.name,
    })),
    destinationOptions: findCategoriesInAccountGroup(
      budgetCategories,
      toAccountId,
    ).map((category) => ({
      value: String(category.id),
      label: category.name,
    })),
  };
}

export function buildTransferBudgetAdjustments({
  amount,
  sourceBudgetCategoryId,
  destinationBudgetCategoryId,
}: {
  amount: number;
  sourceBudgetCategoryId: number | null;
  destinationBudgetCategoryId: number | null;
}): TransferBudgetAdjustment[] {
  if (amount <= 0 || sourceBudgetCategoryId == null) return [];
  if (sourceBudgetCategoryId === destinationBudgetCategoryId) return [];

  const adjustments: TransferBudgetAdjustment[] = [
    {
      budget_category_id: sourceBudgetCategoryId,
      amount: -amount,
      adjustment_type: "transfer",
    },
  ];

  if (destinationBudgetCategoryId != null) {
    adjustments.push({
      budget_category_id: destinationBudgetCategoryId,
      amount,
      adjustment_type: "transfer",
    });
  }

  return adjustments;
}
