import type { BudgetAdjustmentLog } from "@balance-sheet/shared";
import { replayBudgetHistory } from "../../../shared/budgetHistory";

export function budgetAdjustmentLogKey(log: BudgetAdjustmentLog): string {
  return `${log.type}:${log.id}`;
}

export function buildBudgetAdjustmentLogBalanceMap(
  logs: BudgetAdjustmentLog[],
): Map<string, number> {
  return replayBudgetHistory(logs).balances;
}
