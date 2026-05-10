export interface BudgetPlacementAccount {
  id: number;
  name: string;
  balance?: number | null;
  balances?: Record<string, number>;
  category?: string;
  is_depreciable?: boolean;
  include_in_allocatable?: boolean;
}

export interface BudgetPlacementTarget {
  account_id: number;
  ratio: number;
}

export interface BudgetPlacementCategorySummary {
  category: {
    id: number;
    name: string;
    target_accounts?: BudgetPlacementTarget[];
  };
  available: number;
}

export interface BudgetPlacementGroup {
  group_id: string;
  account_ids: number[];
  account_names: string[];
  actual: number;
  accounts: BudgetPlacementAccountDetail[];
  expected: number;
  difference: number;
  categories: BudgetPlacementCategoryDetail[];
}

export interface BudgetPlacementHint {
  type:
    | "move_cash"
    | "allocate_budget"
    | "reduce_budget"
    | "link_or_adjust_unplaced";
  amount: number;
  from?: string;
  to?: string;
  target?: string;
}

export interface BudgetPlacementAccountDetail {
  account_id: number;
  account_name: string;
  amount: number;
}

export interface BudgetPlacementCategoryDetail {
  budget_category_id: number;
  budget_category_name: string;
  amount: number;
}

function isValidPlacementAccount(
  account: BudgetPlacementAccount | undefined,
): boolean {
  if (!account) return false;
  if (account.category && account.category !== "cash") return false;
  if (account.is_depreciable) return false;
  if (account.include_in_allocatable === false) return false;
  return true;
}

export function calculateBudgetPlacement({
  accounts,
  categorySummaries,
  currency,
}: {
  accounts: BudgetPlacementAccount[];
  categorySummaries: BudgetPlacementCategorySummary[];
  currency: string;
}): {
  placementGroups: BudgetPlacementGroup[];
  unplacedBudget: number;
  unplacedAccounts: BudgetPlacementAccountDetail[];
  unplacedDifference: number;
} {
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const categoryById = new Map<
    number,
    { name: string; available: number; targetAccountIds: number[] }
  >();
  const categoryToAccounts = new Map<number, Set<number>>();
  const accountToCategories = new Map<number, Set<number>>();
  let unplacedBudget = 0;

  for (const summary of categorySummaries) {
    const targetAccountIds = [
      ...new Set(
        (summary.category.target_accounts ?? [])
          .filter(
            (target) =>
              target.ratio > 0 &&
              isValidPlacementAccount(accountById.get(target.account_id)),
          )
          .map((target) => target.account_id),
      ),
    ];
    if (targetAccountIds.length === 0) {
      unplacedBudget += summary.available;
      continue;
    }

    categoryById.set(summary.category.id, {
      name: summary.category.name,
      available: summary.available,
      targetAccountIds,
    });
    categoryToAccounts.set(summary.category.id, new Set(targetAccountIds));
    for (const accountId of targetAccountIds) {
      const categories = accountToCategories.get(accountId) ?? new Set<number>();
      categories.add(summary.category.id);
      accountToCategories.set(accountId, categories);
    }
  }

  const visitedCategories = new Set<number>();
  const placementGroups: BudgetPlacementGroup[] = [];

  for (const startCategoryId of categoryById.keys()) {
    if (visitedCategories.has(startCategoryId)) continue;

    const componentCategoryIds = new Set<number>();
    const componentAccountIds = new Set<number>();
    const categoryQueue = [startCategoryId];
    const accountQueue: number[] = [];

    while (categoryQueue.length > 0 || accountQueue.length > 0) {
      while (categoryQueue.length > 0) {
        const categoryId = categoryQueue.pop()!;
        if (componentCategoryIds.has(categoryId)) continue;
        componentCategoryIds.add(categoryId);
        visitedCategories.add(categoryId);
        for (const accountId of categoryToAccounts.get(categoryId) ?? []) {
          if (!componentAccountIds.has(accountId)) accountQueue.push(accountId);
        }
      }

      while (accountQueue.length > 0) {
        const accountId = accountQueue.pop()!;
        if (componentAccountIds.has(accountId)) continue;
        componentAccountIds.add(accountId);
        for (const categoryId of accountToCategories.get(accountId) ?? []) {
          if (!componentCategoryIds.has(categoryId)) {
            categoryQueue.push(categoryId);
          }
        }
      }
    }

    const categoryIds = [...componentCategoryIds].sort((a, b) => a - b);
    const accountIds = [...componentAccountIds].sort((a, b) => a - b);
    const categories = categoryIds.map((categoryId) => {
      const category = categoryById.get(categoryId)!;
      return {
        budget_category_id: categoryId,
        budget_category_name: category.name,
        amount: category.available,
      };
    });
    const expected = categories.reduce((sum, category) => {
      return sum + category.amount;
    }, 0);
    const accountDetails = accountIds.map((accountId) => {
      const account = accountById.get(accountId);
      return {
        account_id: accountId,
        account_name: account?.name ?? `#${accountId}`,
        amount: account?.balances?.[currency] ?? account?.balance ?? 0,
      };
    });
    const actual = accountDetails.reduce((sum, account) => {
      return sum + account.amount;
    }, 0);

    placementGroups.push({
      group_id: `a:${accountIds[0] ?? "none"}`,
      account_ids: accountIds,
      account_names: accountDetails.map((account) => account.account_name),
      actual,
      accounts: accountDetails,
      expected,
      difference: actual - expected,
      categories,
    });
  }

  placementGroups.sort((a, b) => {
    const accountDiff = (a.account_ids[0] ?? 0) - (b.account_ids[0] ?? 0);
    if (accountDiff !== 0) return accountDiff;
    return (
      (a.categories[0]?.budget_category_id ?? 0) -
      (b.categories[0]?.budget_category_id ?? 0)
    );
  });

  const placedAccountIds = new Set(
    placementGroups.flatMap((group) => group.account_ids),
  );
  const unplacedAccounts = accounts
    .filter((account) => {
      return isValidPlacementAccount(account) && !placedAccountIds.has(account.id);
    })
    .map((account) => ({
      account_id: account.id,
      account_name: account.name,
      amount: account.balances?.[currency] ?? account.balance ?? 0,
    }))
    .filter((account) => account.amount !== 0)
    .sort((a, b) => a.account_id - b.account_id);
  const unplacedActual = unplacedAccounts.reduce((sum, account) => {
    return sum + account.amount;
  }, 0);

  return {
    placementGroups,
    unplacedBudget,
    unplacedAccounts,
    unplacedDifference: unplacedActual - unplacedBudget,
  };
}

