import type { JournalEntry } from "@balance-sheet/shared";

export interface PendingIncomeTransferSummary {
  taskCount: number;
  taskCountByAccount: Map<number, number>;
}

export function summarizePendingIncomeTransfers(
  journal: JournalEntry[],
): PendingIncomeTransferSummary {
  const groupAccounts = new Map<string, Set<number>>();
  const seenRequirementIds = new Set<number>();

  for (const entry of journal) {
    for (const requirement of entry.income_transfer_requirements ?? []) {
      if (
        requirement.completion_source !== null ||
        seenRequirementIds.has(requirement.id)
      ) {
        continue;
      }
      seenRequirementIds.add(requirement.id);
      const key = [
        requirement.source_income_journal_entry_id,
        requirement.from_account_id,
        requirement.to_account_id,
        requirement.currency.toUpperCase(),
      ].join(":");
      groupAccounts.set(
        key,
        new Set([
          ...(groupAccounts.get(key) ?? []),
          requirement.from_account_id,
          requirement.to_account_id,
        ]),
      );
    }
  }

  const taskCountByAccount = new Map<number, number>();
  for (const accountIds of groupAccounts.values()) {
    for (const accountId of accountIds) {
      taskCountByAccount.set(
        accountId,
        (taskCountByAccount.get(accountId) ?? 0) + 1,
      );
    }
  }

  return { taskCount: groupAccounts.size, taskCountByAccount };
}
