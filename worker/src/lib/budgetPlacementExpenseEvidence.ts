import type { BudgetPlacementReconciliation } from "@balance-sheet/shared";
import { fromStorageMoneyAmount } from "./moneyValidation";

type PlacementEvidence = BudgetPlacementReconciliation["expense_evidence"];

export interface BudgetPlacementExpenseEvidenceInput {
  allocations: Array<{
    journal_entry_id: number;
    budget_category_id: number;
    amount: number;
    date: string;
    description: string;
  }>;
  lines: Array<{
    journal_entry_id: number;
    account_id: number;
    debit: number;
    credit: number;
    currency: string;
  }>;
  accounts: Array<{ id: number; name: string; type: string; category: string }>;
  summaries: Array<{ category: { id: number; name: string } }>;
  groups: Array<{
    group_id: string;
    account_ids: number[];
    categories: Array<{ budget_category_id: number }>;
  }>;
  currency: string;
  decimalPlacesByCurrency: Record<string, number | null | undefined>;
}

/**
 * Builds display-only expense evidence from rows already filtered by currency,
 * date, reference status, and the latest applicable budget reset.
 */
export function buildBudgetPlacementExpenseEvidence({
  allocations,
  lines,
  accounts,
  summaries,
  groups,
  currency,
  decimalPlacesByCurrency,
}: BudgetPlacementExpenseEvidenceInput): PlacementEvidence {
  const summaryById = new Map(summaries.map(row => [row.category.id, row]));
  const accountById = new Map(accounts.map(row => [row.id, row]));
  const groupByCategory = new Map<number, string>();
  for (const group of groups) {
    for (const category of group.categories) groupByCategory.set(category.budget_category_id, group.group_id);
  }
  const groupById = new Map(groups.map(group => [group.group_id, group]));

  const allocationsByEntryId = new Map<number, typeof allocations>();
  for (const row of allocations) {
    let entryAllocations = allocationsByEntryId.get(row.journal_entry_id);
    if (!entryAllocations) {
      entryAllocations = [];
      allocationsByEntryId.set(row.journal_entry_id, entryAllocations);
    }
    entryAllocations.push(row);
  }

  const linesByEntryId = new Map<number, typeof lines>();
  for (const row of lines) {
    let entryLines = linesByEntryId.get(row.journal_entry_id);
    if (!entryLines) {
      entryLines = [];
      linesByEntryId.set(row.journal_entry_id, entryLines);
    }
    entryLines.push(row);
  }

  const evidence: PlacementEvidence = [];
  for (const [entryId, entryAllocations] of allocationsByEntryId) {
    const entryLines = linesByEntryId.get(entryId) ?? [];
    const payments = entryLines.filter(row => row.credit > 0 && accountById.get(row.account_id)?.type === "asset" && accountById.get(row.account_id)?.category === "cash");
    const expenseDebits = entryLines.filter(row => row.debit > 0 && accountById.get(row.account_id)?.type === "expense");
    if (entryLines.length !== 2 || payments.length !== 1 || expenseDebits.length !== 1 || entryAllocations.reduce((sum, row) => sum + Math.abs(row.amount), 0) !== payments[0]!.credit) continue;

    for (const row of entryAllocations) {
      const groupId = groupByCategory.get(row.budget_category_id);
      const category = summaryById.get(row.budget_category_id)?.category;
      const account = accountById.get(payments[0]!.account_id);
      if (groupId && category && account && !groupById.get(groupId)?.account_ids.includes(account.id)) {
        evidence.push({
          journal_entry_id: row.journal_entry_id,
          date: row.date,
          description: row.description,
          budget_category_id: row.budget_category_id,
          budget_category_name: category.name,
          from_account_id: account.id,
          from_account_name: account.name,
          to_group_id: groupId,
          amount: Math.abs(fromStorageMoneyAmount(row.amount, currency, { decimalPlacesByCurrency })),
        });
      }
    }
  }
  return evidence;
}