function groupLabel(group: BudgetPlacementGroup): string {
  return group.account_names.join(" + ");
}

function groupBudgetLabel(group: BudgetPlacementGroup): string {
  return group.categories
    .map((category) => category.budget_category_name)
    .join(" + ");
}

export function generateBudgetPlacementHints({
  placementGroups,
  unplacedBudget,
  unplacedAccounts,
  unplacedDifference,
}: {
  placementGroups: BudgetPlacementGroup[];
  unplacedBudget: number;
  unplacedAccounts: BudgetPlacementAccountDetail[];
  unplacedDifference: number;
}): BudgetPlacementHint[] {
  const hints: BudgetPlacementHint[] = [];
  const surplus = placementGroups
    .filter((group) => group.difference > 0)
    .map((group) => ({ group, remaining: group.difference }));
  const shortage = placementGroups
    .filter((group) => group.difference < 0)
    .map((group) => ({ group, remaining: Math.abs(group.difference) }));

  for (const source of surplus) {
    for (const destination of shortage) {
      if (source.remaining <= 0 || destination.remaining <= 0) continue;
      const amount = Math.min(source.remaining, destination.remaining);
      hints.push({
        type: "move_cash",
        amount,
        from: groupLabel(source.group),
        to: groupLabel(destination.group),
      });
      source.remaining -= amount;
      destination.remaining -= amount;
    }
  }

  for (const source of surplus) {
    if (source.remaining <= 0) continue;
    hints.push({
      type: "allocate_budget",
      amount: source.remaining,
      target: groupBudgetLabel(source.group),
    });
  }

  for (const destination of shortage) {
    if (destination.remaining <= 0) continue;
    hints.push({
      type: "reduce_budget",
      amount: destination.remaining,
      target: groupBudgetLabel(destination.group),
    });
  }

  if (unplacedBudget !== 0 || unplacedAccounts.length > 0) {
    const target =
      unplacedAccounts.length > 0
        ? `${unplacedAccounts
            .map((account) => account.account_name)
            .join(" + ")} / unplaced budgets`
        : "unplaced budgets";
    if (unplacedDifference !== 0) {
      hints.push({
        type: "link_or_adjust_unplaced",
        amount: unplacedDifference,
        target,
      });
    }
  }

  return hints;
}
