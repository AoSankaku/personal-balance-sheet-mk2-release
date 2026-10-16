import { afterEach, describe, expect, test } from "bun:test";
import { createTestD1 } from "./helpers/d1";
import { journalRouter } from "../src/routes/journal";
import { accountsRouter } from "../src/routes/accounts";
import { budgetRouter } from "../src/routes/budget";
import { trialBalanceRouter } from "../src/routes/trialBalance";
import { adminRouter } from "../src/routes/admin";
import { sumBudgetResourceBalances } from "../../shared/budgetScope";

const databases: ReturnType<typeof createTestD1>[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

function fixture() {
  const database = createTestD1();
  databases.push(database);
  database.sqlite.exec(`
    INSERT INTO accounts(id,name,type,category,include_in_allocatable) VALUES
      (1001,'Bank','asset','cash',1), (1002,'Untracked cash','asset','cash',0),
      (1003,'Food','expense','food',1), (1004,'Income','income','salary',1),
      (1005,'Card','liability','credit_card',1), (1006,'Opening','equity','opening_balance',1);
    INSERT INTO budget_categories(id,name) VALUES(1001,'Food');
    UPDATE accounts SET deduct_from_budget = 1 WHERE id = 1005;
    INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,currency,date,created_at)
      VALUES(1001,'2026-10',10000,'JPY','2026-10-01','2026-10-01 00:00:00');
  `);
  return database;
}

async function post(router: typeof journalRouter | typeof accountsRouter, database: ReturnType<typeof createTestD1>, body: unknown, path = "/") {
  return router.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, { DB: database.DB });
}

async function foodAvailable(database: ReturnType<typeof createTestD1>) {
  const response = await budgetRouter.request("/summary?year_month=2026-10", {}, { DB: database.DB });
  expect(response.status).toBe(200);
  const summary = await response.json() as { categories: { category: { id: number }; available: number }[]; total_reference_reserve: number };
  return { available: summary.categories.find((row) => row.category.id === 1001)!.available, reserve: summary.total_reference_reserve };
}

