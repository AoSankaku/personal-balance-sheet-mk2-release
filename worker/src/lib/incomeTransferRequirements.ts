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
  requirements: IncomeTransferRequirement[];
}

export function groupIncomeTransferRequirements(
  requirements: IncomeTransferRequirement[],
): IncomeTransferRequirementGroup[] {
  const groups = new Map<string, IncomeTransferRequirementGroup>();
  for (const requirement of requirements) {
    const key = [
      requirement.source_income_journal_entry_id,
      requirement.from_account_id,
      requirement.to_account_id,
      requirement.currency.toUpperCase(),
      requirement.transfer_journal_entry_id ?? "pending",
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
      requirements: [],
    };
    group.requirement_ids.push(requirement.id);
    group.amount += requirement.amount;
    group.requirements.push(requirement);
    groups.set(key, group);
  }
  return [...groups.values()];
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
