interface BudgetAdjustmentRefreshActions {
  refreshBudget: () => void | Promise<void>;
  refreshAllocatable: () => void | Promise<void>;
}

export async function refreshAfterBudgetAdjustment({
  refreshBudget,
  refreshAllocatable,
}: BudgetAdjustmentRefreshActions): Promise<void> {
  await Promise.all([refreshBudget(), refreshAllocatable()]);
}
