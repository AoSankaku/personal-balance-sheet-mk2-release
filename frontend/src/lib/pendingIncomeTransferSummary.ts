import type {
  Account, IncomeTransferRequirementGroup, InterestIncomeRule, JournalEntry,
} from "@balance-sheet/shared";
import { partitionInterestIncomeTransfers } from "./interestIncome";

export interface PendingIncomeTransferSummary {
  taskCount: number;
  taskCountByAccount: Map<number, number>;
  actionableTaskCount: number;
  deferredTaskCount: number;
}

export function summarizePendingIncomeTransfers(
  journal: JournalEntry[],
  interest?: { accounts: Account[]; rule: InterestIncomeRule | null | undefined },
): PendingIncomeTransferSummary {
  const groupAccounts = new Map<string, Set<number>>();
  const seenRequirementIds = new Set<number>();
  const groups = new Map<string, IncomeTransferRequirementGroup>();

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
      const group = groups.get(key) ?? {
        key,
        requirement_ids: [],
        source_income_journal_entry_id: requirement.source_income_journal_entry_id,
        from_account_id: requirement.from_account_id,
        to_account_id: requirement.to_account_id,
        amount: 0,
        currency: requirement.currency,
        transfer_journal_entry_id: null,
        completion_source: null,
        is_squashed: false,
        requirements: [],
      };
      group.requirement_ids.push(requirement.id);
      group.requirements.push(requirement);
      group.amount += requirement.amount;
      groups.set(key, group);
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

  const deferredTaskCount = interest
    ? partitionInterestIncomeTransfers({ groups: [...groups.values()], journal, ...interest }).deferred.length
    : 0;
  return {
    taskCount: groupAccounts.size,
    taskCountByAccount,
    actionableTaskCount: groupAccounts.size - deferredTaskCount,
    deferredTaskCount,
  };
}
