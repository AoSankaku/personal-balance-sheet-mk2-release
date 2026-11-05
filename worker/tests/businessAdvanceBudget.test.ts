import { afterEach, describe, expect, test } from "bun:test";
import type { CreateJournalInput } from "../../shared/types";
import { journalRouter } from "../src/routes/journal";
import { budgetRouter } from "../src/routes/budget";
import { createTestD1 } from "./helpers/d1";

const databases: ReturnType<typeof createTestD1>[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

function fixture(legacyCategory?: "other" | "cash" | "investment") {
  const database = createTestD1();
  databases.push(database);
  database.sqlite.exec(`
    INSERT INTO accounts(id,name,type,category,include_in_allocatable,deduct_from_budget) VALUES
      (1001,'Bank','asset','cash',1,0),
      (1002,'Excluded cash','asset','cash',0,0),
      (1003,'Business advance','asset','${legacyCategory ?? "business_advance"}',0,0),
      (1004,'Loss','expense','other',1,0),
      (1005,'Card','liability','credit_card',1,1),
      (1006,'Excluded card','liability','credit_card',1,0),
      (1007,'Personal expense','expense','food',1,0),
      (1008,'Opening','equity','opening_balance',1,0);
    INSERT INTO budget_categories(id,name) VALUES(1001,'Business reserve'),(1002,'Personal');
    INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,currency,date)
      VALUES(1001,'2026-11',10000,'JPY','2026-11-01'),(1002,'2026-11',10000,'JPY','2026-11-01');
    INSERT OR IGNORE INTO budget_settings(id) VALUES(1);
    UPDATE budget_settings SET business_advance_account_id=1003,business_advance_budget_category_id=1001 WHERE id=1;
    INSERT INTO journal_entries(id,date,description) VALUES(900,'2026-11-01','Opening');
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency)
      VALUES(900,1001,50000,0,'JPY'),(900,1008,0,50000,'JPY');
  `);
  return database;
}

function send(paymentAccountId = 1001, amount = 3000, currency = "JPY"): CreateJournalInput {
  return {
    date: "2026-11-02", description: "Send to business", budget_source: "simple",
    lines: [
      { account_id: 1003, debit: amount, credit: 0, currency },
      { account_id: paymentAccountId, debit: 0, credit: amount, currency },
    ],
    budget_allocations: [{ budget_category_id: 1001, amount: -amount, currency }],
  };
}

function request(database: ReturnType<typeof createTestD1>, body: unknown, path = "/", method = "POST") {
  return journalRouter.request(path, {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }, { DB: database.DB });
}

async function available(database: ReturnType<typeof createTestD1>) {
  const response = await budgetRouter.request("/summary?year_month=2026-11&as_of=2026-11-30", {}, { DB: database.DB });
  expect(response.status).toBe(200);
  const summary = await response.json() as { categories: { category: { id: number }; available: number }[] };
  return summary.categories.filter(row => row.category.id >= 1001).map(row => row.available);
}

describe("business advance budget boundaries", () => {
  test.each([1001, 1005])("consumes the selected budget exactly once from source %s", async source => {
    const database = fixture();
    expect((await request(database, send(source))).status).toBe(201);
    expect(await available(database)).toEqual([7000, 10000]);
    expect(database.sqlite.query("SELECT SUM(debit-credit) AS amount FROM journal_lines WHERE account_id=1003").get()).toEqual({ amount: 3000 });
  });

  test("supports unallocated funding without inventing category consumption", async () => {
    const database = fixture();
    const body = send();
    delete body.budget_allocations;
    expect((await request(database, body)).status).toBe(201);
    expect(await available(database)).toEqual([10000, 10000]);
  });

  test.each([1002, 1006])("canonicalizes outside-budget source %s as reference-only", async source => {
    const database = fixture();
    expect((await request(database, send(source))).status).toBe(201);
    expect(database.sqlite.query("SELECT amount,is_reference FROM journal_entry_budget_allocations").all()).toEqual([{ amount: -3000, is_reference: 1 }]);
    expect(await available(database)).toEqual([10000, 10000]);
  });

  test.each(["other", "cash", "investment"] as const)("recognizes a configured legacy %s advance account", async category => {
    const database = fixture(category);
    expect((await request(database, send())).status).toBe(201);
    expect(await available(database)).toEqual([7000, 10000]);
    const invalid = send();
    invalid.budget_allocations![0]!.amount = -3001;
    expect((await request(database, invalid)).status).toBe(400);
  });

  test.each([-3001, 3000])("rejects an oversized or reversed allocation %s atomically", async allocation => {
    const database = fixture();
    const body = send();
    body.budget_allocations![0]!.amount = allocation;
    expect((await request(database, body)).status).toBe(400);
    expect(database.sqlite.query("SELECT COUNT(*) AS n FROM journal_entries WHERE id<>900").get()).toEqual({ n: 0 });
  });

  test("limits mixed personal/business allocations by the full payment", async () => {
    const database = fixture();
    const body = send(1001, 5000);
    body.lines[0]!.debit = 3000;
    body.lines.push({ account_id: 1007, debit: 2000, credit: 0, currency: "JPY" });
    body.budget_allocations = [{ budget_category_id: 1001, amount: -3000 }, { budget_category_id: 1002, amount: -2001 }];
    expect((await request(database, body)).status).toBe(400);
    body.budget_allocations[1]!.amount = -2000;
    expect((await request(database, body)).status).toBe(201);
    expect(await available(database)).toEqual([7000, 8000]);
  });

  test("splits tracked and excluded funding without dropping a yen", async () => {
    const database = fixture();
    const body = send(1001, 965);
    body.lines[1]!.credit = 500;
    body.lines.push({ account_id: 1002, debit: 0, credit: 465, currency: "JPY" });
    expect((await request(database, body)).status).toBe(201);
    expect(database.sqlite.query("SELECT amount,is_reference FROM journal_entry_budget_allocations ORDER BY is_reference").all()).toEqual([
      { amount: -500, is_reference: 0 }, { amount: -465, is_reference: 1 },
    ]);
    expect(await available(database)).toEqual([9500, 10000]);
  });

  test("enforces USD precision on send and edit without changing saved rows on failure", async () => {
    const database = fixture();
    const body = send(1001, 9.65, "USD");
    const created = await request(database, body);
    expect(created.status).toBe(201);
    const saved = await created.json() as { id: number };
    const before = database.sqlite.query("SELECT * FROM journal_lines WHERE journal_entry_id=?").all(saved.id);
    body.budget_allocations![0]!.amount = -9.66;
    expect((await request(database, body, `/${saved.id}`, "PUT")).status).toBe(400);
    expect(database.sqlite.query("SELECT * FROM journal_lines WHERE journal_entry_id=?").all(saved.id)).toEqual(before);
  });

  test("returns a recovery to unallocated money without restoring a reset budget", async () => {
    const database = fixture();
    expect((await request(database, send())).status).toBe(201);
    database.sqlite.exec("INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,currency,date,adjustment_type) VALUES(1001,'2026-11',-7000,'JPY','2026-11-03','reset')");
    expect((await request(database, {
      date: "2026-11-04", description: "Recover advance", budget_source: "simple",
      lines: [{ account_id: 1001, debit: 3000, credit: 0 }, { account_id: 1003, debit: 0, credit: 3000 }],
    })).status).toBe(201);
    expect(await available(database)).toEqual([0, 10000]);
    expect(database.sqlite.query("SELECT SUM(debit-credit) AS amount FROM journal_lines WHERE account_id=1001").get()).toEqual({ amount: 50000 });
  });

  test("disposal cannot consume a second budget, including legacy callers", async () => {
    const database = fixture();
    expect((await request(database, send())).status).toBe(201);
    expect((await request(database, {
      date: "2026-11-03", description: "Dispose advance", budget_source: "simple",
      lines: [{ account_id: 1004, debit: 3000, credit: 0 }, { account_id: 1003, debit: 0, credit: 3000 }],
      budget_allocations: [{ budget_category_id: 1002, amount: -3000 }],
    })).status).toBe(201);
    expect(await available(database)).toEqual([7000, 10000]);
  });

  test("rejects a batch oversplit before any entry is inserted", async () => {
    const database = fixture();
    const invalid = send();
    invalid.budget_allocations![0]!.amount = -3001;
    expect((await request(database, { entries: [send(), invalid] }, "/batch")).status).toBe(400);
    expect(database.sqlite.query("SELECT COUNT(*) AS n FROM journal_entries WHERE id<>900").get()).toEqual({ n: 0 });
  });
});
