import { afterEach, describe, expect, test } from "bun:test";
import { createTestD1 } from "./helpers/d1";
import { trialBalanceRouter } from "../src/routes/trialBalance";

const databases: ReturnType<typeof createTestD1>[] = [];

function newDatabase() {
  const database = createTestD1();
  databases.push(database);
  return database;
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("actual balance adjustment routes", () => {
  test("reconciles a saved general snapshot through a route", async () => {
    const { DB, sqlite } = newDatabase();
    sqlite.exec(`
      INSERT INTO accounts (id, name, type, category) VALUES
        (1, 'Wallet', 'asset', 'cash'),
        (2, '__system:unknown_funds__', 'asset', 'other');
      INSERT INTO actual_balance_snapshots (id, snapshot_date, snapshot_time)
        VALUES (10, '2026-06-30', '23:59');
      INSERT INTO actual_balance_entries (id, snapshot_id, account_id, amount, currency)
        VALUES (100, 10, 1, 12000, 'JPY');
    `);

    const response = await trialBalanceRouter.request(
      "/snapshots/10/adjustments",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries: [{ account_id: 1, currency: "JPY" }] }),
      },
      { DB },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });

  test("resolves a legacy unknown-funds entry by reclassifying its original lines", async () => {
    const { DB, sqlite } = newDatabase();
    sqlite.exec(`
      INSERT INTO accounts (id, name, type, category) VALUES
        (1, '__system:unknown_funds__', 'asset', 'other'),
        (2, '__system:misc_expense__', 'expense', 'other'),
        (3, 'Wallet', 'asset', 'cash');
      INSERT INTO journal_entries (id, date, description)
        VALUES (20, '2026-06-01', 'Unidentified cash difference');
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, currency) VALUES
        (20, 1, 0, 4500, 'JPY'),
        (20, 3, 4500, 0, 'JPY');
    `);

    const response = await trialBalanceRouter.request(
      "/unknown-funds/20/resolve",
      { method: "POST" },
      { DB },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, is_resolved: true });
  });
});
