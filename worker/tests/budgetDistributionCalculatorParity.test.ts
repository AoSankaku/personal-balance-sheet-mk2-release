import { afterEach, describe, expect, test } from "bun:test";
import type { Account, BudgetCategory, CreateJournalLineInput } from "@balance-sheet/shared";
import { calculateJournalBudgetDistribution } from "../../frontend/src/lib/budgetDistributionCalculator";
import { accountsRouter } from "../src/routes/accounts";
import { budgetRouter } from "../src/routes/budget";
import { journalRouter } from "../src/routes/journal";
import { createIncomeBudgetScopeFixture } from "./helpers/incomeBudgetScopeFixture";

const fixtures: ReturnType<typeof createIncomeBudgetScopeFixture>[] = [];
async function fixture() {
  const database = createIncomeBudgetScopeFixture();
  fixtures.push(database);
  database.sqlite.exec(`
    INSERT INTO budget_categories(id, name) VALUES (1002, 'Refund reserve');
    INSERT INTO accounts(id, name, type, category) VALUES (1010, 'Refund expense', 'expense', 'other');
    INSERT INTO budget_category_accounts(budget_category_id, account_id, ratio) VALUES (1002, 1010, 100);
  `);
  const env = { DB: database.DB };
  const accounts = await (await accountsRouter.request("/", undefined, env)).json() as Account[];
  const categories = await (await budgetRouter.request("/categories", undefined, env)).json() as BudgetCategory[];
  return { ...database, accounts, categories, env };
}

afterEach(() => {
  for (const database of fixtures.splice(0)) database.close();
});

async function calculateAndPost(database: Awaited<ReturnType<typeof fixture>>, lines: CreateJournalLineInput[]) {
  const before = database.sqlite.query("SELECT COUNT(*) AS count FROM journal_entries").get();
  const result = calculateJournalBudgetDistribution({
    lines, accounts: database.accounts, categories: database.categories,
    currency: "JPY", decimalPlaces: 0, fallbackCategoryId: 1001,
  });
  expect(database.sqlite.query("SELECT COUNT(*) AS count FROM journal_entries").get()).toEqual(before);
  expect(result.canApply).toBe(true);
  const response = await journalRouter.request("/", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      date: "2026-10-20", description: "Calculator parity", lines, budget_source: "multiline",
      budget_allocations: Object.entries(result.expense).map(([id, amount]) => ({ budget_category_id: Number(id), amount })),
      income_budget_allocations: Object.entries(result.income).map(([id, amount]) => ({ budget_category_id: Number(id), amount })),
    }),
  }, database.env);
  expect(response.status, await response.clone().text()).toBe(201);
  const entry = await response.json() as { id: number };
  const saved = await (await journalRouter.request(`/${entry.id}`, undefined, database.env)).json();
  return { result, saved };
}

