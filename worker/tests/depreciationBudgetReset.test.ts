import { afterEach, expect, test } from "bun:test";
import { createTestD1 } from "./helpers/d1";
import { depreciationRouter } from "../src/routes/depreciation";
import { budgetRouter } from "../src/routes/budget";
import { journalRouter } from "../src/routes/journal";

const databases: ReturnType<typeof createTestD1>[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

async function fixture(method = "assigned") {
  const database = createTestD1();
  databases.push(database);
  database.sqlite.exec(`
    INSERT INTO accounts(id,name,type,category,is_depreciable) VALUES
      (1001,'Bank','asset','cash',0),(1002,'Equipment','asset','other',1),
      (1003,'Depreciation','expense','other',0);
    INSERT INTO budget_categories(id,name) VALUES(1001,'Savings'),(1002,'Living');
  `);
  const response = await depreciationRouter.request("/", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ purchase_date: "2026-01-01", description: "Equipment",
      asset_account_id: 1002, payment_account_id: 1001, expense_account_id: 1003,
      total_amount: 300000, months: 30,
      budget_settings: { method, purchase_category_id: 1001, monthly_source_category_id: 1002 },
    }),
  }, { DB: database.DB });
  expect(response.status).toBe(201);
  return database;
}

function request(database: ReturnType<typeof createTestD1>, path: string, body: unknown, method = "PATCH") {
  return budgetRouter.request(path, { method, headers: { "content-type": "application/json" },
    body: JSON.stringify(body) }, { DB: database.DB });
}

test("reset requires an explicit continue/end decision for an affected assigned plan", async () => {
  const database = await fixture();
  const response = await request(database, "/allocations", {
    budget_category_id: 1001, year_month: "2026-04", date: "2026-04-15",
    adjustment_type: "reset", adhoc_delta: 0,
  });
  expect(response.status).toBe(409);
  expect(database.sqlite.query("SELECT count(*) AS n FROM budget_adjustment_logs WHERE adjustment_type='reset'").get()).toEqual({ n: 0 });
});

test("an unrelated reset does not require plan decisions", async () => {
  const database = await fixture();
  database.sqlite.exec("INSERT INTO budget_categories(id,name) VALUES(1003,'Unrelated')");
  const response = await request(database, "/allocations", {
    budget_category_id: 1003, year_month: "2026-04", date: "2026-04-15",
    adjustment_type: "reset", adhoc_delta: 0,
  });
  expect(response.status).toBe(200);
});

test("active plan categories cannot disappear through archive or deletion", async () => {
  const database = await fixture();
  expect((await request(database, "/categories/1001", { is_archived: true })).status).toBe(409);
  expect((await budgetRouter.request("/categories/1002", { method: "DELETE" }, { DB: database.DB })).status).toBe(409);
  expect(database.sqlite.query("SELECT count(*) AS n FROM budget_categories WHERE id IN (1001,1002)").get()).toEqual({ n: 2 });
});

test("owned purchase and transfer rows cannot be edited or deleted one side at a time", async () => {
  const database = await fixture();
  const row = database.sqlite.query("SELECT id FROM budget_adjustment_logs WHERE journal_entry_id IS NOT NULL LIMIT 1").get() as { id: number } | null;
  expect(row).not.toBeNull();
  expect((await request(database, `/adjustment-logs/${row!.id}`, { amount: 1 })).status).toBe(409);
  expect((await budgetRouter.request(`/adjustment-logs/${row!.id}`, { method: "DELETE" }, { DB: database.DB })).status).toBe(409);
});

test("generic journal and bulk deletion protect configured depreciation accounting", async () => {
  const database = await fixture();
  const monthly = database.sqlite.query("SELECT journal_entry_id AS id FROM depreciation_entries LIMIT 1").get() as {id:number};
  expect((await journalRouter.request(`/${monthly.id}`,{method:"DELETE"},{DB:database.DB})).status).toBe(409);
  const response = await journalRouter.request("/bulk-delete",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({entry_ids:[monthly.id]})},{DB:database.DB});
  expect(response.status).toBe(409);
});
