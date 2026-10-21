import type { IncomeTransferRequirement, IncomeTransferRequirementGroup, IncomeTransferSettings } from "@balance-sheet/shared";

export function getIncomeTransferDeferralState(requirements: IncomeTransferRequirement[]): boolean | null | undefined {
  const pending = requirements.filter(requirement => requirement.completion_source == null);
  if (pending.length === 0) return null;
  const states = new Set(pending.map(requirement => requirement.is_deferred ?? null));
  return states.size === 1 ? [...states][0] : undefined;
}

export function buildIncomeTransferThresholds(
  thresholds: Record<string, number>, enabledCurrencies: Array<{ code: string }>,
  currency: string, threshold: number,
): Record<string, number> {
  const enabled = new Set(enabledCurrencies.map(item => item.code.toUpperCase()));
  return Object.fromEntries(
    Object.entries({ ...thresholds, [currency.toUpperCase()]: threshold })
      .filter(([code]) => enabled.has(code.toUpperCase())),
  );
}

/** Display policy only. Deferred requirements retain their allocations and remain nettable. */
export function partitionIncomeTransfers({ groups, settings }: {
  groups: IncomeTransferRequirementGroup[];
  settings: IncomeTransferSettings | null | undefined;
}): { actionable: IncomeTransferRequirementGroup[]; deferred: IncomeTransferRequirementGroup[] } {
  const actionable: IncomeTransferRequirementGroup[] = [];
  const deferred: IncomeTransferRequirementGroup[] = [];
  const key = (group: IncomeTransferRequirementGroup) =>
    `${group.from_account_id}:${group.to_account_id}:${group.currency.toUpperCase()}`;
  const totals = new Map<string, number>();
  for (const group of groups) {
    if (group.completion_source == null) {
      totals.set(key(group), (totals.get(key(group)) ?? 0) + group.amount);
    }
  }
  for (const group of groups) {
    const threshold = settings?.transfer_thresholds[group.currency.toUpperCase()] ?? 0;
    const total = totals.get(key(group)) ?? 0;
    const belowThreshold = total < threshold &&
      Math.abs(total - threshold) > Number.EPSILON * Math.max(total, threshold, 1) * 8;
    const explicitlyDeferred = group.requirements.length > 0 &&
      group.requirements.every(requirement => requirement.is_deferred === true);
    const explicitlyReady = group.requirements.some(requirement => requirement.is_deferred === false);
    const shouldDefer = group.completion_source == null &&
      (explicitlyDeferred || (!explicitlyReady && belowThreshold));
    (shouldDefer ? deferred : actionable).push(group);
  }
  return { actionable, deferred };
}
