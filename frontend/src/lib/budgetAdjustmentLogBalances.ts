import type { BudgetAdjustmentLog } from "@balance-sheet/shared";
import { sortBudgetAdjustmentLogs } from "./budgetAdjustmentLogSort";

export function budgetAdjustmentLogKey(log: BudgetAdjustmentLog): string {
  return `${log.type}:${log.id}`;
}

export function buildBudgetAdjustmentLogBalanceMap(
  logs: BudgetAdjustmentLog[],
): Map<string, number> {
  const groups = new Map<number, BudgetAdjustmentLog[]>();

  for (const log of logs) {
    const group = groups.get(log.budget_category_id) ?? [];
    group.push(log);
    groups.set(log.budget_category_id, group);
  }

  const balances = new Map<string, number>();
  for (const groupLogs of groups.values()) {
    const sortedLogs = sortBudgetAdjustmentLogs(groupLogs, {
      key: "date",
      dir: "desc",
    });
    let balanceAfter = groupLogs.reduce((sum, log) => sum + log.amount, 0);
    for (const log of sortedLogs) {
      balances.set(budgetAdjustmentLogKey(log), balanceAfter);
      balanceAfter -= log.amount;
    }
  }

  return balances;
}