describe("budget calculator journal API parity", () => {
  test("gross income with a fee uses separate valid income and expense amounts", async () => {
    const { result, saved } = await calculateAndPost(await fixture(), [
      { account_id: 1001, debit: 19800, credit: 0 },
      { account_id: 1006, debit: 200, credit: 0 },
      { account_id: 1005, debit: 0, credit: 20000 },
    ]);
    expect(result.expense).toEqual({ 1001: -200 });
    expect(result.income).toEqual({ 1001: 20000 });
    expect(saved.budget_allocations).toContainEqual(expect.objectContaining({ amount: -200 }));
    expect(saved.income_budget_allocations).toContainEqual(expect.objectContaining({ amount: 20000 }));
  });

  test("mixed tracked/excluded spending matches the API active/reference split", async () => {
    const { result, saved } = await calculateAndPost(await fixture(), [
      { account_id: 1006, debit: 1000, credit: 0 },
      { account_id: 1001, debit: 0, credit: 400 },
      { account_id: 1002, debit: 0, credit: 600 },
    ]);
    expect(result.expenseActiveTarget).toBe(-400);
    expect(result.expenseReferenceTarget).toBe(-600);
    expect(saved.budget_allocations).toEqual(expect.arrayContaining([
      expect.objectContaining({ amount: -400, is_reference: false }),
      expect.objectContaining({ amount: -600, is_reference: true }),
    ]));
  });

  test("expense and refund allocations keep independent signs", async () => {
    const { result, saved } = await calculateAndPost(await fixture(), [
      { account_id: 1006, debit: 1000, credit: 0 },
      { account_id: 1010, debit: 0, credit: 200 },
      { account_id: 1001, debit: 0, credit: 800 },
    ]);
    expect(result.expense).toEqual({ 1001: -1000, 1002: 200 });
    expect(saved.budget_allocations.map((allocation: { amount: number }) => allocation.amount).sort((a: number, b: number) => a - b)).toEqual([-1000, 200]);
  });

  test("income in an excluded account is not allocated to budgets", async () => {
    const { result, saved } = await calculateAndPost(await fixture(), [
      { account_id: 1002, debit: 1000, credit: 0 },
      { account_id: 1005, debit: 0, credit: 1000 },
    ]);
    expect(result.incomeTarget).toBe(0);
    expect(saved.income_budget_allocations).toEqual([]);
  });

  test("income reducing a deductible card balance can fund a budget", async () => {
    const { result, saved } = await calculateAndPost(await fixture(), [
      { account_id: 1004, debit: 50, credit: 0 },
      { account_id: 1005, debit: 0, credit: 50 },
    ]);
    expect(result.incomeTarget).toBe(50);
    expect(saved.income_budget_allocations).toContainEqual(expect.objectContaining({ amount: 50 }));
  });

  test("an unrelated transfer into excluded cash does not turn tracked spending into reference history", async () => {
    const { result, saved } = await calculateAndPost(await fixture(), [
      { account_id: 1006, debit: 100, credit: 0 },
      { account_id: 1002, debit: 200, credit: 0 },
      { account_id: 1001, debit: 0, credit: 300 },
    ]);
    expect(result.expenseActiveTarget).toBe(-100);
    expect(result.expenseReferenceTarget).toBe(0);
    expect(saved.budget_allocations).toContainEqual(expect.objectContaining({ amount: -100, is_reference: false }));
  });

  test("an unrelated excluded-cash outflow does not hide an active budget refund", async () => {
    const { result, saved } = await calculateAndPost(await fixture(), [
      { account_id: 1001, debit: 300, credit: 0 },
      { account_id: 1002, debit: 0, credit: 200 },
      { account_id: 1006, debit: 0, credit: 100 },
    ]);
    expect(result.expenseActiveTarget).toBe(100);
    expect(result.expenseReferenceTarget).toBe(0);
    expect(saved.budget_allocations).toContainEqual(expect.objectContaining({ amount: 100, is_reference: false }));
  });

  test("does not offer mixed expense/refund allocations that the excluded-source API cannot accept", async () => {
    const database = await fixture();
    const lines = [
      { account_id: 1006, debit: 1000, credit: 0 },
      { account_id: 1010, debit: 0, credit: 200 },
      { account_id: 1001, debit: 0, credit: 400 },
      { account_id: 1002, debit: 0, credit: 400 },
    ];
    const result = calculateJournalBudgetDistribution({
      lines, accounts: database.accounts, categories: database.categories,
      currency: "JPY", decimalPlaces: 0, fallbackCategoryId: 1001,
    });
    expect(result.canApply).toBe(false);
    expect(result.issue).toBe("ambiguous");
    const response = await journalRouter.request("/", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        date: "2026-10-20", description: "Ambiguous calculator source", lines,
        budget_allocations: [{ budget_category_id: 1001, amount: -1000 }, { budget_category_id: 1002, amount: 200 }],
      }),
    }, database.env);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Budget allocation direction does not match the expense or refund" });
  });
});
