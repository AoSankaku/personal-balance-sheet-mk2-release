import type { CreateJournalInput, TagExpenseAmount } from "@balance-sheet/shared";

export interface TagExpenseInputState {
  mode: "auto" | "manual";
  amounts: TagExpenseAmount[];
  manualInputs: Record<string, number | string>;
}

/** Normalizes user-entered tag names while preserving the user's first-seen order. */
export function normalizeExpenseTagNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const rawName of names) {
    const name = rawName.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    normalized.push(name);
  }
  return normalized;
}

export function buildSimpleExpenseTagFields(
  names: readonly string[],
): Pick<CreateJournalInput, "expense_tags" | "tag_expense_mode"> {
  return {
    expense_tags: normalizeExpenseTagNames(names),
    tag_expense_mode: "auto",
  };
}

export function resetTagExpenseInputState(): TagExpenseInputState {
  return { mode: "auto", amounts: [], manualInputs: {} };
}

/** Manual amounts are currency-specific; an unmatched currency starts in auto mode. */
export function initializeTagExpenseInputState(
  mode: "auto" | "manual",
  amounts: readonly TagExpenseAmount[],
  selectedCurrency: string,
): TagExpenseInputState {
  if (mode !== "manual" || !amounts.some((item) => item.currency === selectedCurrency)) {
    return resetTagExpenseInputState();
  }
  const savedAmounts = [...amounts];
  return {
    mode: "manual",
    amounts: savedAmounts,
    manualInputs: Object.fromEntries(savedAmounts.map((item) => [item.currency, item.amount])),
  };
}

/** Replaces the active currency's manual tag total and retains other currency overrides. */
export function buildTagExpenseAmounts(
  existing: readonly TagExpenseAmount[],
  currency: string,
  amount: number | string,
): TagExpenseAmount[] {
  const otherCurrencies = existing.filter((item) => item.currency !== currency);
  const parsedAmount = parseTagExpenseAmount(amount);
  if (parsedAmount == null || !Number.isFinite(parsedAmount)) {
    return [...otherCurrencies];
  }
  return [...otherCurrencies, { currency, amount: parsedAmount }];
}

export function parseTagExpenseAmount(value: number | string): number | null {
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Builds the manual amount payload, using the displayed calculation if untouched. */
export function buildManualTagExpenseSubmission(
  existing: readonly TagExpenseAmount[],
  currency: string,
  input: number | string | undefined,
  calculatedAmount: number,
): TagExpenseAmount[] | null {
  const amount = parseTagExpenseAmount(input ?? calculatedAmount);
  return amount == null ? null : buildTagExpenseAmounts(existing, currency, amount);
}
