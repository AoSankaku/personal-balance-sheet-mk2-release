import {
  budgetAccountDelta,
  isBudgetAsset,
  type BudgetScopeAccount,
} from "./budgetScope";

export interface JournalIncomeBudgetLine {
  account_id: number;
  debit?: number;
  credit?: number;
  currency?: string;
}

export interface JournalIncomeBudgetImpact {
  /** Maximum ordinary income allocations recognized at this budget boundary. */
  incomeCapacity: number;
  /** Portion of a standard investment sale representing returned principal. */
  investmentReturnCapacity: number;
  /** The two budget sources shown together as sale proceeds. */
  totalCapacity: number;
  excludedCash: number;
  isInvestmentSale: boolean;
  /** Tracked cash received, keyed by account ID. */
  trackedCashInflowByAccount: Record<number, number>;
  /** Per-account residual cash that may back investment-principal allocation. */
  investmentReturnByAccount: Record<number, number>;
}

function roundAtPrecision(amount: number, decimalPlaces: number): number {
  const scale = 10 ** decimalPlaces;
  return Math.round((amount + Number.EPSILON) * scale) / scale;
}

/**
 * Compute the income budget boundary shared by input and API validation.
 * An investment asset is outside the budget boundary. When it is sold into
 * tracked cash, the recognized gain and returned principal are therefore two
 * separate budget sources even though users may allocate their proceeds as a
 * single amount.
 */
