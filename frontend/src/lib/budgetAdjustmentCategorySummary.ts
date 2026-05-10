import type { BudgetAdjustmentLog } from "@balance-sheet/shared";
import { sortBudgetAdjustmentLogs } from "./budgetAdjustmentLogSort";

export interface BudgetAdjustmentCategorySummary {
  budget_category_id: number;
  budget_category_name: string | null;
  adjustment_total: number;
  adjusted_total: number;
  entry_count: number;
  latest_log: BudgetAdjustmentLog;
  logs: BudgetAdjustmentLog[];
  log_balances: {
    log: BudgetAdjustmentLog;
    adjusted_total_after: number;
  }[];
}

export function summarizeBudgetAdjustmentLogsByCategory(
  logs: BudgetAdjustmentLog[],
  budgetCategoryOrderIds: number[] = [],
  availableByCategoryId: ReadonlyMap<number, number> = new Map(),
): BudgetAdjustmentCategorySummary[] {
  const groups = new Map<number, BudgetAdjustmentLog[]>();
  const categoryOrder = new Map(
    budgetCategoryOrderIds.map((id, index) => [id, index]),
  );

  for (const log of logs) {
    const group = groups.get(log.budget_category_id) ?? [];
    group.push(log);
    groups.set(log.budget_category_id, group);
  }

  return [...groups.entries()]
    .map(([budgetCategoryId, groupLogs]) => {
      const sortedLogs = sortBudgetAdjustmentLogs(groupLogs, {
        key: "date",
        dir: "desc",
      });
      const latestLog = sortedLogs[0]!;
      const adjustedTotal = groupLogs.reduce((sum, log) => sum + log.amount, 0);
      let balanceAfter = adjustedTotal;
      const logBalances = sortedLogs.map((log) => {
        const row = { log, adjusted_total_after: balanceAfter };
        balanceAfter -= log.amount;
        return row;
      });
      return {
        budget_category_id: budgetCategoryId,
        budget_category_name: latestLog.budget_category_name,
        adjustment_total: adjustedTotal,
        adjusted_total:
          availableByCategoryId.get(budgetCategoryId) ?? adjustedTotal,
        entry_count: groupLogs.length,
        latest_log: latestLog,
        logs: sortedLogs,
        log_balances: logBalances,
      };
    })
    .sort(
      (a, b) =>
        (categoryOrder.get(a.budget_category_id) ??
          Number.MAX_SAFE_INTEGER) -
          (categoryOrder.get(b.budget_category_id) ??
            Number.MAX_SAFE_INTEGER) ||
        b.latest_log.date.localeCompare(a.latest_log.date) ||
        b.latest_log.created_at.localeCompare(a.latest_log.created_at) ||
        b.latest_log.id - a.latest_log.id,
    );
}
