import type {
  BudgetPlacementReconciliation,
  IncomeTransferRequirementGroup,
  IncomeTransferSettings,
  JournalEntry,
} from "@balance-sheet/shared";
import { filterUncoveredIncomeTransfers } from "./incomeTransferPlacementTasks";
import { partitionIncomeTransfers } from "./incomeTransferScheduling";
import { splitBudgetPlacementTransfersByDeferral } from "./budgetPlacementDeferral";

export interface PendingReconciliationTransfersSummary {
  taskCount: number;
  taskCountByAccount: Map<number, number>;
  actionableTaskCount: number;
  deferredTaskCount: number;
  previewStatus: "ready" | "loading" | "unavailable";
}

function groupPendingRequirements(
  journal: JournalEntry[],
  currency: string,
): IncomeTransferRequirementGroup[] {
  const groups = new Map<string, IncomeTransferRequirementGroup>();
  const seenIds = new Set<number>();
  const normalizedCurrency = currency.toUpperCase();

  for (const entry of journal) {
    for (const requirement of entry.income_transfer_requirements ?? []) {
      if (
        requirement.completion_source !== null ||
        requirement.currency.toUpperCase() !== normalizedCurrency ||
        seenIds.has(requirement.id)
      ) {
        continue;
      }
      seenIds.add(requirement.id);
      const key = [
        requirement.source_income_journal_entry_id,
        requirement.from_account_id,
        requirement.to_account_id,
        normalizedCurrency,
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
      group.is_squashed = group.requirements.length > 1;
      groups.set(key, group);
    }
  }
  return [...groups.values()];
}

function incrementAccountTask(
  counts: Map<number, number>,
  fromAccountId: number,
  toAccountId: number,
) {
  for (const accountId of new Set([fromAccountId, toAccountId])) {
    counts.set(accountId, (counts.get(accountId) ?? 0) + 1);
  }
}

/** Summarize actionable work without changing the selected reconciliation snapshot. */
export function summarizePendingReconciliationTransfers({
  journal,
  plan,
  settings,
  currency,
  loading = false,
  error = null,
}: {
  journal: JournalEntry[];
  plan: BudgetPlacementReconciliation | null;
  settings?: IncomeTransferSettings | null;
  currency: string;
  loading?: boolean;
  error?: unknown;
}): PendingReconciliationTransfersSummary {
  const normalizedCurrency = currency.toUpperCase();
  const currentPlan = plan?.currency.toUpperCase() === normalizedCurrency ? plan : null;
  const previewStatus = loading
    ? "loading"
    : error != null || currentPlan === null
      ? "unavailable"
      : "ready";
  const unresolvedRequirementIds = new Set(currentPlan?.unresolved_requirement_ids ?? []);
  const coveredRequirementIds = (currentPlan?.requirement_ids ?? []).filter(
    (id) => !unresolvedRequirementIds.has(id),
  );
  const pendingGroups = groupPendingRequirements(journal, normalizedCurrency);
  const uncoveredGroups = filterUncoveredIncomeTransfers(
    pendingGroups,
    coveredRequirementIds,
  );
  const incomePartition = partitionIncomeTransfers({
    groups: uncoveredGroups,
    settings,
  });
  const selectedPlanGroups = (currentPlan?.pending_transfers ?? []).filter(
    (group) => group.currency.toUpperCase() === normalizedCurrency,
  );
  const planTransfers = (currentPlan?.transfers ?? []).filter(
    (transfer) => transfer.currency.toUpperCase() === normalizedCurrency,
  );
  const placementPartition = splitBudgetPlacementTransfersByDeferral({
    transfers: planTransfers,
    pendingGroups: selectedPlanGroups,
    settings,
  });

  const taskCountByAccount = new Map<number, number>();
  for (const group of uncoveredGroups) {
    incrementAccountTask(taskCountByAccount, group.from_account_id, group.to_account_id);
  }
  for (const transfer of planTransfers) {
    incrementAccountTask(taskCountByAccount, transfer.from_account_id, transfer.to_account_id);
  }

  const actionableTaskCount =
    incomePartition.actionable.length + placementPartition.actionableTransfers.length;
  const deferredTaskCount =
    incomePartition.deferred.length + placementPartition.deferredTransfers.length;
  return {
    taskCount: actionableTaskCount + deferredTaskCount,
    taskCountByAccount,
    actionableTaskCount,
    deferredTaskCount,
    previewStatus,
  };
}
