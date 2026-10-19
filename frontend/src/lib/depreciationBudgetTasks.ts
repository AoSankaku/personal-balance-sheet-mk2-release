import type { DepreciationSchedule } from "@balance-sheet/shared";

/** Schedules that need a user decision about their budget treatment. */
export function getDepreciationBudgetTaskSchedules(
  schedules: DepreciationSchedule[],
): DepreciationSchedule[] {
  return schedules.filter(({ budget }) => {
    if (budget.status === "unset" || budget.method == null) return true;
    if (budget.status !== "active" || budget.method === "unallocated") {
      return false;
    }
    return budget.remaining_amount > 0 && budget.future_amount <= 0;
  });
}
