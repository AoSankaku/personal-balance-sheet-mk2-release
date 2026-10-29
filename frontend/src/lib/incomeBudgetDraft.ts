import type { BudgetCategory, BudgetFilter, JournalEntry } from "@balance-sheet/shared";
import type { SimpleFormDraft } from "../components/SimpleEntryForm";
import { computeFilterSteps } from "./simpleEntryUtils";

type IncomeDraft = Required<Pick<SimpleFormDraft,
  "isRegularIncome" | "selectedFilterId" | "incomeDist" | "filterStepPreview"
>>;

/** Restore saved amounts; the filter preview is only a reference for later edits. */
export function buildIncomeBudgetDraft(
  entry: JournalEntry,
  categories: BudgetCategory[],
  filters: BudgetFilter[],
  amount: number,
): IncomeDraft {
  const isRegularIncome = entry.is_regular_income === true;
  const filterId = isRegularIncome ? entry.income_budget_filter_id ?? null : null;
  const filter = filters.find(candidate => candidate.id === filterId);
  const name = (id: number) => categories.find(category => category.id === id)?.name ?? `#${id}`;
  const filterStepPreview = filter ? computeFilterSteps(filter.steps, amount, name) : [];
  const savedAmounts = new Map<number, number>();
  for (const allocation of entry.income_budget_allocations ?? []) {
    savedAmounts.set(allocation.budget_category_id,
      (savedAmounts.get(allocation.budget_category_id) ?? 0) + allocation.amount);
  }
  // Missing saved allocations are intentional zeroes, not permission to reapply defaults.
  for (const step of filterStepPreview) {
    for (const allocation of step.allocations) {
      if (!savedAmounts.has(allocation.budget_category_id)) savedAmounts.set(allocation.budget_category_id, 0);
    }
  }
  return {
    isRegularIncome,
    selectedFilterId: filterId == null ? null : String(filterId),
    incomeDist: [...savedAmounts].map(([id, savedAmount]) => ({
      budget_category_id: id, name: name(id), amount: savedAmount,
    })),
    filterStepPreview,
  };
}

export function getIncomeDistributionDirtyIds(
  draft: Pick<SimpleFormDraft, "incomeDist" | "filterStepPreview"> | undefined,
): Set<number> {
  const defaults = new Map<number, number>();
  for (const step of draft?.filterStepPreview ?? []) {
    for (const allocation of step.allocations) {
      defaults.set(allocation.budget_category_id,
        (defaults.get(allocation.budget_category_id) ?? 0) + allocation.amount);
    }
  }
  return new Set((draft?.incomeDist ?? [])
    .filter(row => row.amount !== (defaults.get(row.budget_category_id) ?? 0))
    .map(row => row.budget_category_id));
}
