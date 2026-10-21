import type { IncomeTransferRequirementGroup } from "@balance-sheet/shared";

/** Remove only the saved requirements represented by the current placement plan. */
export function filterUncoveredIncomeTransfers(
  groups: IncomeTransferRequirementGroup[],
  coveredRequirementIds: number[],
): IncomeTransferRequirementGroup[] {
  const covered = new Set(coveredRequirementIds);
  return groups.flatMap((group) => {
    const requirements = group.requirements.filter(
      (requirement) => !covered.has(requirement.id),
    );
    if (requirements.length === 0) return [];
    const amount = requirements.reduce((sum, requirement) => sum + requirement.amount, 0);
    return [{
      ...group,
      source_income_journal_entry_id: requirements[0]!.source_income_journal_entry_id,
      requirements,
      requirement_ids: requirements.map((requirement) => requirement.id),
      amount,
      is_squashed: requirements.length > 1,
      transfer_journal_entry_id: requirements.every((requirement) => requirement.transfer_journal_entry_id === requirements[0]?.transfer_journal_entry_id)
        ? requirements[0]?.transfer_journal_entry_id ?? null
        : null,
      completion_source: requirements.every((requirement) => requirement.completion_source === requirements[0]?.completion_source)
        ? requirements[0]?.completion_source ?? null
        : null,
    }];
  });
}
