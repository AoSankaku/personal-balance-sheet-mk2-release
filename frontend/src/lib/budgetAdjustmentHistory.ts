import type { BudgetAdjustmentLog } from "@balance-sheet/shared";

export interface BudgetAdjustmentResetBoundary {
  id: number;
  date: string;
  created_at: string;
}

function compareLogPosition(
  log: Pick<BudgetAdjustmentLog, "id" | "date" | "created_at">,
  boundary: BudgetAdjustmentResetBoundary,
) {
  return (
    log.date.localeCompare(boundary.date) ||
    log.created_at.localeCompare(boundary.created_at) ||
    log.id - boundary.id
  );
}

function isLogAtOrAfterBoundary(
  log: BudgetAdjustmentLog,
  boundary: BudgetAdjustmentResetBoundary,
) {
  if (
    log.id === boundary.id &&
    log.date === boundary.date &&
    log.created_at === boundary.created_at &&
    (log.type === "reset" || log.adjustment_type === "reset")
  ) {
    return true;
  }
  if (log.date !== boundary.date) return log.date > boundary.date;
  return log.created_at > boundary.created_at;
}

export function buildLatestBudgetResetByCategory(
  logs: BudgetAdjustmentLog[],
): Map<number, BudgetAdjustmentResetBoundary> {
  const result = new Map<number, BudgetAdjustmentResetBoundary>();

  for (const log of logs) {
    if (log.type !== "reset" && log.adjustment_type !== "reset") continue;
    const boundary = {
      id: log.id,
      date: log.date,
      created_at: log.created_at,
    };
    const current = result.get(log.budget_category_id);
    if (!current || compareLogPosition(log, current) > 0) {
      result.set(log.budget_category_id, boundary);
    }
  }

  return result;
}

export function filterBudgetAdjustmentHistory(
  logs: BudgetAdjustmentLog[],
  options: {
    from?: string;
    to?: string;
    showBeforeLatestReset: boolean;
  },
): BudgetAdjustmentLog[] {
  const latestResetByCategory = buildLatestBudgetResetByCategory(logs);

  return logs.filter((log) => {
    if (options.from && log.date < options.from) return false;
    if (options.to && log.date > options.to) return false;
    if (options.showBeforeLatestReset) return true;

    const boundary = latestResetByCategory.get(log.budget_category_id);
    return !boundary || isLogAtOrAfterBoundary(log, boundary);
  });
}
