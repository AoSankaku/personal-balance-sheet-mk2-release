import dayjs from "dayjs";
import type { Account, BudgetCategory, CreateJournalInput } from "@balance-sheet/shared";
import { isLongTermBorrowingCategory, isShortTermBorrowingCategory, isAnyLendingCategory } from "@balance-sheet/shared";
import type { BulkDiscountRow, BulkRow } from "../utils/inputDrafts";
import { buildIncomeBudgetEntryFields } from "./incomeBudgetScope";
import { buildExpenseBudgetAllocations } from "./simpleEntryUtils";
import { calculateMultiLineBudgetFundingImpact } from "./multiLineBudgetFunding";

interface ConfiguredLoanRow {
  type: "loan";
  input: CreateJournalInput | null;
  currency: string;
  paymentAccountId: string;
}

export class BulkEntrySubmissionError extends Error {
  constructor(public readonly code: string, public readonly rowIndex: number) {
    super(code);
  }
}

/** Pure submission assembly; loan inputs come from the existing normal loan form. */
export function buildBulkJournalEntries(input: {
  rows: Array<BulkRow | ConfiguredLoanRow>;
  paymentAccount: Account | undefined;
  accounts: Account[];
  budgetCategories: Pick<BudgetCategory, "id" | "target_accounts">[];
  currency: string;
  decimalPlaces: number;
  defaultExpenseDescription: string;
  defaultDiscountDescription: string;
}): { entries: CreateJournalInput[]; skippedCount: number } {
  const currency = input.currency.toUpperCase();
  const payment = input.paymentAccount;
  if (!payment || !["asset", "liability"].includes(payment.type)) {
    throw new BulkEntrySubmissionError("bulk_payment_account_required", -1);
  }
  const scale = 10 ** input.decimalPlaces;
  const money = (value: number, index: number) => {
    const units = Math.round(value * scale);
    if (!Number.isFinite(value) || value < 0 || Math.abs(value * scale - units) > 0.000_001) {
      throw new BulkEntrySubmissionError("bulk_invalid_amount", index);
    }
    return units / scale;
  };
  const inCurrency = <T extends { currency?: string }>(value: T, index: number): T & { currency: string } => {
    if (value.currency && value.currency.toUpperCase() !== currency) {
      throw new BulkEntrySubmissionError("bulk_currency_changed", index);
    }
    return { ...value, currency };
  };
  const entries: CreateJournalInput[] = [];
  const settledIds = new Set<number>();
  let skippedCount = 0;
  for (const [index, row] of input.rows.entries()) {
    if (row.type === "loan") {
      if (!row.input) throw new BulkEntrySubmissionError("bulk_loan_configuration_required", index);
      if (row.currency.toUpperCase() !== currency) throw new BulkEntrySubmissionError("bulk_currency_changed", index);
      if (row.paymentAccountId !== String(payment.id)) throw new BulkEntrySubmissionError("bulk_payment_account_changed", index);
      const entry: CreateJournalInput = {
        ...row.input,
        lines: row.input.lines.map(line => inCurrency(line, index)),
        budget_allocations: row.input.budget_allocations?.map(allocation => inCurrency(allocation, index)),
        income_budget_allocations: row.input.income_budget_allocations?.map(allocation => inCurrency(allocation, index)),
        income_transfer_destinations: row.input.income_transfer_destinations?.map(transfer => inCurrency(transfer, index)),
        budget_funding: row.input.budget_funding ? { ...row.input.budget_funding, allocations: row.input.budget_funding.allocations?.map(allocation => inCurrency(allocation, index)) } : undefined,
        budget_funding_components: row.input.budget_funding_components?.map(component => ({ ...component, allocations: component.allocations?.map(allocation => inCurrency(allocation, index)) })),
      };
      if (!entry.lines.some(line => line.account_id === payment.id)) throw new BulkEntrySubmissionError("bulk_payment_account_changed", index);
      const cardInvolved = entry.lines.some(line => input.accounts.some(account => account.id === line.account_id && account.category === "credit_card"));
      const impact = calculateMultiLineBudgetFundingImpact({ lines: entry.lines, accounts: input.accounts, currency, decimalPlaces: input.decimalPlaces });
      if (!cardInvolved && (impact.components.length === 0 || (!entry.budget_funding && !entry.budget_funding_components?.length))) {
        throw new BulkEntrySubmissionError("bulk_loan_configuration_required", index);
      }
      const sources = new Set([
        ...(entry.loan_settlement_journal_entry_ids ?? []),
        ...(entry.budget_funding?.source_journal_entry_ids ?? []),
        ...(entry.budget_funding_components?.flatMap(component => component.source_journal_entry_ids ?? []) ?? []),
      ]);
      for (const id of sources) {
        if (settledIds.has(id)) throw new BulkEntrySubmissionError("bulk_duplicate_settlement", index);
        settledIds.add(id);
      }
      entries.push(entry);
      continue;
    }
    if (!dayjs(row.date).isValid()) throw new BulkEntrySubmissionError("bulk_invalid_date", index);
    const date = dayjs(row.date).format("YYYY-MM-DD");
    if (row.type === "expense") {
      if (!row.expenseAccountId || row.price <= 0) {
        if (row.price > 0 && !row.expenseAccountId) skippedCount++;
        continue;
      }
      const account = input.accounts.find(account => account.id === Number(row.expenseAccountId));
      if (account && (isLongTermBorrowingCategory(account.category) || isShortTermBorrowingCategory(account.category) || isAnyLendingCategory(account.category))) {
        throw new BulkEntrySubmissionError("bulk_loan_configuration_required", index);
      }
      if (!account || account.type !== "expense") throw new BulkEntrySubmissionError("bulk_invalid_account", index);
      if (!Number.isFinite(row.qty) || row.qty <= 0) throw new BulkEntrySubmissionError("bulk_invalid_amount", index);
      money(row.price, index);
      const amount = money(row.qty * row.price, index);
      const allocations = buildExpenseBudgetAllocations(amount, account.budget_ratios ?? [], -1, input.decimalPlaces).map(allocation => ({ ...allocation, currency }));
      entries.push({ date, description: row.itemName || input.defaultExpenseDescription, lines: [{ account_id: account.id, debit: amount, credit: 0, currency }, { account_id: payment.id, debit: 0, credit: amount, currency }], budget_allocations: allocations.length ? allocations : undefined, budget_source: "simple" });
    } else {
      if (!row.incomeAccountId || row.amount <= 0) {
        if (row.amount > 0 && !row.incomeAccountId) skippedCount++;
        continue;
      }
      const account = input.accounts.find(account => account.id === Number(row.incomeAccountId));
      if (!account || account.type !== "income") throw new BulkEntrySubmissionError("bulk_invalid_account", index);
      const amount = money(row.amount, index);
      const discount = row as BulkDiscountRow & { transferAccountId?: string | null; deferTransfer?: boolean | null };
      const categoryId = row.budgetCategoryId ? Number(row.budgetCategoryId) : null;
      if (categoryId != null && !input.budgetCategories.some(category => category.id === categoryId)) throw new BulkEntrySubmissionError("bulk_invalid_account", index);
      let fields;
      try {
        fields = buildIncomeBudgetEntryFields({ destinationAccount: payment, incomeBudgetAllocations: categoryId == null ? undefined : [{ budget_category_id: categoryId, amount, currency }], categories: input.budgetCategories, accounts: input.accounts, currency, transferTargets: categoryId != null && discount.transferAccountId != null ? { [categoryId]: Number(discount.transferAccountId) } : undefined, defer: discount.deferTransfer });
      } catch (error) {
        throw new BulkEntrySubmissionError(error instanceof Error ? error.message : "bulk_invalid_account", index);
      }
      entries.push({ date, description: row.discountType || input.defaultDiscountDescription, lines: [{ account_id: payment.id, debit: amount, credit: 0, currency }, { account_id: account.id, debit: 0, credit: amount, currency }], ...fields });
    }
  }
  return { entries, skippedCount };
}