describe("accounting integrity API regressions", () => {
  test("rejects a single-currency imbalance even when marked as exchange", async () => {
    const database = fixture();
    const response = await post(journalRouter, database, { date: "2026-10-02", description: "invalid exchange", is_currency_exchange: true,
      lines: [{ account_id: 1001, debit: 100, credit: 0 }, { account_id: 1006, debit: 0, credit: 1 }] });
    expect(response.status).toBe(400);
    expect(database.sqlite.query("SELECT count(*) AS n FROM journal_entries").get()).toEqual({ n: 0 });
  });

  test("compares crypto in smallest units rather than a fixed nominal tolerance", async () => {
    const database = fixture();
    const response = await post(journalRouter, database, { date: "2026-10-02", description: "invalid btc",
      lines: [{ account_id: 1001, debit: 0.00002, credit: 0, currency: "BTC" }, { account_id: 1006, debit: 0, credit: 0.00001, currency: "BTC" }] });
    expect(response.status).toBe(400);
  });

  test("preserves a valid two-currency asset exchange", async () => {
    const database = fixture();
    const response = await post(journalRouter, database, { date: "2026-10-02", description: "valid exchange", is_currency_exchange: true,
      lines: [{ account_id: 1001, debit: 0, credit: 15000, currency: "JPY" }, { account_id: 1001, debit: 100, credit: 0, currency: "USD" }] });
    expect(response.status).toBe(201);
  });

  test("untracked expenses and refunds preserve every budget balance", async () => {
    const database = fixture();
    const response = await post(journalRouter, database, { date: "2026-10-02", description: "untracked food",
      lines: [{ account_id: 1003, debit: 1000, credit: 0 }, { account_id: 1002, debit: 0, credit: 1000 }],
      budget_allocations: [{ budget_category_id: 1001, amount: -1000 }], budget_source: "simple" });
    expect(response.status).toBe(201);
    expect(await foodAvailable(database)).toEqual({ available: 10000, reserve: 0 });
    const refund = await post(journalRouter, database, { date: "2026-10-03", description: "untracked refund",
      lines: [{ account_id: 1002, debit: 200, credit: 0 }, { account_id: 1003, debit: 0, credit: 200 }],
      budget_allocations: [{ budget_category_id: 1001, amount: 200 }] });
    expect(refund.status).toBe(201);
    expect(await foodAvailable(database)).toEqual({ available: 10000, reserve: 0 });
  });

  test("rejects distributing income received only outside the budget boundary", async () => {
    const database = fixture();
    const response = await post(journalRouter, database, { date: "2026-10-02", description: "cash reward",
      lines: [{ account_id: 1002, debit: 3000, credit: 0 }, { account_id: 1004, debit: 0, credit: 3000 }],
      income_budget_allocations: [{ budget_category_id: 1001, amount: 3000 }] });
    expect(response.status).toBe(400);
    expect(await foodAvailable(database)).toEqual({ available: 10000, reserve: 0 });
  });

  test("new cards default to budget deduction and the setting round trips", async () => {
    const database = fixture();
    const created = await post(accountsRouter, database, { name: "new card", type: "liability", category: "credit_card" });
    expect(created.status).toBe(201);
    const card = await created.json() as { id: number; deduct_from_budget: boolean };
    expect(card.deduct_from_budget).toBe(true);
    const changed = await accountsRouter.request(`/${card.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ deduct_from_budget: false }) }, { DB: database.DB });
    expect(changed.status).toBe(200);
    expect((await changed.json() as { deduct_from_budget: boolean }).deduct_from_budget).toBe(false);
  });

  test("seeded cards use the same budget deduction default as created cards", async () => {
    const database = createTestD1();
    databases.push(database);
    const response = await adminRouter.request("/seed", { method: "POST", headers: { "content-type": "application/json" }, body: '{"locale":"ja"}' }, { DB: database.DB });
    expect(response.status).toBe(200);
    expect(database.sqlite.query("SELECT deduct_from_budget FROM accounts WHERE category='credit_card'").get()).toEqual({ deduct_from_budget: 1 });
  });

  test("reference toggling cannot make excluded-cash spending consume a budget", async () => {
    const database = fixture();
    const response = await post(journalRouter, database, { date: "2026-10-02", description: "excluded",
      lines: [{ account_id: 1003, debit: 500, credit: 0 }, { account_id: 1002, debit: 0, credit: 500 }],
      budget_allocations: [{ budget_category_id: 1001, amount: -500 }] });
    const entry = await response.json() as { id: number };
    const changed = await journalRouter.request(`/${entry.id}/budget-allocations/reference`, { method: "PATCH", headers: { "content-type": "application/json" }, body: '{"is_reference":false}' }, { DB: database.DB });
    expect(changed.status).toBe(409);
    expect(await foodAvailable(database)).toEqual({ available: 10000, reserve: 0 });
  });

  test("cash reward, bank deposit, card charge, later spending and repayment affect the boundary once", async () => {
    const database = fixture();
    async function record(description: string, debit: number, credit: number, amount: number, adjustment?: number) {
      const response = await post(journalRouter, database, { date: "2026-10-02", description,
        lines: [{ account_id: debit, debit: amount, credit: 0 }, { account_id: credit, debit: 0, credit: amount }],
        ...(adjustment == null ? {} : { income_budget_allocations: [{ budget_category_id: 1001, amount: adjustment, adjustment_type: "transfer" }] }) });
      expect(response.status).toBe(201);
    }
    async function resources() {
      const response = await accountsRouter.request("/", {}, { DB: database.DB });
      expect(response.status).toBe(200);
      return sumBudgetResourceBalances(await response.json() as Parameters<typeof sumBudgetResourceBalances>[0], "JPY");
    }
    await record("reward", 1002, 1004, 3000);
    expect(await resources()).toBe(0);
    await record("deposit", 1001, 1002, 3000);
    expect(await resources()).toBe(3000);
    expect((await foodAvailable(database)).available).toBe(10000);
    await record("card charge to excluded Suica", 1002, 1005, 1000, -1000);
    expect(await resources()).toBe(2000);
    expect((await foodAvailable(database)).available).toBe(9000);
    const spend = await post(journalRouter, database, { date: "2026-10-03", description: "Suica food",
      lines: [{ account_id: 1003, debit: 500, credit: 0 }, { account_id: 1002, debit: 0, credit: 500 }],
      budget_allocations: [{ budget_category_id: 1001, amount: -500 }] });
    expect(spend.status).toBe(201);
    expect((await foodAvailable(database)).available).toBe(9000);
    await record("card repayment", 1005, 1001, 1000);
    expect(await resources()).toBe(2000);
    expect((await foodAvailable(database)).available).toBe(9000);
    expect(database.sqlite.query("SELECT SUM(debit-credit) AS net FROM journal_lines JOIN accounts ON accounts.id=account_id WHERE type='expense'").get()).toEqual({ net: 500 });
  });

  test("caps mixed-source expense allocations and preserves tracked mixed income/expense", async () => {
    const database = fixture();
    const response = await post(journalRouter, database, { date: "2026-10-02", description: "mixed cash",
      lines: [{ account_id: 1003, debit: 1000, credit: 0 }, { account_id: 1001, debit: 0, credit: 400 }, { account_id: 1002, debit: 0, credit: 600 }],
      budget_allocations: [{ budget_category_id: 1001, amount: -1000 }] });
    expect(response.status).toBe(201);
    expect(await foodAvailable(database)).toEqual({ available: 9600, reserve: 0 });
    const mixed = await post(journalRouter, database, { date: "2026-10-03", description: "gross income and fee",
      lines: [{ account_id: 1001, debit: 100, credit: 0 }, { account_id: 1003, debit: 100, credit: 0 }, { account_id: 1004, debit: 0, credit: 200 }],
      budget_allocations: [{ budget_category_id: 1001, amount: -100 }], income_budget_allocations: [{ budget_category_id: 1001, amount: 200 }] });
    expect(mixed.status).toBe(201);
    expect((await foodAvailable(database)).available).toBe(9700);
  });

  test("backdated create, edit and delete rebuild a resolved cash checkpoint atomically", async () => {
    const database = fixture();
    database.sqlite.exec(`INSERT INTO actual_balance_snapshots(id,snapshot_date,snapshot_time) VALUES(100,'2026-10-15','20:00');
      INSERT INTO actual_balance_entries(id,snapshot_id,account_id,amount,currency) VALUES(100,100,1002,500,'JPY');`);
    expect((await trialBalanceRouter.request("/snapshots/100/adjustments", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }, { DB: database.DB })).status).toBe(200);
    const owned = database.sqlite.query("SELECT journal_entry_id AS id FROM actual_balance_adjustments").get() as { id: number };
    expect((await trialBalanceRouter.request(`/unknown-funds/${owned.id}/resolve`, { method: "POST" }, { DB: database.DB })).status).toBe(200);
    const body = (amount: number) => ({ date: "2026-04-01", description: "forgotten expense", lines: [{ account_id: 1003, debit: amount, credit: 0 }, { account_id: 1002, debit: 0, credit: amount }] });
    const created = await post(journalRouter, database, body(100));
    expect(created.status).toBe(201);
    const entry = await created.json() as { id: number };
    const checkpoint = () => database.sqlite.query("SELECT amount FROM actual_balance_adjustments").get();
    expect(checkpoint()).toEqual({ amount: 600 });
    const edited = await journalRouter.request(`/${entry.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body(250)) }, { DB: database.DB });
    expect(edited.status).toBe(200);
    expect(checkpoint()).toEqual({ amount: 750 });
    expect((await journalRouter.request(`/${owned.id}`, { method: "DELETE" }, { DB: database.DB })).status).toBe(409);
    expect((await journalRouter.request(`/${entry.id}`, { method: "DELETE" }, { DB: database.DB })).status).toBe(200);
    expect(checkpoint()).toEqual({ amount: 500 });
    expect(await foodAvailable(database)).toEqual({ available: 10000, reserve: 0 });
  });

  test("rejects transfer tasks for excluded income and allocations in an unrelated currency", async () => {
    const database = fixture();
    const base = { date: "2026-10-02", description: "excluded income",
      lines: [{ account_id: 1002, debit: 3000, credit: 0 }, { account_id: 1004, debit: 0, credit: 3000 }] };
    const response = await post(journalRouter, database, { ...base,
      income_transfer_destinations: [{ budget_category_id: 1001, from_account_id: 1002, to_account_id: 1001, amount: 3000, currency: "JPY" }] });
    expect(response.status).toBe(400);
    const foreign = await post(journalRouter, database, { ...base,
      income_budget_allocations: [{ budget_category_id: 1001, amount: 10, currency: "USD" }] });
    expect(foreign.status).toBe(400);
    const negative = await post(journalRouter, database, { ...base,
      income_budget_allocations: [{ budget_category_id: 1001, amount: -3000 }] });
    expect(negative.status).toBe(400);
    expect(database.sqlite.query("SELECT COUNT(*) AS n FROM journal_entries").get()).toEqual({ n: 0 });
  });

  test("rejects budget distribution for accrued income without budget resources", async () => {
    const database = fixture();
    database.sqlite.exec("INSERT INTO accounts(id,name,type,category) VALUES(1007,'Receivable','asset','other')");
    const response = await post(journalRouter, database, { date: "2026-10-02", description: "accrued reward",
      lines: [{ account_id: 1007, debit: 3000, credit: 0 }, { account_id: 1004, debit: 0, credit: 3000 }],
      income_budget_allocations: [{ budget_category_id: 1001, amount: 3000 }] });
    expect(response.status).toBe(400);
  });

  test("prevalidates every import source before writing the first valid row", async () => {
    const database = fixture();
    const base = { date: "2026-10-02", description: "import", lines: [{ account_id: 1001, debit: 100, credit: 0 }, { account_id: 1004, debit: 0, credit: 100 }] };
    const response = await post(journalRouter, database, { entries: [base, { ...base, lines: [{ account_id: 999999, debit: 100, credit: 0 }, { account_id: 1004, debit: 0, credit: 100 }] }] }, "/batch");
    expect(response.status).toBe(400);
    expect(database.sqlite.query("SELECT COUNT(*) AS n FROM journal_entries").get()).toEqual({ n: 0 });
  });

  test("period erase recomputes retained future cash checkpoints", async () => {
    const database = fixture();
    const month = new Date().toISOString().slice(0, 7);
    database.sqlite.exec(`INSERT INTO journal_entries(id,date,description) VALUES(900,'${month}-01','erased expense');
      INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES(900,1003,200,0,'JPY'),(900,1002,0,200,'JPY');
      INSERT INTO actual_balance_snapshots(id,snapshot_date) VALUES(101,'2099-12-31');
      INSERT INTO actual_balance_entries(id,snapshot_id,account_id,amount,currency) VALUES(101,101,1002,500,'JPY');`);
    expect((await trialBalanceRouter.request("/snapshots/101/adjustments", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }, { DB: database.DB })).status).toBe(200);
    expect(database.sqlite.query("SELECT amount FROM actual_balance_adjustments").get()).toEqual({ amount: 700 });
    const erased = await adminRouter.request("/erase", { method: "POST", headers: { "content-type": "application/json" }, body: '{"scope":"ledger_this_month"}' }, { DB: database.DB });
    expect(erased.status).toBe(200);
    expect(database.sqlite.query("SELECT amount FROM actual_balance_adjustments").get()).toEqual({ amount: 500 });
  });
});