export function calculateJournalIncomeBudgetImpact(input: {
  lines: JournalIncomeBudgetLine[];
  accounts: BudgetScopeAccount[];
  currency: string;
  decimalPlaces?: number;
}): JournalIncomeBudgetImpact {
  const currency = input.currency.toUpperCase();
  const decimalPlaces = input.decimalPlaces ?? 0;
  const epsilon = 0.5 * 10 ** -decimalPlaces;
  const byId = new Map(input.accounts.map(account => [account.id, account]));
  const lines = input.lines.filter(line => (line.currency || "JPY").toUpperCase() === currency);
  const cashInflowByAccount: Record<number, number> = {};
  let income = 0;
  let expense = 0;
  let excludedCash = 0;
  let investmentOutflow = 0;
  let investmentInflow = 0;
  let netCashInflow = 0;
  let recognizedInvestmentGain = 0;
  let investmentLoss = 0;
  let investmentSaleShape = lines.length > 0;

  for (const line of lines) {
    const account = byId.get(line.account_id);
    if (!account) {
      investmentSaleShape = false;
      continue;
    }
    const debit = line.debit ?? 0;
    const credit = line.credit ?? 0;
    const delta = debit - credit;
    if (account.type === "asset" && account.category === "cash") {
      if (!isBudgetAsset(account)) excludedCash += delta;
      if (isBudgetAsset(account)) {
        const amount = roundAtPrecision(delta, decimalPlaces);
        cashInflowByAccount[account.id] = (cashInflowByAccount[account.id] ?? 0) + amount;
        netCashInflow += amount;
      }
      if (Math.abs(delta) > epsilon && credit > epsilon) {
        investmentSaleShape &&= debit <= epsilon;
      } else if (Math.abs(delta) > epsilon && debit > epsilon) {
        investmentSaleShape &&= credit <= epsilon;
      }
      continue;
    }
    if (account.type === "asset" && account.category === "investment") {
      investmentOutflow += credit;
      investmentInflow += debit;
      investmentSaleShape &&= credit >= debit - epsilon;
      continue;
    }
    if (account.type === "income") {
      income += credit - debit;
      recognizedInvestmentGain += credit - debit;
      continue;
    }
    if (account.type === "expense") {
      expense += debit - credit;
      if (account.category === "investment_loss") {
        investmentLoss += debit - credit;
      } else {
        investmentSaleShape = false;
      }
      continue;
    }
    if (Math.abs(delta) > epsilon) investmentSaleShape = false;
  }

  const incomeDirection = income < 0 ? -1 : 1;
  const incomeCapacity = Math.min(
    Math.max(0, incomeDirection * income - Math.max(0, incomeDirection * excludedCash)),
    Math.max(0, incomeDirection * (budgetAccountDelta(lines, input.accounts, currency) + expense)),
  );

  const trackedCashInflowByAccount = Object.fromEntries(
    Object.entries(cashInflowByAccount)
      .filter(([, amount]) => amount > epsilon)
      .map(([id, amount]) => [Number(id), roundAtPrecision(amount, decimalPlaces)]),
  ) as Record<number, number>;
  netCashInflow = Object.values(trackedCashInflowByAccount).reduce((sum, amount) => sum + amount, 0);
  const hasProfitOrLoss =
    (recognizedInvestmentGain > epsilon && investmentLoss <= epsilon) ||
    (investmentLoss > epsilon && recognizedInvestmentGain <= epsilon) ||
    (recognizedInvestmentGain <= epsilon && investmentLoss <= epsilon);
  const isInvestmentSale =
    investmentSaleShape &&
    investmentOutflow - investmentInflow > epsilon &&
    netCashInflow > epsilon &&
    recognizedInvestmentGain >= -epsilon &&
    investmentLoss >= -epsilon &&
    hasProfitOrLoss &&
    income >= -epsilon &&
    excludedCash >= -epsilon;

  const investmentReturnCapacity = isInvestmentSale
    ? roundAtPrecision(Math.min(
        Math.max(0, investmentOutflow - investmentInflow),
        Math.max(0, netCashInflow - incomeCapacity),
      ), decimalPlaces)
    : 0;
  const investmentReturnByAccount: Record<number, number> = {};
  if (investmentReturnCapacity >= epsilon && netCashInflow >= epsilon) {
    const scale = 10 ** decimalPlaces;
    const rows = Object.entries(trackedCashInflowByAccount);
    // The gain is distributed in the same proportions as each account's
    // actual cash receipt, so principal's largest-remainder weights can use
    // those original integer receipt units directly. Deriving weights by
    // subtracting a fractional gain share loses all weight when each receipt
    // is only one minor unit (for example three JPY 1 receipts and JPY 2 gain).
    const remainingWeights = rows.map(([accountId, amount]) => ({
      accountId: Number(accountId),
      amount,
    }));
    const weightUnits = remainingWeights.map(row => Math.max(0, Math.round(row.amount * scale)));
    const totalWeightUnits = weightUnits.reduce((sum, amount) => sum + amount, 0);
    if (totalWeightUnits > 0) {
      const totalUnits = Math.max(0, Math.round(investmentReturnCapacity * scale));
      const shares = remainingWeights.map((row, index) => {
        const exactUnits = totalUnits * weightUnits[index]! / totalWeightUnits;
        return { accountId: row.accountId, units: Math.floor(exactUnits), remainder: exactUnits - Math.floor(exactUnits) };
      });
      let unassignedUnits = totalUnits - shares.reduce((sum, share) => sum + share.units, 0);
      shares.slice().sort((left, right) =>
        right.remainder - left.remainder || left.accountId - right.accountId,
      ).forEach(share => {
        if (unassignedUnits <= 0) return;
        share.units += 1;
        unassignedUnits -= 1;
      });
      for (const share of shares) {
        if (share.units > 0) investmentReturnByAccount[share.accountId] = share.units / scale;
      }
    }
  }

  return {
    incomeCapacity: roundAtPrecision(incomeCapacity, decimalPlaces),
    investmentReturnCapacity,
    totalCapacity: roundAtPrecision(incomeCapacity + investmentReturnCapacity, decimalPlaces),
    excludedCash: roundAtPrecision(excludedCash, decimalPlaces),
    isInvestmentSale,
    trackedCashInflowByAccount,
    investmentReturnByAccount,
  };
}
