interface BudgetHistoryLog {
  id: number;
  type: string;
  budget_category_id: number;
  amount: number;
  currency?: string | null;
  date: string;
  created_at: string;
  adjustment_type?: string | null;
  is_reference?: boolean | null;
}

function groupKey(log: BudgetHistoryLog) {
  const currency = (log.currency || "JPY").trim().toUpperCase();
  return `${log.budget_category_id}:${currency || "JPY"}`;
}

function isReset(log: BudgetHistoryLog) {
  return log.type === "reset" || log.adjustment_type === "reset";
}

/**
 * Replays category history chronologically and recalculates reset amounts from
 * the balance that actually exists immediately before each reset.
 */
export function replayBudgetHistory<T extends BudgetHistoryLog>(
  logs: T[],
): { logs: T[]; balances: Map<string, number> } {
  const replayedLogs = logs.map((log) => ({ ...log })) as T[];
  const positions = logs.map((_, index) => index);
  positions.sort((leftIndex, rightIndex) => {
    const left = logs[leftIndex]!;
    const right = logs[rightIndex]!;
    return (
      left.date.localeCompare(right.date) ||
      left.created_at.localeCompare(right.created_at) ||
      left.id - right.id
    );
  });

  const runningByGroup = new Map<string, number>();
  const balances = new Map<string, number>();

  for (const index of positions) {
    const log = replayedLogs[index]!;
    const key = groupKey(log);
    let balance = runningByGroup.get(key) ?? 0;

    if (!log.is_reference) {
      if (isReset(log)) {
        log.amount = -balance;
        balance = 0;
      } else {
        balance += log.amount;
      }
    }

    runningByGroup.set(key, balance);
    balances.set(`${log.type}:${log.id}`, balance);
  }

  return { logs: replayedLogs, balances };
}
