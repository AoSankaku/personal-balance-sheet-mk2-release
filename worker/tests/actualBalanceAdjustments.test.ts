import { afterEach, describe, expect, test } from "bun:test";
import { buildActualBalanceAdjustmentRefreshStatements } from "../src/lib/actualBalanceAdjustments";
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
  test("stores, reads, and reconciles custom currencies using configured precision", async () => {
    const { DB, sqlite } = newDatabase();
    sqlite.exec(`
      INSERT INTO enabled_currencies (code, decimal_places) VALUES
        ('ZZZ', 0), ('XAA', 4)
      ON CONFLICT(code) DO UPDATE SET decimal_places = excluded.decimal_places;
    `);
    const zeroScaleAccount = Number(
      (
        sqlite
          .query(
            "INSERT INTO accounts (name, type, category) VALUES ('Zero scale cash', 'asset', 'cash') RETURNING id",
          )
          .get() as { id: number }
      ).id,
    );
    const fourScaleAccount = Number(
      (
        sqlite
          .query(
            "INSERT INTO accounts (name, type, category) VALUES ('Four scale cash', 'asset', 'cash') RETURNING id",
          )
          .get() as { id: number }
      ).id,
    );

    const created = await trialBalanceRouter.request(
      "/snapshots",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          snapshot_date: "2026-09-30",
          general_entries: [
            { account_id: zeroScaleAccount, amount: 12, currency: "ZZZ" },
            { account_id: fourScaleAccount, amount: 1.2345, currency: "XAA" },
          ],
        }),
      },
      { DB },
    );
    expect(created.status).toBe(201);
    const createdSnapshot = (await created.json()) as {
      id: number;
      general_entries: { id: number; account_id: number; amount: number; currency: string }[];
    };
    expect(
      sqlite
        .query(
          "SELECT account_id, amount, money_scale, currency FROM actual_balance_entries ORDER BY account_id",
        )
        .all(),
    ).toEqual([
      { account_id: zeroScaleAccount, amount: 12, money_scale: 0, currency: "ZZZ" },
      { account_id: fourScaleAccount, amount: 12345, money_scale: 4, currency: "XAA" },
    ]);
    expect(
      createdSnapshot.general_entries
        .map((entry) => [entry.account_id, entry.amount, entry.currency])
        .sort((a, b) => Number(a[0]) - Number(b[0])),
    ).toEqual([
      [zeroScaleAccount, 12, "ZZZ"],
      [fourScaleAccount, 1.2345, "XAA"],
    ]);

    const applied = await trialBalanceRouter.request(
      `/snapshots/${createdSnapshot.id}/adjustments`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      { DB },
    );
    expect(applied.status).toBe(200);
    expect(
      sqlite
        .query(
          `SELECT entry.account_id, adjustment.amount, adjustment.default_money_scale
           FROM actual_balance_adjustments AS adjustment
           JOIN actual_balance_entries AS entry ON entry.id = adjustment.actual_balance_entry_id
           ORDER BY entry.account_id`,
        )
        .all(),
    ).toEqual([
      { account_id: zeroScaleAccount, amount: 12, default_money_scale: 2 },
      { account_id: fourScaleAccount, amount: 12345, default_money_scale: 2 },
    ]);
    expect(
      sqlite
        .query(
          `SELECT entry.account_id, line.debit, line.credit, line.currency
           FROM actual_balance_adjustments AS adjustment
           JOIN actual_balance_entries AS entry
             ON entry.id = adjustment.actual_balance_entry_id
           JOIN journal_lines AS line
             ON line.journal_entry_id = adjustment.journal_entry_id
            AND line.account_id = entry.account_id
           ORDER BY entry.account_id`,
        )
        .all(),
    ).toEqual([
      { account_id: zeroScaleAccount, debit: 12, credit: 0, currency: "ZZZ" },
      { account_id: fourScaleAccount, debit: 12345, credit: 0, currency: "XAA" },
    ]);
  });

  test("rescales legacy null-scale snapshots from canonical default precision", async () => {
    const { DB, sqlite } = newDatabase();
    sqlite.exec(`
      INSERT INTO enabled_currencies (code, decimal_places) VALUES
        ('ZZZ', 4), ('ZZY', 0)
      ON CONFLICT(code) DO UPDATE SET decimal_places = excluded.decimal_places;
    `);
    const cashId = Number(
      (
        sqlite
          .query(
            "INSERT INTO accounts (name, type, category) VALUES ('Legacy custom cash', 'asset', 'cash') RETURNING id",
          )
          .get() as { id: number }
      ).id,
    );
    const zeroScaleCashId = Number(
      (
        sqlite
          .query(
            "INSERT INTO accounts (name, type, category) VALUES ('Legacy zero scale cash', 'asset', 'cash') RETURNING id",
          )
          .get() as { id: number }
      ).id,
    );
    sqlite.exec(`
      INSERT INTO actual_balance_snapshots (id, snapshot_date) VALUES
        (90, '2026-09-30'), (91, '2026-09-30'), (92, '2026-09-30');
      INSERT INTO actual_balance_entries (id, snapshot_id, account_id, amount, currency)
        VALUES
          (900, 90, ${cashId}, 1234, 'ZZZ'),
          (901, 91, ${zeroScaleCashId}, 1200, 'ZZY'),
          (902, 92, ${zeroScaleCashId}, 1234, 'ZZY');
    `);

    const read = await trialBalanceRouter.request("/snapshots", {}, { DB });
    expect(read.status).toBe(200);
    const snapshots = (await read.json()) as {
      id: number;
      general_entries: { amount: number; currency: string }[];
    }[];
    const legacySnapshot = snapshots.find((snapshot) => snapshot.id === 90);
    expect(legacySnapshot?.general_entries[0]?.amount).toBe(12.34);
    expect(legacySnapshot?.general_entries[0]?.currency).toBe("ZZZ");

    for (const snapshotId of [90, 91]) {
      const applied = await trialBalanceRouter.request(
        `/snapshots/${snapshotId}/adjustments`,
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
        { DB },
      );
      expect(applied.status).toBe(200);
    }
    const unrepresentable = await trialBalanceRouter.request(
      "/snapshots/92/adjustments",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      { DB },
    );
    expect(unrepresentable.status).toBe(409);
    expect(
      sqlite
        .query(
          "SELECT COUNT(*) AS count FROM actual_balance_adjustments WHERE actual_balance_entry_id = 902",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(
      sqlite
        .query(
          "SELECT actual_balance_entry_id, amount, default_money_scale FROM actual_balance_adjustments ORDER BY actual_balance_entry_id",
        )
        .all(),
    ).toEqual([
      { actual_balance_entry_id: 900, amount: 123400, default_money_scale: 2 },
      { actual_balance_entry_id: 901, amount: 12, default_money_scale: 2 },
    ]);
    const adjustmentLines = sqlite
      .query(
        `SELECT entry.id AS actual_balance_entry_id, line.debit, line.credit
         FROM actual_balance_adjustments AS adjustment
         JOIN actual_balance_entries AS entry
           ON entry.id = adjustment.actual_balance_entry_id
         JOIN journal_lines AS line ON line.journal_entry_id = adjustment.journal_entry_id
         WHERE line.account_id = entry.account_id
         ORDER BY entry.id`,
      )
      .all();
    expect(adjustmentLines).toEqual([
      { actual_balance_entry_id: 900, debit: 123400, credit: 0 },
      { actual_balance_entry_id: 901, debit: 12, credit: 0 },
    ]);
  });

  test("rejects snapshot creation for system, income, and equity accounts", async () => {
    const { DB, sqlite } = newDatabase();
    const unknownFundsId = Number(
      (
        sqlite
          .query("SELECT id FROM accounts WHERE name = '__system:unknown_funds__'")
          .get() as { id: number }
      ).id,
    );
    const incomeId = Number(
      (
        sqlite
          .query(
            "INSERT INTO accounts (name, type, category) VALUES ('Salary', 'income', 'salary') RETURNING id",
          )
          .get() as { id: number }
      ).id,
    );
    const equityId = Number(
      (
        sqlite
          .query(
            "INSERT INTO accounts (name, type, category) VALUES ('Owner equity', 'equity', 'opening_balance') RETURNING id",
          )
          .get() as { id: number }
      ).id,
    );

    for (const accountId of [unknownFundsId, incomeId, equityId]) {
      const response = await trialBalanceRouter.request(
        "/snapshots",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            snapshot_date: "2026-06-30",
            general_entries: [{ account_id: accountId, amount: 100 }],
          }),
        },
        { DB },
      );
      expect(response.status).toBe(400);
    }
    expect(
      sqlite
        .query("SELECT COUNT(*) AS count FROM actual_balance_snapshots")
        .get(),
    ).toEqual({ count: 0 });
    expect(
      sqlite
        .query("SELECT COUNT(*) AS count FROM actual_balance_entries")
        .get(),
    ).toEqual({ count: 0 });
  });

  test("does not apply legacy snapshots containing system, income, or equity targets", async () => {
    const { DB, sqlite } = newDatabase();
    const unknownFundsId = Number(
      (
        sqlite
          .query("SELECT id FROM accounts WHERE name = '__system:unknown_funds__'")
          .get() as { id: number }
      ).id,
    );
    const incomeId = Number(
      (
        sqlite
          .query(
            "INSERT INTO accounts (name, type, category) VALUES ('Salary', 'income', 'salary') RETURNING id",
          )
          .get() as { id: number }
      ).id,
    );
    const equityId = Number(
      (
        sqlite
          .query(
            "INSERT INTO accounts (name, type, category) VALUES ('Owner equity', 'equity', 'opening_balance') RETURNING id",
          )
          .get() as { id: number }
      ).id,
    );
    sqlite.exec(`
      INSERT INTO actual_balance_snapshots (id, snapshot_date) VALUES
        (1, '2026-06-30'), (2, '2026-06-30'), (3, '2026-06-30');
      INSERT INTO actual_balance_entries (id, snapshot_id, account_id, amount, currency) VALUES
        (101, 1, ${unknownFundsId}, 100, 'JPY'),
        (102, 2, ${incomeId}, 100, 'JPY'),
        (103, 3, ${equityId}, 100, 'JPY');
    `);

    for (const snapshotId of [1, 2, 3]) {
      const response = await trialBalanceRouter.request(
        `/snapshots/${snapshotId}/adjustments`,
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
        { DB },
      );
      expect(response.status).toBe(400);
    }
    expect(
      sqlite.query("SELECT COUNT(*) AS count FROM actual_balance_adjustments").get(),
    ).toEqual({ count: 0 });
    expect(sqlite.query("SELECT COUNT(*) AS count FROM journal_entries").get()).toEqual({ count: 0 });
    expect(sqlite.query("SELECT COUNT(*) AS count FROM journal_lines").get()).toEqual({ count: 0 });
  });

  test("reconciles a saved general snapshot through a route", async () => {
    const { DB, sqlite } = newDatabase();
    const cashId = Number(
      (
        sqlite
          .query(
            "INSERT INTO accounts (name, type, category) VALUES ('Wallet', 'asset', 'cash') RETURNING id",
          )
          .get() as { id: number }
      ).id,
    );
    sqlite.exec(`
      INSERT INTO actual_balance_snapshots (id, snapshot_date, snapshot_time)
        VALUES (10, '2026-06-30', '23:59');
      INSERT INTO actual_balance_entries (id, snapshot_id, account_id, amount, currency)
        VALUES (100, 10, ${cashId}, 12000, 'JPY');
    `);

    const request = () =>
      trialBalanceRouter.request(
        "/snapshots/10/adjustments",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            entries: [{ account_id: cashId, currency: "JPY", amount: 999999 }],
          }),
        },
        { DB },
      );
    const responses = await Promise.all([request(), request()]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(await responses[0]!.json()).toMatchObject({ ok: true });
    expect(
      sqlite
        .query("SELECT COUNT(*) AS count FROM actual_balance_adjustments")
        .get(),
    ).toEqual({ count: 1 });
    const linkedEntry = sqlite
      .query(
        `SELECT adjustment.journal_entry_id FROM actual_balance_adjustments AS adjustment WHERE adjustment.actual_balance_entry_id = 100`,
      )
      .get() as { journal_entry_id: number };
    expect(
      sqlite
        .query("SELECT COUNT(*) AS count FROM journal_entries WHERE id = ?")
        .get(linkedEntry.journal_entry_id),
    ).toEqual({ count: 1 });
    expect(
      sqlite
        .query(
          "SELECT COUNT(*) AS count FROM journal_lines WHERE journal_entry_id = ?",
        )
        .get(linkedEntry.journal_entry_id),
    ).toEqual({ count: 2 });
    expect(
      sqlite
        .query(
          "SELECT account_id, debit, credit FROM journal_lines WHERE journal_entry_id = ? ORDER BY id",
        )
        .get(linkedEntry.journal_entry_id),
    ).toEqual({ account_id: cashId, debit: 12000, credit: 0 });
    expect(
      sqlite
        .query(
          "SELECT debit, credit FROM journal_lines WHERE journal_entry_id = ? AND account_id != ?",
        )
        .get(linkedEntry.journal_entry_id, cashId),
    ).toEqual({ debit: 0, credit: 12000 });

    const resolveResponse = await trialBalanceRouter.request(
      `/unknown-funds/${linkedEntry.journal_entry_id}/resolve`,
      { method: "POST" },
      { DB },
    );
    expect(resolveResponse.status).toBe(200);
    expect(
      sqlite
        .query(
          "SELECT is_resolved FROM actual_balance_adjustments WHERE actual_balance_entry_id = 100",
        )
        .get(),
    ).toEqual({ is_resolved: 1 });
    const miscIncomeId = Number(
      (
        sqlite
          .query(
            "SELECT id FROM accounts WHERE name = '__system:misc_income__'",
          )
          .get() as { id: number }
      ).id,
    );
    expect(
      sqlite
        .query(
          "SELECT account_id FROM journal_lines WHERE journal_entry_id = ? AND account_id != ?",
        )
        .get(linkedEntry.journal_entry_id, cashId),
    ).toEqual({ account_id: miscIncomeId });
  });

  test("resolves a legacy unknown-funds entry by reclassifying its original lines", async () => {
    const { DB, sqlite } = newDatabase();
    const unknownId = Number(
      (
        sqlite
          .query(
            "SELECT id FROM accounts WHERE name = '__system:unknown_funds__'",
          )
          .get() as { id: number }
      ).id,
    );
    const cashId = Number(
      (
        sqlite
          .query(
            "INSERT INTO accounts (name, type, category) VALUES ('Wallet', 'asset', 'cash') RETURNING id",
          )
          .get() as { id: number }
      ).id,
    );
    sqlite.exec(`
      INSERT INTO journal_entries (id, date, description)
        VALUES (20, '2026-06-01', 'Unidentified cash difference');
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, currency) VALUES
        (20, ${unknownId}, 0, 4500, 'JPY'),
        (20, ${cashId}, 4500, 0, 'JPY'),
        (20, ${unknownId}, 123, 0, 'USD'),
        (20, ${cashId}, 0, 123, 'USD');
    `);

    const request = () =>
      trialBalanceRouter.request(
        "/unknown-funds/20/resolve",
        { method: "POST" },
        { DB },
      );
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, is_resolved: true });
    expect((await request()).status).toBe(200);
    const miscIncomeId = Number(
      (
        sqlite
          .query(
            "SELECT id FROM accounts WHERE name = '__system:misc_income__'",
          )
          .get() as { id: number }
      ).id,
    );
    const miscExpenseId = Number(
      (
        sqlite
          .query(
            "SELECT id FROM accounts WHERE name = '__system:misc_expense__'",
          )
          .get() as { id: number }
      ).id,
    );
    expect(
      sqlite
        .query(
          "SELECT account_id, debit, credit, currency FROM journal_lines WHERE journal_entry_id = 20 ORDER BY id",
        )
        .all(),
    ).toEqual([
      { account_id: miscIncomeId, debit: 0, credit: 4500, currency: "JPY" },
      { account_id: cashId, debit: 4500, credit: 0, currency: "JPY" },
      { account_id: miscExpenseId, debit: 123, credit: 0, currency: "USD" },
      { account_id: cashId, debit: 0, credit: 123, currency: "USD" },
    ]);
    expect(
      sqlite.query("SELECT COUNT(*) AS count FROM journal_entries").get(),
    ).toEqual({ count: 1 });
  });

  test("deletes snapshot-owned journals atomically and rebuilds later checkpoints", async () => {
    const { DB, sqlite } = newDatabase();
    const cashId = Number(
      (
        sqlite
          .query(
            "INSERT INTO accounts (name, type, category) VALUES ('Wallet', 'asset', 'cash') RETURNING id",
          )
          .get() as { id: number }
      ).id,
    );
    const equityId = Number(
      (
        sqlite
          .query(
            "INSERT INTO accounts (name, type, category) VALUES ('Equity', 'equity', 'opening_balance') RETURNING id",
          )
          .get() as { id: number }
      ).id,
    );
    const expenseId = Number(
      (
        sqlite
          .query(
            "INSERT INTO accounts (name, type, category) VALUES ('Expense', 'expense', 'other') RETURNING id",
          )
          .get() as { id: number }
      ).id,
    );
    sqlite.exec(`
      INSERT INTO journal_entries (id, date, description) VALUES
        (30, '2026-06-01', 'Opening'),
        (31, '2026-06-15', 'June expense'),
        (32, '2026-07-15', 'July expense');
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, currency) VALUES
        (30, ${cashId}, 100, 0, 'JPY'),
        (30, ${equityId}, 0, 100, 'JPY'),
        (31, ${expenseId}, 20, 0, 'JPY'),
        (31, ${cashId}, 0, 20, 'JPY'),
        (32, ${expenseId}, 10, 0, 'JPY'),
        (32, ${cashId}, 0, 10, 'JPY');
      INSERT INTO actual_balance_snapshots (id, snapshot_date, snapshot_time) VALUES
        (20, '2026-06-30', '23:59'),
        (21, '2026-07-31', '23:59');
      INSERT INTO actual_balance_entries (id, snapshot_id, account_id, amount, currency) VALUES
        (200, 20, ${cashId}, 90, 'JPY'),
        (210, 21, ${cashId}, 75, 'JPY');
    `);

    for (const snapshotId of [20, 21]) {
      const response = await trialBalanceRouter.request(
        `/snapshots/${snapshotId}/adjustments`,
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
        { DB },
      );
      expect(response.status).toBe(200);
    }
    expect(
      sqlite
        .query(
          "SELECT amount FROM actual_balance_adjustments WHERE actual_balance_entry_id = 210",
        )
        .get(),
    ).toEqual({ amount: -5 });

    const deleted = await trialBalanceRouter.request(
      "/snapshots/20",
      { method: "DELETE" },
      { DB },
    );
    expect(deleted.status).toBe(200);
    expect(
      sqlite
        .query("SELECT COUNT(*) AS count FROM actual_balance_snapshots WHERE id = 20")
        .get(),
    ).toEqual({ count: 0 });
    expect(
      sqlite
        .query("SELECT COUNT(*) AS count FROM actual_balance_adjustments")
        .get(),
    ).toEqual({ count: 1 });
    expect(
      sqlite
        .query(
          "SELECT COUNT(*) AS count FROM journal_entries WHERE description LIKE 'Actual balance adjustment%'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(
      sqlite
        .query(
          "SELECT amount FROM actual_balance_adjustments WHERE actual_balance_entry_id = 210",
        )
        .get(),
    ).toEqual({ amount: 5 });
  });

  test("rolls back headers and lines if saving the ownership link fails", async () => {
    const { DB, sqlite } = newDatabase();
    const cashId = Number(
      (
        sqlite
          .query(
            "INSERT INTO accounts (name, type, category) VALUES ('Wallet', 'asset', 'cash') RETURNING id",
          )
          .get() as { id: number }
      ).id,
    );
    sqlite.exec(`
      INSERT INTO actual_balance_snapshots (id, snapshot_date)
        VALUES (30, '2026-08-31');
      INSERT INTO actual_balance_entries (id, snapshot_id, account_id, amount, currency)
        VALUES (300, 30, ${cashId}, 100, 'JPY');
      CREATE TRIGGER reject_actual_balance_adjustment
      BEFORE INSERT ON actual_balance_adjustments
      BEGIN SELECT RAISE(ABORT, 'simulated link failure'); END;
    `);

    const response = await trialBalanceRouter.request(
      "/snapshots/30/adjustments",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      { DB },
    );

    expect(response.status).toBe(500);
    expect(
      sqlite
        .query(
          "SELECT COUNT(*) AS count FROM journal_entries WHERE description LIKE 'Actual balance adjustment%'",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(
      sqlite
        .query("SELECT COUNT(*) AS count FROM actual_balance_adjustments")
        .get(),
    ).toEqual({ count: 0 });
    expect(
      sqlite.query("SELECT COUNT(*) AS count FROM journal_lines").get(),
    ).toEqual({ count: 0 });
  });

  test("rejects malformed adjustment selection bodies", async () => {
    const { DB, sqlite } = newDatabase();
    const cashId = Number(
      (
        sqlite
          .query(
            "INSERT INTO accounts (name, type, category) VALUES ('Wallet', 'asset', 'cash') RETURNING id",
          )
          .get() as { id: number }
      ).id,
    );
    sqlite.exec(`
      INSERT INTO actual_balance_snapshots (id, snapshot_date)
        VALUES (11, '2026-07-31');
      INSERT INTO actual_balance_entries (id, snapshot_id, account_id, amount, currency)
        VALUES (101, 11, ${cashId}, 12000, 'JPY');
    `);

    for (const body of ["null", JSON.stringify({ entries: {} }), JSON.stringify({ entries: [null] })]) {
      const response = await trialBalanceRouter.request(
        "/snapshots/11/adjustments",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        },
        { DB },
      );
      expect(response.status).toBe(400);
    }
    expect(
      sqlite
        .query("SELECT COUNT(*) AS count FROM actual_balance_adjustments")
        .get(),
    ).toEqual({ count: 0 });
  });
});

