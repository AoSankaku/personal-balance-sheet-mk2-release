import type {
  IncomeTransferRequirementGroup,
  IncomeTransferSettings,
} from "@balance-sheet/shared";
import { partitionIncomeTransfers } from "./incomeTransferScheduling";
import type { BudgetPlacementTransfer } from "./budgetPlacement";

export function splitBudgetPlacementTransfersByDeferral({
  transfers,
  pendingGroups,
  settings,
}: {
  transfers: BudgetPlacementTransfer[];
  pendingGroups: IncomeTransferRequirementGroup[];
  settings: IncomeTransferSettings | null | undefined;
}) {
  const partition = partitionIncomeTransfers({ groups: pendingGroups, settings });
  const fullyDeferred = pendingGroups.length > 0 &&
    partition.actionable.length === 0 &&
    partition.deferred.length > 0;

  return {
    fullyDeferred,
    actionableTransfers: fullyDeferred ? [] : transfers,
    deferredTransfers: fullyDeferred ? transfers : [],
    deferredGroupCount: partition.deferred.length,
  };
}
