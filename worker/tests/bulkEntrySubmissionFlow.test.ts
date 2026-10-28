import { afterEach, expect, test } from "bun:test";
import type { Account, BudgetCategory, BudgetSummary, CreateJournalInput } from "@balance-sheet/shared";
import { buildBulkJournalEntries } from "../../frontend/src/lib/bulkEntrySubmission";
import { journalRouter } from "../src/routes/journal";
import { accountsRouter } from "../src/routes/accounts";
import { budgetRouter } from "../src/routes/budget";
import { createBulkEntryParityFixture } from "./helpers/bulkEntryParityFixture";

const fixtures: ReturnType<typeof createBulkEntryParityFixture>[] = [];
afterEach(() => fixtures.splice(0).forEach(f => f.close()));

test("the real bulk builder and batch API preserve USD purchase, income deferral and source-linked repayment", async () => {
  const f = createBulkEntryParityFixture(); fixtures.push(f);
  const env = { DB: f.DB };
  const accounts = await (await accountsRouter.request("/?as_of=2026-10-20", {}, env)).json() as Account[];
  const budgetCategories = await (await budgetRouter.request("/categories", {}, env)).json() as BudgetCategory[];
  const repayment: CreateJournalInput = {
    date: "2026-10-20", description: "USD repayment",
    lines: [{ account_id: 1010, debit: 20, credit: 0 }, { account_id: 1001, debit: 0, credit: 20 }],
    loan_settlement_journal_entry_ids: [9101],
    budget_funding_components: [{ kind: "repay", principal_amount: 20, applied_amount: 20, component_only_amount: 0, source_journal_entry_ids: [9101], allocations: [{ budget_category_id: 1001, amount: 20, currency: "USD", source_journal_entry_id: 9101, effect: "apply" }] }],
  };
  const result = buildBulkJournalEntries({
    rows: [
      { type: "expense", date: new Date(2026, 9, 20), itemName: "Purchase", qty: 1, price: 25.55, expenseAccountId: "1006" },
      { type: "discount", date: new Date(2026, 9, 20), discountType: "Points", amount: 5.15, incomeAccountId: "1005", budgetCategoryId: "1001", deferTransfer: true },
      { type: "loan", input: repayment, currency: "USD", paymentAccountId: "1001" },
    ],
    paymentAccount: accounts.find(a => a.id === 1001), accounts, budgetCategories, currency: "USD", decimalPlaces: 2,
    defaultExpenseDescription: "Expense", defaultDiscountDescription: "Discount",
  });
  const response = await journalRouter.request("/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(result) }, env);
  expect(response.status).toBe(201);
  const saved = await response.json() as { id: number }[];
  expect(saved).toHaveLength(3);
  const summary = await (await budgetRouter.request("/summary?year_month=2026-10&as_of=2026-10-20&currency=USD", {}, env)).json() as BudgetSummary;
  expect(summary.categories[0]!.available).toBeCloseTo(79.6, 8);
  expect(summary.categories[0]!.borrowed_funding).toBe(0);
  expect(f.sqlite.query("SELECT is_settled FROM loan_settlements WHERE journal_entry_id=9101").get()).toEqual({ is_settled: 1 });
  expect(f.sqlite.query("SELECT is_settled FROM loan_settlements WHERE journal_entry_id=9100").get()).toEqual({ is_settled: 0 });
  expect(f.sqlite.query("SELECT amount,currency,is_deferred FROM income_transfer_requirements WHERE source_income_journal_entry_id=?").get(saved[1]!.id)).toEqual({ amount: 515, currency: "USD", is_deferred: 1 });
});
