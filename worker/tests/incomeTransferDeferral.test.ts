import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { budgetRouter } from "../src/routes/budget";
import { incomeTransferRequirementsRouter } from "../src/routes/incomeTransferRequirements";
import { journalRouter } from "../src/routes/journal";
import { createIncomeBudgetScopeFixture } from "./helpers/incomeBudgetScopeFixture";

const fixtures: ReturnType<typeof createIncomeBudgetScopeFixture>[] = [];

function fixture() {
  const result = createIncomeBudgetScopeFixture();
  fixtures.push(result);
  return result;
}

function jsonRequest(
  router: typeof budgetRouter | typeof journalRouter | typeof incomeTransferRequirementsRouter,
  database: ReturnType<typeof createIncomeBudgetScopeFixture>,
  path: string,
  method: "GET" | "POST" | "PUT" | "PATCH",
  body?: unknown,
) {
  return router.request(
    path,
    {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    { DB: database.DB },
  );
}

function incomeEntry(amount = 5000, destinations: Record<string, unknown>[] = []) {
  return {
    date: "2026-10-20",
    description: "Unexpected transfer income",
    lines: [
      { account_id: 1001, debit: amount, credit: 0, currency: "JPY" },
      { account_id: 1005, debit: 0, credit: amount, currency: "JPY" },
    ],
    income_budget_allocations: [
      { budget_category_id: 1001, amount, currency: "JPY" },
    ],
    income_transfer_destinations: destinations,
  };
}

function destination(amount: number, is_deferred?: boolean | null) {
  return {
    budget_category_id: 1001,
    from_account_id: 1001,
    to_account_id: 1007,
    amount,
    currency: "JPY",
    ...(is_deferred === undefined ? {} : { is_deferred }),
  };
}

async function createIncome(
  database: ReturnType<typeof fixture>,
  amount = 5000,
  destinations = [destination(amount)],
) {
  const response = await jsonRequest(journalRouter, database, "/", "POST", incomeEntry(amount, destinations));
  expect(response.status).toBe(201);
  return (await response.json() as { id: number }).id;
}

afterEach(() => fixtures.splice(0).forEach((database) => database.close()));

describe("generic income transfer deferral", () => {
  test("migrates valid legacy interest thresholds without changing the legacy setting", () => {
    const sqlite = new Database(":memory:");
    try {
      sqlite.exec("PRAGMA foreign_keys = ON");
      const migrationDirectory = join(import.meta.dir, "../drizzle");
      const migrations = readdirSync(migrationDirectory)
        .filter((name) => name.endsWith(".sql") && !name.startsWith("0018_"))
        .sort();
      for (const name of migrations) {
        sqlite.exec(readFileSync(join(migrationDirectory, name), "utf8"));
      }
      const legacy = JSON.stringify({
        income_account_id: 1005,
        budget_category_id: 1001,
        transfer_thresholds: { JPY: 1000, USD: 0.25 },
      });
      sqlite.prepare(
        "UPDATE budget_settings SET interest_income_rule = ? WHERE id = 1",
      ).run(legacy);
      const migrationPath = join(migrationDirectory, "0018_income_transfer_scheduling.sql");
      expect(existsSync(migrationPath), "generic transfer scheduling migration should exist").toBe(true);
      sqlite.exec(readFileSync(migrationPath, "utf8"));

      const settings = sqlite.query(
        "SELECT interest_income_rule, income_transfer_settings FROM budget_settings WHERE id = 1",
      ).get() as { interest_income_rule: string; income_transfer_settings: string };
      expect(JSON.parse(settings.interest_income_rule)).toEqual(JSON.parse(legacy));
      expect(JSON.parse(settings.income_transfer_settings)).toEqual({
        transfer_thresholds: { JPY: 1000, USD: 0.25 },
      });
    } finally {
      sqlite.close();
    }
  });

  test("persists generic thresholds independently from legacy interest settings and validates currency precision", async () => {
    const database = fixture();
    database.sqlite.exec("INSERT INTO enabled_currencies(code, decimal_places) VALUES ('USD', 2)");

    const initial = await jsonRequest(budgetRouter, database, "/settings", "GET");
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({ income_transfer_settings: null });

    const legacyRule = {
      income_account_id: 1005,
      budget_category_id: 1001,
      transfer_thresholds: { JPY: 300 },
    };
    const genericSettings = { transfer_thresholds: { jpy: 1000, usd: 0.25 } };
    const saved = await jsonRequest(budgetRouter, database, "/settings", "PATCH", {
      interest_income_rule: legacyRule,
      income_transfer_settings: genericSettings,
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      interest_income_rule: legacyRule,
      income_transfer_settings: { transfer_thresholds: { JPY: 1000, USD: 0.25 } },
    });

    const clearLegacy = await jsonRequest(budgetRouter, database, "/settings", "PATCH", {
      interest_income_rule: null,
    });
    expect(await clearLegacy.json()).toMatchObject({
      interest_income_rule: null,
      income_transfer_settings: { transfer_thresholds: { JPY: 1000, USD: 0.25 } },
    });

    const invalidSettings = [
      {},
      { transfer_thresholds: [] },
      { transfer_thresholds: { GBP: 1 } },
      { transfer_thresholds: { JPY: -1 } },
      { transfer_thresholds: { JPY: 0.5 } },
      { transfer_thresholds: { USD: 0.001 } },
    ];
    for (const income_transfer_settings of invalidSettings) {
      const response = await jsonRequest(budgetRouter, database, "/settings", "PATCH", {
        income_transfer_settings,
      });
      expect(response.status, JSON.stringify(income_transfer_settings)).toBe(400);
    }

    const cleared = await jsonRequest(budgetRouter, database, "/settings", "PATCH", {
      income_transfer_settings: null,
    });
    expect(await cleared.json()).toMatchObject({ income_transfer_settings: null });
  });

  test("stores manual deferral for non-interest income and exposes it in journal and task APIs", async () => {
    const database = fixture();
    const id = await createIncome(database, 5000, [destination(5000, true)]);

    const journalResponse = await jsonRequest(journalRouter, database, `/${id}`, "GET");
    expect(journalResponse.status).toBe(200);
    expect(await journalResponse.json()).toMatchObject({
      income_transfer_requirements: [{ amount: 5000, is_deferred: true }],
    });

    const tasksResponse = await jsonRequest(incomeTransferRequirementsRouter, database, "/?status=pending", "GET");
    expect(await tasksResponse.json()).toMatchObject({
      requirements: [{ amount: 5000, is_deferred: true }],
      groups: [{ requirements: [{ is_deferred: true }] }],
    });

    const preview = await jsonRequest(incomeTransferRequirementsRouter, database, "/squash-preview", "GET");
    expect(await preview.json()).toMatchObject({ transfers: [{ amount: 5000 }] });
    expect(database.sqlite.query("SELECT COUNT(*) AS count FROM journal_entries").get()).toEqual({ count: 2 });
  });

  test("manual deferral toggles every pending row in its route group without changing balances", async () => {
    const database = fixture();
    const id = await createIncome(database, 5000, [destination(2000), destination(3000)]);
    const requirementIds = database.sqlite.query(
      "SELECT id FROM income_transfer_requirements WHERE source_income_journal_entry_id = ? ORDER BY id",
    ).all(id) as { id: number }[];
    const beforeLines = database.sqlite.query(
      "SELECT account_id, SUM(debit-credit) AS balance FROM journal_lines GROUP BY account_id ORDER BY account_id",
    ).all();
    const beforeEntries = database.sqlite.query("SELECT COUNT(*) AS count FROM journal_entries").get();
    expect(database.sqlite.query("SELECT is_deferred FROM income_transfer_requirements ORDER BY id").all()).toEqual([
      { is_deferred: null },
      { is_deferred: null },
    ]);
    const automaticTasks = await jsonRequest(incomeTransferRequirementsRouter, database, "/?status=pending", "GET");
    expect(await automaticTasks.json()).toMatchObject({
      requirements: [{ is_deferred: null }, { is_deferred: null }],
    });

    const deferred = await jsonRequest(incomeTransferRequirementsRouter, database, `/${requirementIds[0]!.id}/defer`, "PATCH", { is_deferred: true });
    expect(deferred.status).toBe(200);
    expect(await deferred.json()).toMatchObject({ requirement_ids: requirementIds.map((row) => row.id), is_deferred: true });
    expect(database.sqlite.query("SELECT is_deferred FROM income_transfer_requirements ORDER BY id").all()).toEqual([
      { is_deferred: 1 },
      { is_deferred: 1 },
    ]);
    expect(database.sqlite.query(
      "SELECT account_id, SUM(debit-credit) AS balance FROM journal_lines GROUP BY account_id ORDER BY account_id",
    ).all()).toEqual(beforeLines);
    expect(database.sqlite.query("SELECT COUNT(*) AS count FROM journal_entries").get()).toEqual(beforeEntries);

    const actionable = await jsonRequest(incomeTransferRequirementsRouter, database, `/${requirementIds[1]!.id}/defer`, "PATCH", { is_deferred: false });
    expect(actionable.status).toBe(200);
    expect(database.sqlite.query("SELECT is_deferred FROM income_transfer_requirements ORDER BY id").all()).toEqual([
      { is_deferred: 0 },
      { is_deferred: 0 },
    ]);
    const explicitlyActionableTasks = await jsonRequest(incomeTransferRequirementsRouter, database, "/?status=pending", "GET");
    expect(await explicitlyActionableTasks.json()).toMatchObject({
      requirements: [{ is_deferred: false }, { is_deferred: false }],
    });
  });

  test("PUT preserves old deferral when omitted and honors an explicit false", async () => {
    const database = fixture();
    const id = await createIncome(database, 5000, [destination(5000, true)]);

    const omitted = incomeEntry(5000, [destination(5000)]);
    const preserve = await jsonRequest(journalRouter, database, `/${id}`, "PUT", omitted);
    expect(preserve.status).toBe(200);
    expect(database.sqlite.query("SELECT is_deferred FROM income_transfer_requirements WHERE source_income_journal_entry_id = ?").get(id)).toEqual({ is_deferred: 1 });

    const explicitFalse = incomeEntry(5000, [destination(5000, false)]);
    const clear = await jsonRequest(journalRouter, database, `/${id}`, "PUT", explicitFalse);
    expect(clear.status).toBe(200);
    expect(database.sqlite.query("SELECT is_deferred FROM income_transfer_requirements WHERE source_income_journal_entry_id = ?").get(id)).toEqual({ is_deferred: 0 });

    const omittedAfterFalse = await jsonRequest(journalRouter, database, `/${id}`, "PUT", incomeEntry(5000, [destination(5000)]));
    expect(omittedAfterFalse.status).toBe(200);
    expect(database.sqlite.query("SELECT is_deferred FROM income_transfer_requirements WHERE source_income_journal_entry_id = ?").get(id)).toEqual({ is_deferred: 0 });

    const resetAutomatic = await jsonRequest(journalRouter, database, `/${id}`, "PUT", incomeEntry(5000, [destination(5000, null)]));
    expect(resetAutomatic.status).toBe(200);
    expect(database.sqlite.query("SELECT is_deferred FROM income_transfer_requirements WHERE source_income_journal_entry_id = ?").get(id)).toEqual({ is_deferred: null });
  });

  test("defer endpoint returns 404 for missing and 409 for completed requirements", async () => {
    const database = fixture();
    const missing = await jsonRequest(incomeTransferRequirementsRouter, database, "/9999/defer", "PATCH", { is_deferred: true });
    expect(missing.status).toBe(404);

    const id = await createIncome(database);
    const requirementId = (database.sqlite.query("SELECT id FROM income_transfer_requirements WHERE source_income_journal_entry_id = ?").get(id) as { id: number }).id;
    database.sqlite.exec("UPDATE income_transfer_requirements SET completion_source='linked', transfer_journal_entry_id=9000, completed_at='2026-10-20T00:00:00.000Z' WHERE id=" + requirementId);

    const completed = await jsonRequest(incomeTransferRequirementsRouter, database, `/${requirementId}/defer`, "PATCH", { is_deferred: true });
    expect(completed.status).toBe(409);
    expect(await completed.json()).toMatchObject({ error: "income_transfer_completed_conflict" });
  });
});
