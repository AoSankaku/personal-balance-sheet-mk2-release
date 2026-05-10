const SAVINGS_BUDGET_GROUP = "貯蓄";

export function shouldShowCarryoverBadge(budgetGroup: string): boolean {
  return budgetGroup !== SAVINGS_BUDGET_GROUP;
}
