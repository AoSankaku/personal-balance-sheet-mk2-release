import { describe, expect, test } from "bun:test";
import { plannedExpensesRouter } from "../src/routes/plannedExpenses";
import { depreciationRouter } from "../src/routes/depreciation";
import { createTestD1 } from "./helpers/d1";

const dailyWriteLimit =
  "D1_ERROR: Your account has exceeded D1's free tier daily row write limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.";

function failBatchAndCountPostFailureReads(database: D1Database) {
  let failedBatch = false;
  let batchCalls = 0;
  let readsAfterFailure = 0;

  function wrap(statement: D1PreparedStatement): D1PreparedStatement {
    return new Proxy(statement, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== "function") return value;

        if (property === "bind") {
          return (...parameters: unknown[]) =>
            wrap(value.apply(target, parameters) as D1PreparedStatement);
        }
        if (["all", "first", "raw"].includes(String(property))) {
          return (...parameters: unknown[]) => {
            if (failedBatch) readsAfterFailure++;
            return value.apply(target, parameters);
          };
        }
        return value.bind(target);
      },
    });
  }

  const original = database;
  const trackedDatabase = {
    ...original,
    prepare: (query: string) => wrap(original.prepare(query)),
    batch: async () => {
      batchCalls++;
      failedBatch = true;
      throw new Error(dailyWriteLimit);
    },
  } as unknown as D1Database;

  return {
    database: trackedDatabase,
    batchCalls: () => batchCalls,
    readsAfterFailure: () => readsAfterFailure,
  };
}

describe("D1 quota propagation through batch-recovery paths", () => {
  test("does not look up a planned-expense replay after a quota error", async () => {
    const fixture = createTestD1();
    try {
      fixture.sqlite.exec(`
        INSERT INTO accounts(id,name,type,category,include_in_allocatable) VALUES
          (1001,'Cash','asset','cash',0),(1002,'Food','expense','food',1);
        INSERT INTO planned_expenses(id,kind,name,estimated_amount)
          VALUES(1001,'wishlist','Food',100);
      `);
      const tracked = failBatchAndCountPostFailureReads(fixture.DB);
      const response = await plannedExpensesRouter.request(
        "/1001/complete-with-journal",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            idempotency_key: "quota-planned-completion",
            journal: {
              date: "2026-10-01",
              description: "Food",
              lines: [
                { account_id: 1002, debit: 100, credit: 0 },
                { account_id: 1001, debit: 0, credit: 100 },
              ],
            },
          }),
        },
        { DB: tracked.database },
      );

      expect(response.status).toBe(500);
      expect(tracked.batchCalls()).toBe(1);
      expect(tracked.readsAfterFailure()).toBe(0);
      expect(
        fixture.sqlite
          .query("SELECT COUNT(*) AS count FROM planned_expense_completion_requests")
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      fixture.close();
    }
  });

  test("does not replay a depreciation-plan create after a quota error", async () => {
    const fixture = createTestD1();
    try {
      const assetId = fixture.sqlite
        .query("INSERT INTO accounts (name,type,category) VALUES ('Laptop','asset','property') RETURNING id")
        .get<{ id: number }>()!.id;
      const cashId = fixture.sqlite
        .query("INSERT INTO accounts (name,type,category) VALUES ('Cash','asset','cash') RETURNING id")
        .get<{ id: number }>()!.id;
      const expenseId = fixture.sqlite
        .query("INSERT INTO accounts (name,type,category) VALUES ('Depreciation','expense','utilities') RETURNING id")
        .get<{ id: number }>()!.id;
      const sourceJournalId = fixture.sqlite
        .query("INSERT INTO journal_entries (date,description) VALUES ('2026-01-01','Laptop purchase') RETURNING id")
        .get<{ id: number }>()!.id;
      fixture.sqlite
        .query("INSERT INTO journal_lines (journal_entry_id,account_id,debit,credit,currency) VALUES (?, ?, 300000, 0, 'JPY'), (?, ?, 0, 300000, 'JPY')")
        .run(sourceJournalId, assetId, sourceJournalId, cashId);
      const purchaseCategoryId = fixture.sqlite
        .query("INSERT INTO budget_categories (name,budget_group) VALUES ('Laptop reserve','savings') RETURNING id")
        .get<{ id: number }>()!.id;
      const sourceCategoryId = fixture.sqlite
        .query("INSERT INTO budget_categories (name,budget_group) VALUES ('Living costs','daily') RETURNING id")
        .get<{ id: number }>()!.id;

      const tracked = failBatchAndCountPostFailureReads(fixture.DB);
      const response = await depreciationRouter.request(
        "/",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            purchase_date: "2026-10-01",
            description: "Laptop",
            asset_account_id: assetId,
            payment_account_id: cashId,
            expense_account_id: expenseId,
            total_amount: 300000,
            months: 30,
            currency: "JPY",
            budget_settings: {
              method: "assigned",
              purchase_category_id: purchaseCategoryId,
              monthly_source_category_id: sourceCategoryId,
            },
            idempotency_key: "quota-depreciation-create",
          }),
        },
        { DB: tracked.database },
      );

      expect(response.status).toBe(500);
      expect(tracked.batchCalls()).toBe(1);
      expect(tracked.readsAfterFailure()).toBe(0);
      expect(
        fixture.sqlite
          .query("SELECT COUNT(*) AS count FROM depreciation_schedules WHERE budget_idempotency_key='quota-depreciation-create'")
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      fixture.close();
    }
  });
});
