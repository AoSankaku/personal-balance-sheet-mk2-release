import type { LongTermLoanBudgetWeight } from "./types";

function order(left: Pick<LongTermLoanBudgetWeight, "budget_category_id">, right: Pick<LongTermLoanBudgetWeight, "budget_category_id">) {
  if (left.budget_category_id === null) return right.budget_category_id === null ? 0 : 1;
  if (right.budget_category_id === null) return -1;
  return left.budget_category_id - right.budget_category_id;
}

function validRow(value: unknown): value is LongTermLoanBudgetWeight {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<LongTermLoanBudgetWeight>;
  return (row.budget_category_id === null || (Number.isSafeInteger(row.budget_category_id) && row.budget_category_id! > 0)) &&
    Number.isSafeInteger(row.weight) && row.weight! > 0;
}

export function validateLoanBudgetWeights(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return "invalid_loan_budget_weights";
  const seen = new Set<number | null>();
  let total = 0n;
  for (const row of value) {
    if (!validRow(row) || seen.has(row.budget_category_id)) return "invalid_loan_budget_weights";
    seen.add(row.budget_category_id);
    total += BigInt(row.weight);
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) return "loan_budget_weight_total_out_of_range";
  return null;
}

function gcd(left: bigint, right: bigint): bigint {
  while (right !== 0n) [left, right] = [right, left % right];
  return left;
}

/** Preserve exact integer ratios; merging also handles categories deleted with SET NULL. */
export function normalizeLoanBudgetWeights(rows: readonly LongTermLoanBudgetWeight[]): LongTermLoanBudgetWeight[] {
  if (rows.length === 0) return [{ budget_category_id: null, weight: 1 }];
  const totals = new Map<number | null, bigint>();
  for (const row of rows) {
    if (!validRow(row)) throw new TypeError("invalid_loan_budget_weights");
    totals.set(row.budget_category_id, (totals.get(row.budget_category_id) ?? 0n) + BigInt(row.weight));
  }
  const divisor = [...totals.values()].reduce((common, weight) => gcd(common, weight), 0n);
  return [...totals].map(([budget_category_id, weight]) => {
    const reduced = weight / divisor;
    if (reduced > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("loan_budget_weight_out_of_range");
    return { budget_category_id, weight: Number(reduced) };
  }).sort(order);
}

export function loanBudgetMinorUnits(amount: number, decimalPlaces: number): number {
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 9 || !Number.isFinite(amount) || amount < 0) {
    throw new RangeError("invalid_loan_budget_amount");
  }
  const units = Math.round(amount * 10 ** decimalPlaces);
  if (!Number.isSafeInteger(units)) throw new RangeError("loan_budget_amount_out_of_range");
  return units;
}

function splitMinorUnits(total: bigint, weights: Array<{ budget_category_id: number | null; weight: bigint }>) {
  const weightTotal = weights.reduce((sum, row) => sum + row.weight, 0n);
  if (weightTotal <= 0n) return weights.map(row => ({ ...row, units: 0n }));
  const rows = weights.map(row => {
    const product = total * row.weight;
    return { ...row, units: product / weightTotal, remainder: product % weightTotal };
  });
  let remainder = total - rows.reduce((sum, row) => sum + row.units, 0n);
  const ranked = [...rows].sort((left, right) => left.remainder === right.remainder ? order(left, right) : left.remainder > right.remainder ? -1 : 1);
  for (const row of ranked) {
    if (remainder === 0n) break;
    row.units += 1n;
    remainder -= 1n;
  }
  return rows;
}

export interface LoanBudgetSettlementProgress {
  settled_minor_units: number;
  settled_allocations: Array<{ budget_category_id: number | null; minor_units: number }>;
  settled_progress_available?: boolean;
}

/** Carry rounding only across the recognized, default-following settlement sequence. */
export function allocateLoanBudgetDefaultMinorUnits(
  minorUnits: number,
  weights: readonly LongTermLoanBudgetWeight[],
  progress?: LoanBudgetSettlementProgress,
): Array<{ budget_category_id: number | null; minor_units: number }> {
  if (!Number.isSafeInteger(minorUnits) || minorUnits < 0) throw new RangeError("invalid_loan_budget_amount");
  const total = BigInt(minorUnits);
  const normalized = normalizeLoanBudgetWeights(weights);
  let splitWeights = normalized.map(row => ({ ...row, weight: BigInt(row.weight) }));
  if (progress) {
    if (progress.settled_progress_available === false) throw new RangeError("loan_budget_progress_unavailable");
    if (!Number.isSafeInteger(progress.settled_minor_units) || progress.settled_minor_units < 0 || !Array.isArray(progress.settled_allocations)) {
      throw new RangeError("invalid_loan_budget_progress");
    }
    const prior = new Map<number | null, bigint>();
    for (const row of progress.settled_allocations) {
      if (!row || (row.budget_category_id !== null && (!Number.isSafeInteger(row.budget_category_id) || row.budget_category_id <= 0)) || !Number.isSafeInteger(row.minor_units) || row.minor_units < 0) {
        throw new RangeError("invalid_loan_budget_progress");
      }
      prior.set(row.budget_category_id, (prior.get(row.budget_category_id) ?? 0n) + BigInt(row.minor_units));
    }
    const settled = BigInt(progress.settled_minor_units);
    if ([...prior.values()].reduce((sum, units) => sum + units, 0n) !== settled) throw new RangeError("invalid_loan_budget_progress");
    const targets = splitMinorUnits(settled + total, splitWeights);
    splitWeights = targets.map(row => ({
      budget_category_id: row.budget_category_id,
      weight: row.units > (prior.get(row.budget_category_id) ?? 0n) ? row.units - (prior.get(row.budget_category_id) ?? 0n) : 0n,
    }));
  }
  const rows = splitMinorUnits(total, splitWeights);
  return rows.map(row => ({ budget_category_id: row.budget_category_id, minor_units: Number(row.units) }));
}

/** Exact largest remainders, with optional carry; category IDs break ties, unallocated last. */
export function allocateLoanBudgetDefaults(
  amount: number,
  weights: readonly LongTermLoanBudgetWeight[],
  decimalPlaces: number,
  progress?: LoanBudgetSettlementProgress,
): Array<{ budget_category_id: number | null; amount: number }> {
  const rows = allocateLoanBudgetDefaultMinorUnits(loanBudgetMinorUnits(amount, decimalPlaces), weights, progress);
  const scale = 10 ** decimalPlaces;
  return rows.map(row => {
    const value = row.minor_units / scale;
    // The API transports numeric amounts. Some very large decimal values have
    // no Number representation that survives the API's minor-unit conversion.
    if (loanBudgetMinorUnits(value, decimalPlaces) !== row.minor_units) {
      throw new RangeError("unrepresentable_loan_budget_amount");
    }
    return { budget_category_id: row.budget_category_id, amount: value };
  });
}
