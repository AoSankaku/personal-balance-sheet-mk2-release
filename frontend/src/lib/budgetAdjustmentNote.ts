export function normalizeBudgetAdjustmentNote(
  note: string | null | undefined,
): string | null {
  const trimmed = note?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}
