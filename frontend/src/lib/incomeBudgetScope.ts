import type { CreateJournalInput } from "@balance-sheet/shared";
import {
  isBudgetAccount,
  isBudgetAsset,
  type BudgetScopeAccount,
} from "../../../shared/budgetScope";

type IncomeBudgetSubmissionFields = Pick<
  CreateJournalInput,
  "income_budget_allocations" | "income_transfer_destinations"
>;

/** Income can fund budgets when its destination contributes to budget resources. */
export function canAllocateIncomeBudget(
  destinationAccount: BudgetScopeAccount | undefined,
): boolean {
  return isBudgetAccount(destinationAccount);
}

/**
 * Keep budget allocations for tracked cash and budget-deducted liabilities.
 * Physical transfer tasks only apply to tracked cash destinations.
 */
export function buildIncomeBudgetSubmissionFields(input: {
  destinationAccount: BudgetScopeAccount | undefined;
  incomeBudgetAllocations?: NonNullable<
    CreateJournalInput["income_budget_allocations"]
  >;
  incomeTransferDestinations?: NonNullable<
    CreateJournalInput["income_transfer_destinations"]
  >;
}): IncomeBudgetSubmissionFields {
  // An explicit empty list clears obsolete pending transfer tasks on income updates.
  if (!canAllocateIncomeBudget(input.destinationAccount)) {
    return {
      income_budget_allocations: undefined,
      income_transfer_destinations: [],
    };
  }

  return {
    income_budget_allocations: input.incomeBudgetAllocations,
    income_transfer_destinations: isBudgetAsset(input.destinationAccount)
      ? input.incomeTransferDestinations
      : [],
  };
}
