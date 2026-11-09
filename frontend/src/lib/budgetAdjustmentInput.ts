import type { BudgetAdjustmentBatchInput } from "@balance-sheet/shared";
import { normalizeBudgetAdjustmentNote } from "./budgetAdjustmentNote";

export function buildBudgetAdjustmentInput({
  date, currency, note, selectedCategoryIds, amounts, decimalPlaces,
}: {
  date: string;
  currency: string;
  note: string;
  selectedCategoryIds: number[];
  amounts: Record<number, number | string>;
  decimalPlaces: number;
}): { input: BudgetAdjustmentBatchInput; total: number } | null {
  const scale = 10 ** decimalPlaces;
  let totalUnits = 0;
  const adjustments: BudgetAdjustmentBatchInput["adjustments"] = [];
  for (const id of [...new Set(selectedCategoryIds)].sort((a, b) => a - b)) {
    const raw = amounts[id] ?? 0;
    const value = typeof raw === "string" && raw.trim() === "" ? 0 : Number(raw);
    const units = Math.round(value * scale);
    if (!Number.isFinite(value) || !Number.isSafeInteger(units) || Math.abs(value * scale - units) > 0.000_001) return null;
    if (units === 0) continue;
    totalUnits += units;
    if (!Number.isSafeInteger(totalUnits)) return null;
    adjustments.push({ budget_category_id: id, adhoc_delta: Number((units / scale).toFixed(decimalPlaces)) });
  }
  return {
    input: { date, currency, note: normalizeBudgetAdjustmentNote(note), adjustments },
    total: Number((totalUnits / scale).toFixed(decimalPlaces)),
  };
}
