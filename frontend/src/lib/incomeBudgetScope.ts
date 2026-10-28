import type { CreateJournalInput } from "@balance-sheet/shared";
import type { Account, BudgetCategory } from "@balance-sheet/shared";
import { resolveIncomeTransferAccounts } from "./incomeTransferAccounts";
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

/** Shared by normal income and bulk discount rows, including transfer scheduling. */
export function buildIncomeBudgetEntryFields(input: {
  destinationAccount: Account | undefined;
  incomeBudgetAllocations?: NonNullable<CreateJournalInput["income_budget_allocations"]>;
  categories: Pick<BudgetCategory, "id" | "target_accounts">[];
  accounts: Account[];
  currency: string;
  transferTargets?: Record<number, number | null>;
  defer?: boolean | null;
}): IncomeBudgetSubmissionFields {
  if (!canAllocateIncomeBudget(input.destinationAccount)) {
    return buildIncomeBudgetSubmissionFields(input);
  }
  const currency = input.currency.toUpperCase();
  const allocations = input.incomeBudgetAllocations?.map(allocation => {
    if (allocation.currency && allocation.currency.toUpperCase() !== currency) {
      throw new Error("income_budget_currency_mismatch");
    }
    return { ...allocation, currency };
  });
  const transfers: NonNullable<CreateJournalInput["income_transfer_destinations"]> = [];
  if (isBudgetAsset(input.destinationAccount)) {
    for (const allocation of allocations ?? []) {
      if (allocation.amount <= 0) continue;
      const need = resolveIncomeTransferAccounts({
        categoryId: allocation.budget_category_id,
        depositAccountId: input.destinationAccount!.id,
        categories: input.categories,
        accounts: input.accounts,
      });
      if (!need.required) continue;
      const target = input.transferTargets?.[allocation.budget_category_id] ??
        (need.accountIds.length === 1 ? need.accountIds[0] : null);
      if (target == null || !need.accountIds.includes(target)) {
        throw new Error("income_transfer_destination_required");
      }
      transfers.push({
        budget_category_id: allocation.budget_category_id,
        from_account_id: input.destinationAccount!.id,
        to_account_id: target,
        amount: allocation.amount,
        currency,
        ...(input.defer === undefined ? {} : { is_deferred: input.defer }),
      });
    }
  }
  return buildIncomeBudgetSubmissionFields({
    destinationAccount: input.destinationAccount,
    incomeBudgetAllocations: allocations,
    incomeTransferDestinations: transfers,
  });
}
