import { eq, inArray } from "drizzle-orm";
import type { CreateJournalInput } from "@balance-sheet/shared";
import { isBudgetAccount } from "../../../shared/budgetScope";
import type { createDb } from "../db";
import { accounts, budgetFilters } from "../db/schema";

type Selection = {
  is_regular_income: boolean;
  income_budget_filter_id: number | null;
};
type Input = Pick<CreateJournalInput, "is_regular_income" | "income_budget_filter_id" | "lines">;

/** Persist UI preferences independently of the actual, saved allocation amounts. */
export async function resolveJournalIncomeSelection(
  db: ReturnType<typeof createDb>,
  input: Input,
  currency: string,
  previous?: Selection,
): Promise<{ settings: Selection } | { error: string }> {
  if (input.is_regular_income !== undefined && typeof input.is_regular_income !== "boolean") {
    return { error: "is_regular_income must be a boolean" };
  }
  if (input.income_budget_filter_id != null && (
    !Number.isSafeInteger(input.income_budget_filter_id) || input.income_budget_filter_id <= 0
  )) {
    return { error: "Invalid income_budget_filter_id" };
  }
  const regular = input.is_regular_income ?? previous?.is_regular_income ?? false;
  const filterId = regular
    ? input.income_budget_filter_id === undefined
      ? previous?.income_budget_filter_id ?? null
      : input.income_budget_filter_id
    : null;
  if (!regular && input.income_budget_filter_id != null) {
    return { error: "An income budget filter requires regular income mode" };
  }
  const off: Selection = { is_regular_income: false, income_budget_filter_id: null };
  if (!regular) return { settings: off };

  const lineAccounts = await db.select().from(accounts).where(
    inArray(accounts.id, input.lines.map(line => line.account_id)),
  );
  const hasIncome = input.lines.some(line => line.credit > line.debit &&
    lineAccounts.some(account => account.id === line.account_id && account.type === "income"));
  const hasBudgetDestination = input.lines.some(line => line.debit > line.credit &&
    lineAccounts.some(account => account.id === line.account_id && isBudgetAccount(account)));
  if (!hasIncome || !hasBudgetDestination) {
    // Older clients may change the entry type without knowing these fields.
    if (input.is_regular_income === true || input.income_budget_filter_id != null) {
      return { error: "Regular income requires income received into a budget account" };
    }
    return { settings: off };
  }
  if (filterId != null) {
    const [filter] = await db.select().from(budgetFilters).where(eq(budgetFilters.id, filterId));
    if (!filter || filter.currency !== currency) {
      if (input.income_budget_filter_id === undefined) {
        return { settings: { is_regular_income: true, income_budget_filter_id: null } };
      }
      return { error: "Invalid income budget filter for this currency" };
    }
  }
  return { settings: { is_regular_income: true, income_budget_filter_id: filterId } };
}
