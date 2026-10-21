import { isBudgetLiability } from "./budgetScope";

const sumBudgetClaims = (values: number[]) => values.reduce((sum, value) => sum + Math.max(value, 0), 0);
const sumBudgetOverspending = (values: number[]) => values.reduce((sum, value) => sum + Math.max(-value, 0), 0);

export interface BudgetPlacementAccount {
  id: number;
  name: string;
  type?: string;
  deduct_from_budget?: boolean;
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

export interface BudgetPlacementTransfer {
  from_account_id: number;
  to_account_id: number;
  amount: number;
  currency: string;
}

export interface BudgetPlacementCategorySummary {
  category: {
    id: number;
    name: string;
    target_accounts?: BudgetPlacementTarget[];
  };
  available: number;
  reference_reserve?: number;
  depreciation_non_cash_offset?: number;
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

export interface BudgetOverspendingDetail {
  budget_category_id: number;
  budget_category_name: string;
  amount: number;
}

function placementBalance(account: BudgetPlacementAccount | undefined, currency: string): number {
  if (!account) return 0;
  return account.balances ? account.balances[currency] ?? 0 : currency === "JPY" ? account.balance ?? 0 : 0;
}

function isValidPlacementAccount(
  account: BudgetPlacementAccount | undefined,
): boolean {
  if (!account) return false;
  if (account.type && account.type !== "asset") return false;
  if (account.category && account.category !== "cash") return false;
  if (account.is_depreciable) return false;
  if (account.include_in_allocatable === false) return false;
  return true;
}

export function applyBudgetPlacementTransfers(
  accounts: BudgetPlacementAccount[],
  transfers: BudgetPlacementTransfer[],
  currency: string,
): BudgetPlacementAccount[] {
  const normalizedCurrency = currency.toUpperCase();
  const deltas = new Map<number, number>();
  for (const transfer of transfers) {
    if (transfer.currency.toUpperCase() !== normalizedCurrency) continue;
    deltas.set(
      transfer.from_account_id,
      (deltas.get(transfer.from_account_id) ?? 0) - transfer.amount,
    );
    deltas.set(
      transfer.to_account_id,
      (deltas.get(transfer.to_account_id) ?? 0) + transfer.amount,
    );
  }

  return accounts.map((account) => {
    const delta = deltas.get(account.id) ?? 0;
    if (delta === 0) return account;
    const current = placementBalance(account, normalizedCurrency);
    return {
      ...account,
      balances: {
        ...(account.balances ?? {}),
        [normalizedCurrency]: current + delta,
      },
    };
  });
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
  unfundedOverspending: number;
  overspendingCategories: BudgetOverspendingDetail[];
} {
  currency = currency.toUpperCase();
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const categoryById = new Map<
    number,
    {
      name: string;
      available: number;
      referenceReserve: number;
      depreciationNonCashOffset: number;
      targetAccountIds: number[];
    }
  >();
  const categoryToAccounts = new Map<number, Set<number>>();
  const accountToCategories = new Map<number, Set<number>>();
  let unplacedBudget = 0;
  const overspendingCategories = categorySummaries
    .filter((summary) => summary.available < 0)
    .map((summary) => ({
      budget_category_id: summary.category.id,
      budget_category_name: summary.category.name,
      amount: Math.max(-summary.available, 0),
    }));
  const unfundedOverspending = sumBudgetOverspending(
    categorySummaries.map((summary) => summary.available),
  );

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
      unplacedBudget +=
        Math.max(summary.available, 0) +
        Math.max(summary.reference_reserve ?? 0, 0) +
        Math.max(summary.depreciation_non_cash_offset ?? 0, 0);
      continue;
    }

