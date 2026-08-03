import type {
  IncomeTransferRequirement,
  JournalEntry,
} from "@balance-sheet/shared";

export function connectedTargetAccounts(
  budgetCategoryId: number,
  targets: Array<{ budget_category_id: number; account_id: number }>,
): Set<number> {
  const categoryToAccounts = new Map<number, Set<number>>();
  const accountToCategories = new Map<number, Set<number>>();
  for (const target of targets) {
    const categoryAccounts =
      categoryToAccounts.get(target.budget_category_id) ?? new Set<number>();
    categoryAccounts.add(target.account_id);
    categoryToAccounts.set(target.budget_category_id, categoryAccounts);

    const accountCategories =
      accountToCategories.get(target.account_id) ?? new Set<number>();
    accountCategories.add(target.budget_category_id);
    accountToCategories.set(target.account_id, accountCategories);
  }

  const accounts = new Set<number>();
  const visitedCategories = new Set<number>();
  const pendingCategories = [budgetCategoryId];
  while (pendingCategories.length > 0) {
    const categoryId = pendingCategories.shift()!;
    if (visitedCategories.has(categoryId)) continue;
    visitedCategories.add(categoryId);
    for (const accountId of categoryToAccounts.get(categoryId) ?? []) {
      accounts.add(accountId);
      for (const connectedCategoryId of accountToCategories.get(accountId) ?? []) {
        if (!visitedCategories.has(connectedCategoryId)) {
          pendingCategories.push(connectedCategoryId);
        }
      }
    }
  }
  return accounts;
}

export interface IncomeTransferRequirementGroup {
  key: string;
  requirement_ids: number[];
  source_income_journal_entry_id: number;
  from_account_id: number;
  to_account_id: number;
  amount: number;
  currency: string;
  transfer_journal_entry_id: number | null;
  completion_source: IncomeTransferRequirement["completion_source"];
  is_squashed: boolean;
  requirements: IncomeTransferRequirement[];
}

export function groupIncomeTransferRequirements(
  requirements: IncomeTransferRequirement[],
): IncomeTransferRequirementGroup[] {
  const groups = new Map<string, IncomeTransferRequirementGroup>();
  for (const requirement of requirements) {
    const isCompleted = requirement.completion_source != null;
    const key = isCompleted
      ? requirement.transfer_journal_entry_id != null
        ? `completed:${requirement.transfer_journal_entry_id}`
        : `completed:netted:${requirement.completed_at}`
      : [
          requirement.source_income_journal_entry_id,
          requirement.from_account_id,
          requirement.to_account_id,
          requirement.currency.toUpperCase(),
          "pending",
        ].join(":");
    const group = groups.get(key) ?? {
      key,
      requirement_ids: [],
      source_income_journal_entry_id:
        requirement.source_income_journal_entry_id,
      from_account_id: requirement.from_account_id,
      to_account_id: requirement.to_account_id,
      amount: 0,
      currency: requirement.currency.toUpperCase(),
      transfer_journal_entry_id: requirement.transfer_journal_entry_id,
      completion_source: requirement.completion_source,
      is_squashed: requirement.transfer_journal_entry_id == null && isCompleted,
      requirements: [],
    };
    group.requirement_ids.push(requirement.id);
    group.amount += requirement.amount;
    group.requirements.push(requirement);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const routeKeys = new Set(
      group.requirements.map((requirement) =>
        [
          requirement.source_income_journal_entry_id,
          requirement.from_account_id,
          requirement.to_account_id,
          requirement.currency.toUpperCase(),
        ].join(":"),
      ),
    );
    return {
      ...group,
      is_squashed: group.is_squashed || routeKeys.size > 1,
    };
  });
}

export interface IncomeTransferRequirementAmount {
  from_account_id: number;
  to_account_id: number;
  amount: number;
  currency: string;
}

export interface SquashedIncomeTransfer {
  from_account_id: number;
  to_account_id: number;
  amount: number;
  currency: string;
}

interface AccountBalance {
  accountId: number;
  amount: number;
}

