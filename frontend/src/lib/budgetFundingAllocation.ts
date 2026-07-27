import type {
  BudgetFundingAllocationInput,
  BudgetFundingKind,
} from "@balance-sheet/shared";

export type LoanDirection = "increase" | "decrease" | "lend" | "collect";

export function fundingKindForLoanDirection(
  direction: LoanDirection,
): BudgetFundingKind {
  if (direction === "increase") return "borrow";
  if (direction === "decrease") return "repay";
  return direction;
}

export function buildBudgetFundingAllocations(
  principal: number,
  categoryAmounts: ReadonlyMap<number, number>,
): BudgetFundingAllocationInput[] {
  const categoryAllocations = [...categoryAmounts.entries()]
    .filter(([, amount]) => Number.isFinite(amount) && amount > 0)
    .map(([budget_category_id, amount]) => ({
      budget_category_id,
      amount,
    }));
  const allocated = categoryAllocations.reduce(
    (sum, allocation) => sum + allocation.amount,
    0,
  );
  if (allocated > principal) {
    throw new Error("budget_funding_allocations_exceed_principal");
  }

  const unallocated = principal - allocated;
  return [
    ...categoryAllocations,
    ...(unallocated > 0
      ? [{ budget_category_id: null, amount: unallocated }]
      : []),
  ];
}

export function suggestLendingFundingSplit(
  principal: number,
  currentUnallocated: number,
) {
  const normalizedPrincipal = Math.max(0, principal);
  const absorbedByUnallocated = Math.min(
    normalizedPrincipal,
    Math.max(0, currentUnallocated),
  );
  return {
    absorbedByUnallocated,
    suggestedCategoryConstraint:
      normalizedPrincipal - absorbedByUnallocated,
  };
}
