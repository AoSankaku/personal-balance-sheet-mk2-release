import type { TranslationKey } from "../i18n";

export const budgetTermHelp = {
  budgetReconciliationCash: ["budgetHelpResources", "budget-resources"],
  budgetReconciliationNetBudget: ["budgetHelpNetBalance", "budget-net-balance"],
  budgetReconciliationNetGap: ["budgetHelpNetGap", "budget-net-gap"],
  budgetReconciliationReferenceReserve: ["budgetHelpReferenceReserve", "budget-reference-reserve"],
  budgetReconciliationDepreciationReserve: ["budgetHelpPurchaseReserve", "budget-purchase-reserve"],
  budgetReconciliationDepreciationOffset: ["budgetHelpNonCashOffset", "budget-non-cash-offset"],
  budgetReconciliationAdjustedGap: ["budgetHelpAdjustedGap", "budget-adjusted-gap"],
  budgetReconciliationPositiveClaims: ["budgetHelpPositiveClaims", "budget-positive-claims"],
  budgetFundingReservedLabel: ["budgetHelpSecured", "budget-secured"],
  budgetFundingAvailableLabel: ["budgetHelpFundingGap", "budget-funding-gap"],
  budgetFundingShortageLabel: ["budgetHelpFundingGap", "budget-funding-gap"],
  budgetPlacementUnfundedOverspending: ["budgetHelpOverspending", "budget-overspending"],
  budgetPlacementSurplusShortage: ["budgetHelpPlacementGap", "budget-placement-gap"],
} as const satisfies Partial<Record<TranslationKey, readonly [TranslationKey, string]>>;

export type BudgetHelpTerm = keyof typeof budgetTermHelp;

export function budgetGuideLink(anchor: string): string {
  return `/settings/guides?section=budget#${anchor}`;
}