function settleCurrencyBalances(
  inputBalances: AccountBalance[],
  currency: string,
): SquashedIncomeTransfer[] {
  const balances = inputBalances
    .filter((balance) => balance.amount !== 0)
    .sort((left, right) => left.accountId - right.accountId);
  const memo = new Map<string, SquashedIncomeTransfer[]>();

  function settleFrom(startIndex: number): SquashedIncomeTransfer[] {
    let firstIndex = startIndex;
    while (firstIndex < balances.length && balances[firstIndex]!.amount === 0) {
      firstIndex += 1;
    }
    if (firstIndex === balances.length) return [];

    const memoKey = `${firstIndex}:${balances.map((balance) => balance.amount).join(",")}`;
    const memoized = memo.get(memoKey);
    if (memoized) return memoized;

    const first = balances[firstIndex]!;
    const originalFirstAmount = first.amount;
    let best: SquashedIncomeTransfer[] | null = null;
    const triedCounterpartyAmounts = new Set<number>();

    for (
      let counterpartyIndex = firstIndex + 1;
      counterpartyIndex < balances.length;
      counterpartyIndex += 1
    ) {
      const counterparty = balances[counterpartyIndex]!;
      const originalCounterpartyAmount = counterparty.amount;
      if (
        originalFirstAmount * originalCounterpartyAmount >= 0 ||
        triedCounterpartyAmounts.has(originalCounterpartyAmount)
      ) {
        continue;
      }
      triedCounterpartyAmounts.add(originalCounterpartyAmount);

      const amount = Math.min(
        Math.abs(originalFirstAmount),
        Math.abs(originalCounterpartyAmount),
      );
      const transfer: SquashedIncomeTransfer =
        originalFirstAmount < 0
          ? {
              from_account_id: first.accountId,
              to_account_id: counterparty.accountId,
              amount,
              currency,
            }
          : {
              from_account_id: counterparty.accountId,
              to_account_id: first.accountId,
              amount,
              currency,
            };

      first.amount += originalFirstAmount < 0 ? amount : -amount;
      counterparty.amount +=
        originalCounterpartyAmount < 0 ? amount : -amount;
      const candidate = [transfer, ...settleFrom(firstIndex)];
      first.amount = originalFirstAmount;
      counterparty.amount = originalCounterpartyAmount;

      if (best == null || candidate.length < best.length) {
        best = candidate;
      }
      if (originalFirstAmount + originalCounterpartyAmount === 0) break;
    }

    const result = best ?? [];
    memo.set(memoKey, result);
    return result;
  }

  return settleFrom(0);
}

/**
 * Nets every pending movement by account and finds the exact minimum number of
 * transfers needed to realize the remaining balances, independently per currency.
 */
export function squashIncomeTransferRequirements(
  requirements: IncomeTransferRequirementAmount[],
): SquashedIncomeTransfer[] {
  const balancesByCurrency = new Map<string, Map<number, number>>();
  for (const requirement of requirements) {
    const currency = requirement.currency.toUpperCase();
    const balances = balancesByCurrency.get(currency) ?? new Map<number, number>();
    balances.set(
      requirement.from_account_id,
      (balances.get(requirement.from_account_id) ?? 0) - requirement.amount,
    );
    balances.set(
      requirement.to_account_id,
      (balances.get(requirement.to_account_id) ?? 0) + requirement.amount,
    );
    balancesByCurrency.set(currency, balances);
  }

  return [...balancesByCurrency.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([currency, balances]) =>
      settleCurrencyBalances(
        [...balances.entries()].map(([accountId, amount]) => ({
          accountId,
          amount,
        })),
        currency,
      ),
    );
}

export function isMatchingPureTransfer(
  entry: JournalEntry,
  expected: {
    from_account_id: number;
    to_account_id: number;
    amount: number;
    currency: string;
  },
): boolean {
  const currency = expected.currency.toUpperCase();
  const nonZeroLines = entry.lines.filter(
    (line) => line.debit !== 0 || line.credit !== 0,
  );
  if (nonZeroLines.length !== 2) return false;
  const destination = nonZeroLines.find(
    (line) => line.account_id === expected.to_account_id,
  );
  const source = nonZeroLines.find(
    (line) => line.account_id === expected.from_account_id,
  );
  return Boolean(
    destination &&
      source &&
      destination !== source &&
      destination.currency.toUpperCase() === currency &&
      source.currency.toUpperCase() === currency &&
      destination.debit === expected.amount &&
      destination.credit === 0 &&
      source.credit === expected.amount &&
      source.debit === 0,
  );
}
