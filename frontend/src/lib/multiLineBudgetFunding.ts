import type {
  Account,
  BudgetFundingComponentInput,
  BudgetFundingKind,
  CreateJournalLineInput,
} from "@balance-sheet/shared";

const lending = new Set<Account["category"]>([
  "lending",
  "short_term_lending",
  "long_term_lending",
]);
const borrowing = new Set<Account["category"]>([
  "short_term_loan",
  "loan",
  "long_term_loan",
]);

export interface FundingImpactComponent {
  kind: BudgetFundingKind;
  principal_amount: number;
  applied_amount: number;
  component_only_amount: number;
}

export function splitByLargestRemainder(
  total: number,
  weights: number[],
  decimalPlaces: number,
): number[] {
  const scale = 10 ** decimalPlaces;
  const totalUnits = Math.max(0, Math.round(total * scale));
  const weightUnits = weights.map((weight) =>
    Math.max(0, Math.round(weight * scale)),
  );
  const weightTotal = weightUnits.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal === 0) return weights.map(() => 0);
  const shares = weightUnits.map((weight, index) => {
    const exact = (totalUnits * weight) / weightTotal;
    const floor = Math.floor(exact);
    return { index, units: floor, remainder: exact - floor };
  });
  let remaining =
    totalUnits - shares.reduce((sum, share) => sum + share.units, 0);
  shares
    .slice()
    .sort(
      (left, right) =>
        right.remainder - left.remainder || left.index - right.index,
    )
    .forEach((share) => {
      if (remaining <= 0) return;
      shares[share.index]!.units += 1;
      remaining -= 1;
    });
  return shares.map((share) =>
    Number((share.units / scale).toFixed(decimalPlaces)),
  );
}

export function calculateMultiLineBudgetFundingImpact(input: {
  lines: CreateJournalLineInput[];
  accounts: Account[];
  currency: string;
  decimalPlaces?: number;
}): { allocatable_asset_delta: number; components: FundingImpactComponent[] } {
  const currency = input.currency.toUpperCase();
  const accountMap = new Map(input.accounts.map((account) => [account.id, account]));
  const netByAccount = new Map<number, number>();
  let cashDelta = 0;
  for (const line of input.lines) {
    if ((line.currency || "JPY").toUpperCase() !== currency) continue;
    const net = line.debit - line.credit;
    const account = accountMap.get(line.account_id);
    if (
      account?.type === "asset" &&
      account.category === "cash" &&
      account.include_in_allocatable !== false &&
      !account.is_depreciable
    ) {
      cashDelta += net;
    }
    netByAccount.set(line.account_id, (netByAccount.get(line.account_id) ?? 0) + net);
  }
  const principal = new Map<BudgetFundingKind, number>();
  for (const [accountId, net] of netByAccount) {
    const account = accountMap.get(accountId);
    let kind: BudgetFundingKind | null = null;
    if (account && lending.has(account.category)) {
      kind = net > 0 ? "lend" : net < 0 ? "collect" : null;
    } else if (account && borrowing.has(account.category)) {
      kind = net > 0 ? "repay" : net < 0 ? "borrow" : null;
    }
    if (kind) principal.set(kind, (principal.get(kind) ?? 0) + Math.abs(net));
  }
  const positiveKinds: BudgetFundingKind[] = ["borrow", "collect"];
  const negativeKinds: BudgetFundingKind[] = ["repay", "lend"];
  const applied = new Map<BudgetFundingKind, number>();
  const allocate = (capacity: number, kinds: BudgetFundingKind[]) => {
    const weights = kinds.map((kind) => principal.get(kind) ?? 0);
    const total = weights.reduce((sum, amount) => sum + amount, 0);
    const usable = Math.min(Math.max(0, capacity), total);
    const shares = splitByLargestRemainder(
      usable,
      weights,
      input.decimalPlaces ?? 0,
    );
    kinds.forEach((kind, index) => {
      applied.set(kind, Math.min(weights[index]!, shares[index]!));
    });
  };
  allocate(cashDelta, positiveKinds);
  allocate(-cashDelta, negativeKinds);
  const order: BudgetFundingKind[] = ["borrow", "repay", "lend", "collect"];
  return {
    allocatable_asset_delta: cashDelta,
    components: order.flatMap((kind) => {
      const principalAmount = principal.get(kind) ?? 0;
      if (principalAmount <= 0) return [];
      const appliedAmount = Math.min(principalAmount, applied.get(kind) ?? 0);
      return [{
        kind,
        principal_amount: principalAmount,
        applied_amount: appliedAmount,
        component_only_amount: principalAmount - appliedAmount,
      }];
    }),
  };
}

export function buildFundingComponentInput(input: {
  component: FundingImpactComponent;
  appliedAmount: number;
  categoryAmounts: Record<number, number>;
  currency: string;
  decimalPlaces?: number;
  sourceJournalEntryIds?: number[];
}): BudgetFundingComponentInput {
  const decimalPlaces = input.decimalPlaces ?? 0;
  const scale = 10 ** decimalPlaces;
  const toAmount = (units: number) =>
    Number((units / scale).toFixed(decimalPlaces));
  const principalUnits = Math.round(
    input.component.principal_amount * scale,
  );
  const appliedUnits = Math.min(
    principalUnits,
    Math.max(0, Math.round(input.appliedAmount * scale)),
  );
  const principal = toAmount(principalUnits);
  const applied = toAmount(appliedUnits);
  const categoryRows = Object.entries(input.categoryAmounts)
    .map(([categoryId, amount]) => ({
      budget_category_id: Number(categoryId),
      units: Math.max(0, Math.round(amount * scale)),
    }))
    .filter((row) => row.units > 0);
  const categoryTotalUnits = categoryRows.reduce(
    (sum, row) => sum + row.units,
    0,
  );
  if (categoryTotalUnits > principalUnits) {
    throw new Error("budget_funding_allocations_exceed_principal");
  }
  const totals = [
    ...categoryRows,
    ...(principalUnits - categoryTotalUnits > 0
      ? [{
          budget_category_id: null,
          units: principalUnits - categoryTotalUnits,
        }]
      : []),
  ];
  const appliedParts = splitByLargestRemainder(
    applied,
    totals.map((row) => toAmount(row.units)),
    decimalPlaces,
  ).map((amount) => Math.round(amount * scale));
  const allocations = totals.flatMap((row, index) => {
    const appliedPartUnits = Math.min(row.units, appliedParts[index] ?? 0);
    const componentOnlyUnits = row.units - appliedPartUnits;
    return [
      ...(appliedPartUnits > 0
        ? [{
            budget_category_id: row.budget_category_id,
            amount: toAmount(appliedPartUnits),
            currency: input.currency,
            effect: "apply" as const,
            source_journal_entry_id: input.sourceJournalEntryIds?.[0] ?? null,
          }]
        : []),
      ...(componentOnlyUnits > 0
        ? [{
            budget_category_id: row.budget_category_id,
            amount: toAmount(componentOnlyUnits),
            currency: input.currency,
            effect: "component_only" as const,
            source_journal_entry_id: input.sourceJournalEntryIds?.[0] ?? null,
          }]
        : []),
    ];
  });
  return {
    kind: input.component.kind,
    principal_amount: principal,
    applied_amount: applied,
    component_only_amount: toAmount(principalUnits - appliedUnits),
    allocations,
    source_journal_entry_ids: input.sourceJournalEntryIds,
  };
}
