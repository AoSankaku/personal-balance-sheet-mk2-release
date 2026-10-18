import { afterEach, describe, expect, test } from "bun:test";
import { journalRouter } from "../src/routes/journal";
import { budgetRouter } from "../src/routes/budget";
import { createTestD1 } from "./helpers/d1";

const databases: ReturnType<typeof createTestD1>[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

function fixture() {
  const database = createTestD1();
  databases.push(database);
  database.sqlite.exec(`
    INSERT INTO accounts(id,name,type,category,include_in_allocatable,deduct_from_budget) VALUES
      (1001,'Bank','asset','cash',1,0),
      (1002,'Excluded cash','asset','cash',0,0),
      (1003,'Expense','expense','food',1,0),
      (1005,'Card','liability','credit_card',1,1),
      (1007,'Other expense','expense','other',1,0);
    INSERT INTO budget_categories(id,name) VALUES(1001,'First'),(1002,'Second');
    INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,currency,date)
      VALUES(1001,'2026-10',10000,'JPY','2026-10-01'),(1002,'2026-10',10000,'JPY','2026-10-01');
  `);
  return database;
}

function payload(total: number, paymentAccount = 1001, refund = false) {
  return {
    date: "2026-10-02", description: "Expense split", budget_source: "simple",
    lines: [
      { account_id: 1003, debit: refund ? 0 : total, credit: refund ? total : 0, currency: "JPY" },
      { account_id: paymentAccount, debit: refund ? total : 0, credit: refund ? 0 : total, currency: "JPY" },
    ],
    budget_allocations: [
      { budget_category_id: 1001, amount: (refund ? 1 : -1) * Math.ceil(total / 2) },
      { budget_category_id: 1002, amount: (refund ? 1 : -1) * Math.floor(total / 2) },
    ] as { budget_category_id: number; amount: number; currency?: string; is_reference?: boolean }[],
  };
}

function request(database: ReturnType<typeof createTestD1>, body: unknown, path = "/", method = "POST") {
  return journalRouter.request(path, {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }, { DB: database.DB });
}

async function balances(database: ReturnType<typeof createTestD1>) {
  const response = await budgetRouter.request("/summary?year_month=2026-10", {}, { DB: database.DB });
  expect(response.status).toBe(200);
  const summary = await response.json() as { categories: { category: { id: number }; available: number }[] };
  return summary.categories.filter(row => row.category.id >= 1001).map(row => row.available);
}

describe("expense budget allocation limits", () => {
  for (const total of [965, 429]) {
    for (const paymentAccount of [1001, 1005]) {
      test(`rejects a one-yen oversplit of ${total} paid from ${paymentAccount}`, async () => {
        const database = fixture();
        const body = payload(total, paymentAccount);
        body.budget_allocations[1]!.amount -= 1;
        const response = await request(database, body);
        expect(response.status).toBe(400);
        expect(database.sqlite.query("SELECT COUNT(*) AS n FROM journal_entries").get()).toEqual({ n: 0 });
        expect(database.sqlite.query("SELECT COUNT(*) AS n FROM journal_entry_budget_allocations").get()).toEqual({ n: 0 });
      });

      test(`accepts an exact ${total} split paid from ${paymentAccount}`, async () => {
        const database = fixture();
        expect((await request(database, payload(total, paymentAccount))).status).toBe(201);
        expect(database.sqlite.query("SELECT SUM(amount) AS amount FROM journal_entry_budget_allocations").get()).toEqual({ amount: -total });
      });
    }
  }

  test("rejects a one-yen oversplit of a refund", async () => {
    const database = fixture();
    const body = payload(965, 1001, true);
    body.budget_allocations[1]!.amount += 1;
    expect((await request(database, body)).status).toBe(400);
    expect(database.sqlite.query("SELECT COUNT(*) AS n FROM journal_entries").get()).toEqual({ n: 0 });
  });

  test("rejects an oversplit batch before inserting any entries", async () => {
    const database = fixture();
    const invalid = payload(965);
    invalid.budget_allocations[1]!.amount -= 1;
    expect((await request(database, { entries: [payload(429), invalid] }, "/batch")).status).toBe(400);
    expect(database.sqlite.query("SELECT COUNT(*) AS n FROM journal_entries").get()).toEqual({ n: 0 });
  });

  test("enforces the limit in currency storage units", async () => {
    const database = fixture();
    const body = payload(9.65);
    body.lines.forEach(line => { line.currency = "USD"; });
    body.budget_allocations = [
      { budget_category_id: 1001, amount: -4.83, currency: "USD" },
      { budget_category_id: 1002, amount: -4.83, currency: "USD" },
    ];
    expect((await request(database, body)).status).toBe(400);
    body.budget_allocations[1]!.amount = -4.82;
    expect((await request(database, body)).status).toBe(201);
  });

  test("rejects an allocation with the opposite direction to an expense", async () => {
    const database = fixture();
    const body = payload(965);
    body.budget_allocations = [{ budget_category_id: 1001, amount: 100 }];
    expect((await request(database, body)).status).toBe(400);
  });

  test("preserves compound expenses with a simultaneous refund", async () => {
    const database = fixture();
    expect((await request(database, {
      date: "2026-10-02", description: "Compound expense and refund",
      lines: [
        { account_id: 1003, debit: 1000, credit: 0 },
        { account_id: 1007, debit: 0, credit: 200 },
        { account_id: 1001, debit: 0, credit: 800 },
      ],
      budget_allocations: [
        { budget_category_id: 1001, amount: -1000 },
        { budget_category_id: 1002, amount: 200 },
      ],
    })).status).toBe(201);
    expect(await balances(database)).toEqual([9000, 10200]);
  });

  test("accepts a partial allocation and ignores reference-only amounts in the limit", async () => {
    const database = fixture();
    const body = payload(965);
    body.budget_allocations = [
      { budget_category_id: 1001, amount: -400 },
      { budget_category_id: 1002, amount: -1000, is_reference: true },
    ];
    expect((await request(database, body)).status).toBe(201);
    expect(await balances(database)).toEqual([9600, 10000]);
  });

  test("rejects an oversplit edit before changing existing financial or budget rows", async () => {
    const database = fixture();
    const body = payload(965);
    const created = await request(database, body);
    expect(created.status).toBe(201);
    const entry = await created.json() as { id: number };
    const linesBefore = database.sqlite.query("SELECT * FROM journal_lines ORDER BY id").all();
    const allocationsBefore = database.sqlite.query("SELECT * FROM journal_entry_budget_allocations ORDER BY id").all();
    body.budget_allocations[1]!.amount -= 1;
    expect((await request(database, body, `/${entry.id}`, "PUT")).status).toBe(400);
    expect(database.sqlite.query("SELECT * FROM journal_lines ORDER BY id").all()).toEqual(linesBefore);
    expect(database.sqlite.query("SELECT * FROM journal_entry_budget_allocations ORDER BY id").all()).toEqual(allocationsBefore);
  });

  test("automatically makes an excluded-cash expense reference-only", async () => {
    const database = fixture();
    const body = payload(1180, 1002);
    body.budget_allocations = [{ budget_category_id: 1001, amount: -1180 }];
    expect((await request(database, body)).status).toBe(201);
    expect(database.sqlite.query("SELECT amount,is_reference FROM journal_entry_budget_allocations").all()).toEqual([{ amount: -1180, is_reference: 1 }]);
    expect(await balances(database)).toEqual([10000, 10000]);
  });

  test("references a legacy excluded-cash allocation without rewriting its financial entry", async () => {
    const database = fixture();
    database.sqlite.exec(`
      INSERT INTO journal_entries(id,date,description) VALUES(900,'2026-10-02','Legacy excluded cash expense');
      INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency)
        VALUES(900,1003,1180,0,'JPY'),(900,1002,0,1180,'JPY');
      INSERT INTO journal_entry_budget_allocations(journal_entry_id,budget_category_id,amount,currency,is_reference)
        VALUES(900,1001,-1180,'JPY',0);
    `);
    expect(await balances(database)).toEqual([8820, 10000]);
    const headerBefore = database.sqlite.query("SELECT * FROM journal_entries").all();
    const linesBefore = database.sqlite.query("SELECT * FROM journal_lines ORDER BY id").all();
    expect((await request(database, { is_reference: true }, "/900/budget-allocations/reference", "PATCH")).status).toBe(200);
    expect(await balances(database)).toEqual([10000, 10000]);
    expect(database.sqlite.query("SELECT * FROM journal_entries").all()).toEqual(headerBefore);
    expect(database.sqlite.query("SELECT * FROM journal_lines ORDER BY id").all()).toEqual(linesBefore);
  });
});
