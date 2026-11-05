import type { BudgetCategorySummary } from "@balance-sheet/shared";
import { getOverviewBudgetUsagePercentage } from "./overviewSummaryLoading";

export interface BudgetUsagePresentation {
  spending: number;
  fundingOut: number;
  fundingIn: number;
  used: number;
  beforeUsage: number;
  available: number;
  reference: number;
  percentage: number | null;
}

export function presentBudgetUsage(summary: BudgetCategorySummary): BudgetUsagePresentation {
  const fundingOut = summary.depreciation_funding_out ?? 0;
  // Monthly funding already reduced total_budget. Restore it only in this
  // display denominator, so beforeUsage - used still equals the saved balance.
  const beforeUsage = summary.total_budget + fundingOut;
  const used = summary.spent + fundingOut;
  return {
    spending: summary.spent,
    fundingOut,
    fundingIn: summary.depreciation_funding_in ?? 0,
    used,
    beforeUsage,
    available: summary.available,
    reference: summary.reference_spent ?? 0,
    percentage: getOverviewBudgetUsagePercentage(beforeUsage, used),
  };
}

export function summarizeBudgetUsage(summaries: readonly BudgetCategorySummary[]): BudgetUsagePresentation {
  const total = summaries.reduce((sum, summary) => {
    const usage = presentBudgetUsage(summary);
    return {
      spending: sum.spending + usage.spending,
      fundingOut: sum.fundingOut + usage.fundingOut,
      fundingIn: sum.fundingIn + usage.fundingIn,
      used: sum.used + usage.used,
      beforeUsage: sum.beforeUsage + usage.beforeUsage,
      available: sum.available + usage.available,
      reference: sum.reference + usage.reference,
    };
  }, { spending: 0, fundingOut: 0, fundingIn: 0, used: 0, beforeUsage: 0, available: 0, reference: 0 });
  return { ...total, percentage: getOverviewBudgetUsagePercentage(total.beforeUsage, total.used) };
}
