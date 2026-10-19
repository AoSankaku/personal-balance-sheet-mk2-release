import type {
  Account,
  IncomeTransferRequirementGroup,
  InterestIncomeRule,
  JournalEntry,
} from "@balance-sheet/shared";

export function buildInterestTransferThresholds(
  thresholds: Record<string, number>,
  enabledCurrencies: Array<{ code: string }>,
  currency: string,
  threshold: number,
): Record<string, number> {
  const enabled = new Set(enabledCurrencies.map(item => item.code.toUpperCase()));
  return Object.fromEntries(
    Object.entries({ ...thresholds, [currency.toUpperCase()]: threshold })
      .filter(([code]) => enabled.has(code.toUpperCase())),
  );
}

export function buildInterestIncomeDefault({
  rule, incomeAccountId, amount, categories,
}: {
  rule: InterestIncomeRule | null | undefined;
  incomeAccountId: number | null;
  amount: number;
  categories: Array<{ id: number; name: string }>;
}) {
  if (!rule || incomeAccountId !== rule.income_account_id) return null;
  const category = categories.find(
    category => category.id === rule.budget_category_id,
  );
  if (!category || !Number.isFinite(amount) || amount < 0) return null;
  return [{ budget_category_id: category.id, name: category.name, amount }];
}

/** Presentation only: every deferred requirement remains pending and can be netted. */
export function partitionInterestIncomeTransfers({
  groups, journal, accounts, rule,
}: {
  groups: IncomeTransferRequirementGroup[];
  journal: JournalEntry[];
  accounts: Account[];
  rule: InterestIncomeRule | null | undefined;
}): {
  actionable: IncomeTransferRequirementGroup[];
  deferred: IncomeTransferRequirementGroup[];
} {
  const deferred: IncomeTransferRequirementGroup[] = [];
  if (!rule || !accounts.some(
    account => account.id === rule.income_account_id && account.type === "income",
  )) {
    return { actionable: groups, deferred };
  }
  const actionable: IncomeTransferRequirementGroup[] = [];
  const entries = new Map(journal.map(entry => [entry.id, entry]));
  const incomeAccountIds = new Set(
    accounts.filter(account => account.type === "income").map(account => account.id),
  );
  const routeKey = (group: IncomeTransferRequirementGroup) =>
    `${group.from_account_id}:${group.to_account_id}:${group.currency.toUpperCase()}`;
  const eligible = new Set<IncomeTransferRequirementGroup>();
  const totals = new Map<string, number>();
  for (const group of groups) {
    if (
      group.completion_source != null || group.requirements.length === 0 ||
      group.requirements.some(requirement => requirement.budget_category_id !== rule.budget_category_id)
    ) continue;
    const entry = entries.get(group.source_income_journal_entry_id);
    if (!entry) continue; // Missing source data must never hide a task.
    const incomeLines = entry.lines.filter(
      line => incomeAccountIds.has(line.account_id) && line.credit > line.debit,
    );
    if (
      incomeLines.length === 0 ||
      incomeLines.some(line => line.account_id !== rule.income_account_id)
    ) continue;
    eligible.add(group);
    totals.set(routeKey(group), (totals.get(routeKey(group)) ?? 0) + group.amount);
  }
  for (const group of groups) {
    const threshold = rule.transfer_thresholds[group.currency.toUpperCase()] ?? 0;
    const total = totals.get(routeKey(group)) ?? 0;
    // Decimal amounts can sum just below an exact currency threshold in JS.
    const belowThreshold = total < threshold &&
      Math.abs(total - threshold) > Number.EPSILON * Math.max(total, threshold, 1) * 8;
    (eligible.has(group) && belowThreshold ? deferred : actionable).push(group);
  }
  return { actionable, deferred };
}