describe("actual balance adjustment refresh", () => {
  test("rebuilds checkpoint deltas after backdated ledger changes and picks the latest same-day checkpoint", async () => {
    const { DB, sqlite } = newDatabase();
    const cashId = Number(
      (sqlite
        .query(
          "INSERT INTO accounts (name, type, category) VALUES ('Cash', 'asset', 'cash') RETURNING id",
        )
        .get() as { id: number }).id,
    );
    const equityId = Number(
      (
        sqlite
          .query(
            "INSERT INTO accounts (name, type, category) VALUES ('Equity', 'equity', 'opening_balance') RETURNING id",
          )
          .get() as { id: number }
      ).id,
    );
    const expenseId = Number(
      (
        sqlite
          .query(
            "INSERT INTO accounts (name, type, category) VALUES ('Expense', 'expense', 'other') RETURNING id",
          )
          .get() as { id: number }
      ).id,
    );
    const unknownId = Number(
      (
        sqlite
          .query(
            "SELECT id FROM accounts WHERE name = '__system:unknown_funds__'",
          )
          .get() as { id: number }
      ).id,
    );

    sqlite.exec(`
      INSERT INTO journal_entries (id, date, description) VALUES
        (1, '2026-06-01', 'Opening cash'),
        (2, '2026-06-30', 'Adjustment June'),
        (3, '2026-07-31', 'Adjustment July'),
        (4, '2026-06-15', 'June cash expense'),
        (5, '2026-07-15', 'July cash expense');
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, currency) VALUES
        (1, ${cashId}, 100, 0, 'JPY'),
        (1, ${equityId}, 0, 100, 'JPY'),
        (4, ${expenseId}, 20, 0, 'JPY'),
        (4, ${cashId}, 0, 20, 'JPY'),
        (5, ${expenseId}, 10, 0, 'JPY'),
        (5, ${cashId}, 0, 10, 'JPY');
      `);
    sqlite.exec(`
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, currency) VALUES
        (2, ${cashId}, 0, 10, 'JPY'),
        (2, ${unknownId}, 10, 0, 'JPY'),
        (3, ${cashId}, 0, 10, 'JPY'),
        (3, ${unknownId}, 10, 0, 'JPY');
      INSERT INTO actual_balance_snapshots (id, snapshot_date, snapshot_time) VALUES
        (10, '2026-06-30', '23:00'),
        (11, '2026-07-31', '23:59');
      INSERT INTO actual_balance_entries (id, snapshot_id, account_id, amount, currency) VALUES
        (100, 10, ${cashId}, 90, 'JPY'),
        (110, 11, ${cashId}, 75, 'JPY');
      INSERT INTO actual_balance_adjustments (actual_balance_entry_id, journal_entry_id)
        VALUES (100, 2), (110, 3);
    `);

    const refresh = () => DB.batch(buildActualBalanceAdjustmentRefreshStatements(DB));
    await refresh();
    expect(
      sqlite
        .query(
          "SELECT actual_balance_entry_id, amount FROM actual_balance_adjustments ORDER BY actual_balance_entry_id",
        )
        .all(),
    ).toEqual([
      { actual_balance_entry_id: 100, amount: 10 },
      { actual_balance_entry_id: 110, amount: -5 },
    ]);

    sqlite.exec(`
      INSERT INTO journal_entries (id, date, description) VALUES
        (6, '2026-06-10', 'Backdated cash expense');
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, currency) VALUES
        (6, ${expenseId}, 30, 0, 'JPY'),
        (6, ${cashId}, 0, 30, 'JPY');
      INSERT INTO actual_balance_snapshots (id, snapshot_date, snapshot_time)
        VALUES (12, '2026-06-30', '23:59');
      INSERT INTO actual_balance_entries (id, snapshot_id, account_id, amount, currency)
        VALUES (120, 12, ${cashId}, 85, 'JPY');
      INSERT INTO journal_entries (id, date, description)
        VALUES (7, '2026-06-30', 'Same-day adjustment');
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, currency) VALUES
        (7, ${cashId}, 0, 0, 'JPY'),
        (7, ${unknownId}, 0, 0, 'JPY');
      INSERT INTO actual_balance_adjustments (actual_balance_entry_id, journal_entry_id)
        VALUES (120, 7);
    `);

    await refresh();

    expect(
      sqlite
        .query(
          "SELECT actual_balance_entry_id, amount FROM actual_balance_adjustments ORDER BY actual_balance_entry_id",
        )
        .all(),
    ).toEqual([
      { actual_balance_entry_id: 100, amount: 0 },
      { actual_balance_entry_id: 110, amount: 0 },
      { actual_balance_entry_id: 120, amount: 35 },
    ]);
    expect(
      sqlite
        .query(
          "SELECT debit, credit FROM journal_lines WHERE journal_entry_id = 2 AND account_id = ?",
        )
        .get(cashId),
    ).toEqual({ debit: 0, credit: 0 });
  });

  test("keeps currency storage precision separate and signs liability targets in raw debit units", async () => {
    const { DB, sqlite } = newDatabase();
    const usdAssetId = Number(
      (
        sqlite
          .query(
            "INSERT INTO accounts (name, type, category) VALUES ('USD cash', 'asset', 'cash') RETURNING id",
          )
          .get() as { id: number }
      ).id,
    );
    const liabilityId = Number(
      (
        sqlite
          .query(
            "INSERT INTO accounts (name, type, category) VALUES ('Loan', 'liability', 'short_term_loan') RETURNING id",
          )
          .get() as { id: number }
      ).id,
    );
    const cryptoId = Number(
      (
        sqlite
          .query(
            "INSERT INTO accounts (name, type, category) VALUES ('BTC wallet', 'asset', 'crypto') RETURNING id",
          )
          .get() as { id: number }
      ).id,
    );
    const equityId = Number(
      (
        sqlite
          .query(
            "INSERT INTO accounts (name, type, category) VALUES ('Equity', 'equity', 'opening_balance') RETURNING id",
          )
          .get() as { id: number }
      ).id,
    );
    const unknownId = Number(
      (
        sqlite
          .query(
            "SELECT id FROM accounts WHERE name = '__system:unknown_funds__'",
          )
          .get() as { id: number }
      ).id,
    );
    sqlite.exec(`
      INSERT INTO journal_entries (id, date, description) VALUES
        (40, '2026-08-31', 'USD opening'),
        (41, '2026-08-31', 'Liability opening'),
        (42, '2026-08-31', 'Crypto opening'),
        (43, '2026-08-31', 'USD adjustment'),
        (44, '2026-08-31', 'Liability adjustment'),
        (45, '2026-08-31', 'Crypto adjustment');
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, currency) VALUES
        (40, ${usdAssetId}, 10001, 0, 'USD'),
        (40, ${equityId}, 0, 10001, 'USD'),
        (41, ${equityId}, 100000, 0, 'JPY'),
        (41, ${liabilityId}, 0, 100000, 'JPY'),
        (42, ${cryptoId}, 123456789, 0, 'BTC'),
        (42, ${equityId}, 0, 123456789, 'BTC'),
        (43, ${usdAssetId}, 0, 0, 'USD'),
        (43, ${unknownId}, 0, 0, 'USD'),
        (44, ${liabilityId}, 0, 0, 'JPY'),
        (44, ${unknownId}, 0, 0, 'JPY'),
        (45, ${cryptoId}, 0, 0, 'BTC'),
        (45, ${unknownId}, 0, 0, 'BTC');
      INSERT INTO actual_balance_snapshots (id, snapshot_date, snapshot_time)
        VALUES (40, '2026-08-31', '23:59');
      INSERT INTO actual_balance_entries (id, snapshot_id, account_id, amount, currency) VALUES
        (400, 40, ${usdAssetId}, 10002, 'USD'),
        (401, 40, ${liabilityId}, 90000, 'JPY'),
        (402, 40, ${cryptoId}, 123456790, 'BTC');
      INSERT INTO actual_balance_adjustments (actual_balance_entry_id, journal_entry_id)
        VALUES (400, 43), (401, 44), (402, 45);
    `);

    await DB.batch(buildActualBalanceAdjustmentRefreshStatements(DB));

    expect(
      sqlite
        .query(
          "SELECT actual_balance_entry_id, amount FROM actual_balance_adjustments ORDER BY actual_balance_entry_id",
        )
        .all(),
    ).toEqual([
      { actual_balance_entry_id: 400, amount: 1 },
      { actual_balance_entry_id: 401, amount: 10000 },
      { actual_balance_entry_id: 402, amount: 1 },
    ]);
  });

  test("rolls back a ledger mutation if a linked checkpoint no longer fits configured precision", async () => {
    const { DB, sqlite } = newDatabase();
    const cashId = Number(
      (
        sqlite
          .query(
            "INSERT INTO accounts (name, type, category) VALUES ('Legacy precision cash', 'asset', 'cash') RETURNING id",
          )
          .get() as { id: number }
      ).id,
    );
    const unknownId = Number(
      (
        sqlite
          .query("SELECT id FROM accounts WHERE name = '__system:unknown_funds__'")
          .get() as { id: number }
      ).id,
    );
    sqlite.exec(`
      INSERT INTO enabled_currencies (code, decimal_places) VALUES ('ZZY', 2)
        ON CONFLICT(code) DO UPDATE SET decimal_places = excluded.decimal_places;
      INSERT INTO journal_entries (id, date, description) VALUES
        (600, '2026-09-30', 'Legacy adjustment');
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, currency) VALUES
        (600, ${cashId}, 1234, 0, 'ZZY'),
        (600, ${unknownId}, 0, 1234, 'ZZY');
      INSERT INTO actual_balance_snapshots (id, snapshot_date)
        VALUES (60, '2026-09-30');
      INSERT INTO actual_balance_entries (id, snapshot_id, account_id, amount, currency)
        VALUES (600, 60, ${cashId}, 1234, 'ZZY');
      INSERT INTO actual_balance_adjustments
        (actual_balance_entry_id, journal_entry_id, amount, default_money_scale)
        VALUES (600, 600, 1234, 2);
      UPDATE enabled_currencies SET decimal_places = 0 WHERE code = 'ZZY';
    `);

    await expect(
      DB.batch([
        DB.prepare(
          "INSERT INTO journal_entries (date, description) VALUES ('2026-10-01', 'Backdated expense')",
        ),
        ...buildActualBalanceAdjustmentRefreshStatements(DB),
      ]),
    ).rejects.toThrow();

    expect(
      sqlite.query("SELECT COUNT(*) AS count FROM journal_entries").get(),
    ).toEqual({ count: 1 });
    expect(
      sqlite
        .query("SELECT amount FROM actual_balance_adjustments WHERE actual_balance_entry_id = 600")
        .get(),
    ).toEqual({ amount: 1234 });
    expect(
      sqlite
        .query("SELECT SUM(debit) AS debit, SUM(credit) AS credit FROM journal_lines WHERE journal_entry_id = 600")
        .get(),
    ).toEqual({ debit: 1234, credit: 1234 });
  });
});