    categoryById.set(summary.category.id, {
      name: summary.category.name,
      available: summary.available,
      referenceReserve: Math.max(summary.reference_reserve ?? 0, 0),
      depreciationNonCashOffset: Math.max(
        summary.depreciation_non_cash_offset ?? 0,
        0,
      ),
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
        amount:
          Math.max(category.available, 0) +
          category.referenceReserve +
          category.depreciationNonCashOffset,
      };
    });
    const expected = sumBudgetClaims(
      categories.map((category) => category.amount),
    );
    const accountDetails = accountIds.map((accountId) => {
      const account = accountById.get(accountId);
      return {
        account_id: accountId,
        account_name: account?.name ?? `#${accountId}`,
        amount: placementBalance(account, currency),
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
      amount: placementBalance(account, currency),
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
    unfundedOverspending,
    overspendingCategories,
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

export interface BudgetPlacementPlanGroup extends BudgetPlacementGroup {
  overspending: number;
  retained_shortage: number;
  transfer_delta: number;
  after_difference: number;
}

export interface BudgetPlacementPlan {
  transfers: BudgetPlacementTransfer[];
  groups: BudgetPlacementPlanGroup[];
  unplaced_difference: number;
  unplaced_after_difference: number;
  total_difference: number;
  after_total_difference: number;
  unfunded_overspending: number;
  liabilities: { account_id: number; account_name: string; amount: number }[];
  liability_total: number;
  adjusted_total_difference: number;
}

/** Reconcile physical holdings; no budget allocation or overspending is changed. */
export function generateBudgetPlacementPlan({ accounts, categorySummaries, currency, decimalPlaces = 0 }: {
  accounts: BudgetPlacementAccount[];
  categorySummaries: BudgetPlacementCategorySummary[];
  currency: string;
  decimalPlaces?: number;
}): BudgetPlacementPlan {
  currency = currency.toUpperCase();
  const scale = 10 ** decimalPlaces;
  const units = (value: number) => Math.round(value * scale);
  const money = (value: number) => value / scale;
  const placement = calculateBudgetPlacement({ accounts, categorySummaries, currency });
  const negativeByCategory = new Map(categorySummaries.map(summary => [summary.category.id, Math.max(-summary.available, 0)]));
  const groups = placement.placementGroups.map(group => ({
    ...group,
    overspending: group.categories.reduce((sum, category) => sum + (negativeByCategory.get(category.budget_category_id) ?? 0), 0),
    retained_shortage: 0, transfer_delta: 0, after_difference: money(units(group.difference)),
  }));
  const totalUnits = groups.reduce((sum, group) => sum + units(group.difference), units(placement.unplacedDifference));
  let unavoidableShortage = Math.max(-totalUnits, 0);
  // Leave known overspending in its own holding group, protecting other budgets.
  for (const group of groups) {
    const retained = Math.min(unavoidableShortage, units(group.overspending), Math.max(units(group.expected), 0));
    group.retained_shortage = money(retained);
    unavoidableShortage -= retained;
  }
  const states = groups.map(group => ({ group, remaining: units(group.difference + group.retained_shortage), accounts: group.accounts.map(account => ({ id: account.account_id, remaining: Math.max(units(account.amount), 0) })) }));
  const unplaced = { group: null, remaining: units(placement.unplacedDifference), accounts: placement.unplacedAccounts.map(account => ({ id: account.account_id, remaining: Math.max(units(account.amount), 0) })) };
  const donors = [...states, unplaced].filter(state => state.remaining > 0);
  const recipients = states.filter(state => state.remaining < 0).sort((a, b) => Number(a.group.overspending > 0) - Number(b.group.overspending > 0));
  const transfers: BudgetPlacementTransfer[] = [];
  for (const recipient of recipients) {
    const toId = recipient.group.account_ids[0]!;
    for (const donor of donors) {
      for (const source of donor.accounts) {
        const amount = Math.min(source.remaining, donor.remaining, -recipient.remaining);
        if (amount <= 0) continue;
        transfers.push({ from_account_id: source.id, to_account_id: toId, amount: money(amount), currency });
        source.remaining -= amount;
        donor.remaining -= amount;
        recipient.remaining += amount;
        recipient.group.transfer_delta += money(amount);
        if (donor.group) donor.group.transfer_delta -= money(amount);
      }
    }
  }
  for (const group of groups) group.after_difference = money(units(group.difference) + units(group.transfer_delta));
  const liabilities = accounts.flatMap(account => {
    if (!isBudgetLiability({ ...account, type: account.type ?? "asset", category: account.category ?? "cash" })) return [];
    const amount = money(units(placementBalance(account, currency)));
    return amount === 0 ? [] : [{ account_id: account.id, account_name: account.name, amount }];
  });
  const liabilityTotal = money(liabilities.reduce((sum, account) => sum + units(account.amount), 0));
  return {
    transfers, groups,
    unplaced_difference: money(units(placement.unplacedDifference)),
    unplaced_after_difference: money(unplaced.remaining),
    total_difference: money(totalUnits), after_total_difference: money(totalUnits),
    unfunded_overspending: placement.unfundedOverspending,
    liabilities, liability_total: liabilityTotal,
    adjusted_total_difference: money(totalUnits - units(liabilityTotal)),
  };
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
