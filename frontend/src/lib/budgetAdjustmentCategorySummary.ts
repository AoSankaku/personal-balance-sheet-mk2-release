import type { BudgetAdjustmentLog } from "@balance-sheet/shared";
import { replayBudgetHistory } from "../../../shared/budgetHistory";
import { sortBudgetAdjustmentLogs } from "./budgetAdjustmentLogSort";
import { budgetAdjustmentLogKey } from "./budgetAdjustmentLogBalances";

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
  historyBalanceByKey?: ReadonlyMap<string, number>,
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
      const localReplay = historyBalanceByKey
        ? null
        : replayBudgetHistory(groupLogs);
      const categoryLogs = localReplay?.logs ?? groupLogs;
      const balanceByKey = historyBalanceByKey ?? localReplay!.balances;
      const sortedLogs = sortBudgetAdjustmentLogs(categoryLogs, {
        key: "date",
        dir: "desc",
      });
      const latestLog = sortedLogs[0]!;
      const adjustedTotal = groupLogs.reduce(
        (sum, log) => sum + (log.is_reference ? 0 : log.amount),
        0,
      );
      const logBalances = sortedLogs.map((log) => ({
        log,
        adjusted_total_after:
          balanceByKey.get(budgetAdjustmentLogKey(log)) ?? 0,
      }));
      const balanceAtLatestLog =
        balanceByKey.get(budgetAdjustmentLogKey(latestLog));
      return {
        budget_category_id: budgetCategoryId,
        budget_category_name: latestLog.budget_category_name,
        adjustment_total: adjustedTotal,
        adjusted_total:
          availableByCategoryId.get(budgetCategoryId) ??
          balanceAtLatestLog ??
          adjustedTotal,
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
