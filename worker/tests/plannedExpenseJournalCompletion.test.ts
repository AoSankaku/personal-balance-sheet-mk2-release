import { describe, expect, test } from "bun:test";
import { plannedExpensesRouter } from "../src/routes/plannedExpenses";
import { trialBalanceRouter } from "../src/routes/trialBalance";
import { createTestD1 } from "./helpers/d1";

describe("planned expense journal completion", () => {
  test("records completion once and rebuilds saved cash checkpoints in the same transaction", async () => {
    const database = createTestD1();
    try {
      database.sqlite.exec(`
        INSERT INTO accounts(id,name,type,category,include_in_allocatable) VALUES
          (1001,'Cash','asset','cash',0),(1002,'Food','expense','food',1);
        INSERT INTO planned_expenses(id,kind,name,estimated_amount) VALUES(1001,'wishlist','Food',100);
        INSERT INTO actual_balance_snapshots(id,snapshot_date) VALUES(1001,'2026-10-15');
        INSERT INTO actual_balance_entries(id,snapshot_id,account_id,amount,currency) VALUES(1001,1001,1001,500,'JPY');
      `);
      const env = { DB: database.DB };
      const adjusted = await trialBalanceRouter.request("/snapshots/1001/adjustments", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }, env);
      expect(adjusted.status).toBe(200);
      const request = () => plannedExpensesRouter.request("/1001/complete-with-journal", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
          idempotency_key: "planned-expense-cash-checkpoint", journal: {
            date: "2026-10-01", description: "Food", lines: [
              { account_id: 1002, debit: 100, credit: 0 }, { account_id: 1001, debit: 0, credit: 100 },
            ],
          },
        }),
      }, env);
      expect((await request()).status).toBe(201);
      expect(database.sqlite.query("SELECT status FROM planned_expenses WHERE id=1001").get()).toEqual({ status: "completed" });
      expect(database.sqlite.query("SELECT amount FROM actual_balance_adjustments").get()).toEqual({ amount: 600 });
      expect((await request()).status).toBe(200);
      expect(database.sqlite.query("SELECT COUNT(*) AS n FROM journal_entries").get()).toEqual({ n: 2 });
    } finally {
      database.close();
    }
  });
});
