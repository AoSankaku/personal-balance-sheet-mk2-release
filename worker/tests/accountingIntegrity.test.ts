import { afterEach, describe, expect, test } from "bun:test";
import { createTestD1 } from "./helpers/d1";
import { journalRouter } from "../src/routes/journal";
import { accountsRouter } from "../src/routes/accounts";
import { budgetRouter } from "../src/routes/budget";

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
});
