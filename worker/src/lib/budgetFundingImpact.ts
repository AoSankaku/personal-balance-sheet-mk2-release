import type {
  Account,
  BudgetFundingKind,
} from "@balance-sheet/shared";

const LOAN_CATEGORIES = new Set<Account["category"]>([
  "short_term_loan",
  "loan",
  "long_term_loan",
]);
const LENDING_CATEGORIES = new Set<Account["category"]>([
  "lending",
  "short_term_lending",
  "long_term_lending",
]);

export interface BudgetFundingImpactComponent {
  kind: BudgetFundingKind;
  principal_amount: number;
  applied_amount: number;
  component_only_amount: number;
}

export interface BudgetFundingImpact {
  allocatable_asset_delta: number;
  components: BudgetFundingImpactComponent[];
}

export interface WeightedAmount<Key> {
  key: Key;
  weight: number;
}

/**
 * Splits an amount expressed in the currency's smallest unit. Ties retain input
 * order so editing the same entry always produces the same persisted split.
 */
export function splitAmountByLargestRemainder<Key>(
  total: number,
  items: WeightedAmount<Key>[],
): Array<{ key: Key; amount: number }> {
  const normalizedTotal = Math.max(0, Math.round(total));
  const positive = items.map((item, index) => ({
    ...item,
    index,
    weight: Math.max(0, item.weight),
  }));
  const weightTotal = positive.reduce((sum, item) => sum + item.weight, 0);
  if (weightTotal <= 0) {
    return positive.map((item) => ({ key: item.key, amount: 0 }));
  }

  const portions = positive.map((item) => {
    const exact = (normalizedTotal * item.weight) / weightTotal;
    const floor = Math.floor(exact);
    return { ...item, amount: floor, remainder: exact - floor };
  });
  let left =
    normalizedTotal - portions.reduce((sum, portion) => sum + portion.amount, 0);
  const order = [...portions].sort(
    (a, b) => b.remainder - a.remainder || a.index - b.index,
  );
  for (let index = 0; left > 0; index += 1, left -= 1) {
    order[index % order.length]!.amount += 1;
  }
  return portions.map((portion) => ({
    key: portion.key,
    amount: portion.amount,
  }));
}

function isAllocatableAsset(account: Account | undefined): boolean {
  return Boolean(
    account &&
      account.type === "asset" &&
      account.category === "cash" &&
      account.include_in_allocatable !== false &&
      account.is_depreciable !== true,
  );
}

function principalKind(
  account: Account | undefined,
  netDebit: number,
): BudgetFundingKind | null {
  if (!account || netDebit === 0) return null;
  if (LENDING_CATEGORIES.has(account.category)) {
    return netDebit > 0 ? "lend" : "collect";
  }
  if (LOAN_CATEGORIES.has(account.category)) {
    return netDebit > 0 ? "repay" : "borrow";
  }
  return null;
}

function roundCurrency(value: number, decimalPlaces: number): number {
  const scale = 10 ** decimalPlaces;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

export function calculateBudgetFundingImpact(input: {
  lines: Array<{
    account_id: number;
    debit?: number;
    credit?: number;
    currency?: string;
  }>;
  accounts: Account[];
  currency: string;
  decimalPlaces?: number;
}): BudgetFundingImpact {
  const currency = input.currency.toUpperCase();
  const decimalPlaces = input.decimalPlaces ?? 0;
  const scale = 10 ** decimalPlaces;
  const accountMap = new Map(input.accounts.map((account) => [account.id, account]));
  const netByAccount = new Map<number, number>();
  let allocatableAssetDelta = 0;

  for (const line of input.lines) {
    if ((line.currency || "JPY").toUpperCase() !== currency) continue;
    const netDebit = (line.debit ?? 0) - (line.credit ?? 0);
    const account = accountMap.get(line.account_id);
    if (isAllocatableAsset(account)) allocatableAssetDelta += netDebit;
    netByAccount.set(
      line.account_id,
      (netByAccount.get(line.account_id) ?? 0) + netDebit,
    );
  }

  const principal = new Map<BudgetFundingKind, number>();
  for (const [accountId, netDebit] of netByAccount) {
    const kind = principalKind(accountMap.get(accountId), netDebit);
    if (!kind) continue;
    principal.set(
      kind,
      (principal.get(kind) ?? 0) + Math.abs(netDebit),
    );
  }

  const appliedByKind = new Map<BudgetFundingKind, number>();
  const allocateDirection = (
    capacity: number,
    kinds: BudgetFundingKind[],
  ) => {
    const candidates = kinds
      .map((kind) => ({ key: kind, weight: principal.get(kind) ?? 0 }))
      .filter((item) => item.weight > 0);
    const principalTotal = candidates.reduce(
      (sum, candidate) => sum + candidate.weight,
      0,
    );
    const applicable = Math.min(Math.max(0, capacity), principalTotal);
    for (const item of splitAmountByLargestRemainder(
      Math.round(applicable * scale),
      candidates,
    )) {
      appliedByKind.set(item.key, item.amount / scale);
    }
  };

  allocateDirection(allocatableAssetDelta, ["borrow", "collect"]);
  allocateDirection(-allocatableAssetDelta, ["repay", "lend"]);

  const kindOrder: BudgetFundingKind[] = [
    "borrow",
    "repay",
    "lend",
    "collect",
  ];
  const components = kindOrder.flatMap((kind) => {
    const principalAmount = roundCurrency(principal.get(kind) ?? 0, decimalPlaces);
    if (principalAmount <= 0) return [];
    const appliedAmount = roundCurrency(
      Math.min(principalAmount, appliedByKind.get(kind) ?? 0),
      decimalPlaces,
    );
    return [{
      kind,
      principal_amount: principalAmount,
      applied_amount: appliedAmount,
      component_only_amount: roundCurrency(
        principalAmount - appliedAmount,
        decimalPlaces,
      ),
    }];
  });

  return {
    allocatable_asset_delta: roundCurrency(
      allocatableAssetDelta,
      decimalPlaces,
    ),
    components,
  };
}
