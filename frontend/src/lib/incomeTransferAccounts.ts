import type { Account, BudgetCategory } from "@balance-sheet/shared";

export interface IncomeTransferAllocation {
  budgetCategoryId: number;
  amount: number;
}

export interface IncomeTransferSourceAmount {
  accountId: number;
  amount: number;
}

/** Split category amounts proportionally while ensuring rounded source totals stay within receipts. */
export function splitIncomeAllocationsAcrossSources(input: {
  allocations: IncomeTransferAllocation[];
  sources: IncomeTransferSourceAmount[];
  decimalPlaces: number;
}): Record<number, Record<number, number>> {
  const scale = 10 ** input.decimalPlaces;
  const originalUnits = input.sources.map((source) => Math.max(0, Math.round(source.amount * scale)));
  const remainingUnits = new Map(input.sources.map((source, index) => [source.accountId, originalUnits[index] ?? 0]));
  const result: Record<number, Record<number, number>> = {};

  for (const allocation of input.allocations) {
    const amountUnits = Math.max(0, Math.round(allocation.amount * scale));
    let weights = input.sources.map((source) => Math.max(0, remainingUnits.get(source.accountId) ?? 0));
    if (weights.reduce((sum, amount) => sum + amount, 0) === 0) weights = originalUnits;
    const weightTotal = weights.reduce((sum, amount) => sum + amount, 0);
    if (amountUnits === 0 || weightTotal === 0) {
      result[allocation.budgetCategoryId] = {};
      continue;
    }

    const shares = weights.map((weight, index) => {
      const exactUnits = amountUnits * weight / weightTotal;
      const units = Math.floor(exactUnits);
      return { index, units, remainder: exactUnits - units };
    });
    let unassignedUnits = amountUnits - shares.reduce((sum, share) => sum + share.units, 0);
    shares.slice().sort((left, right) =>
      right.remainder - left.remainder || left.index - right.index,
    ).forEach((share) => {
      if (unassignedUnits <= 0) return;
      share.units += 1;
      unassignedUnits -= 1;
    });

    const perSource: Record<number, number> = {};
    for (const share of shares) {
      const source = input.sources[share.index]!;
      if (share.units > 0) perSource[source.accountId] = share.units / scale;
      remainingUnits.set(source.accountId, Math.max(0, (remainingUnits.get(source.accountId) ?? 0) - share.units));
    }
    result[allocation.budgetCategoryId] = perSource;
  }
  return result;
}

export function resolveIncomeTransferAccounts(input: {
  categoryId: number;
  depositAccountId: number | null;
  categories: Pick<BudgetCategory, "id" | "target_accounts">[];
  accounts: Account[];
}): { required: boolean; accountIds: number[] } {
  const validAccountIds = new Set(
    input.accounts
      .filter(
        (account) =>
          account.type === "asset" &&
          account.category === "cash" &&
          account.include_in_allocatable !== false &&
          !account.is_depreciable,
      )
      .map((account) => account.id),
  );
  const categoryAccounts = new Map(
    input.categories.map((category) => [
      category.id,
      new Set(
        (category.target_accounts ?? [])
          .filter(
            (target) =>
              target.ratio > 0 && validAccountIds.has(target.account_id),
          )
          .map((target) => target.account_id),
      ),
    ]),
  );
  const accountCategories = new Map<number, Set<number>>();
  for (const [categoryId, accountIds] of categoryAccounts) {
    for (const accountId of accountIds) {
      const categoryIds = accountCategories.get(accountId) ?? new Set<number>();
      categoryIds.add(categoryId);
      accountCategories.set(accountId, categoryIds);
    }
  }
  const categoriesToVisit = [input.categoryId];
  const visitedCategories = new Set<number>();
  const groupAccounts = new Set<number>();
  while (categoriesToVisit.length > 0) {
    const categoryId = categoriesToVisit.pop()!;
    if (visitedCategories.has(categoryId)) continue;
    visitedCategories.add(categoryId);
    for (const accountId of categoryAccounts.get(categoryId) ?? []) {
      if (groupAccounts.has(accountId)) continue;
      groupAccounts.add(accountId);
      for (const linkedCategory of accountCategories.get(accountId) ?? []) {
        if (!visitedCategories.has(linkedCategory)) {
          categoriesToVisit.push(linkedCategory);
        }
      }
    }
  }
  const accountIds = [...groupAccounts].sort((a, b) => a - b);
  return {
    required:
      accountIds.length > 0 &&
      (input.depositAccountId == null ||
        !groupAccounts.has(input.depositAccountId)),
    accountIds,
  };
}
