import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";

// Use the explicit runner: it compiles actual route modules, starts an isolated
// nonpersistent workerd D1, and disposes it. No real local or remote DB is opened.
if (!process.env.DB_READ_ROUTES_MODULE) throw new Error("Run bun run test:db-reads from worker");
const { accountsRouter, budgetRouter } = await import(pathToFileURL(process.env.DB_READ_ROUTES_MODULE).href);
let platform;
let DB;
let beforeIndexes;
let unindexedLogRowsRead;
const migrationDirectory = new URL("../drizzle/", import.meta.url);
const indexMigration = "0024_read_query_indexes.sql";

async function executeSql(sql) {
  const statements = unstable_splitSqlQuery(sql);
  for (let offset = 0; offset < statements.length; offset += 50) {
    await DB.batch(statements.slice(offset, offset + 50).map((statement) => DB.prepare(statement)));
  }
}

before(async () => {
  platform = await getPlatformProxy({ configPath: process.env.DB_READ_CONFIG, persist: false });
  DB = platform.env.DB;
  for (const name of readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql")).sort()) {
    if (name === indexMigration) continue;
    await executeSql(readFileSync(new URL(name, migrationDirectory), "utf8"));
  }
  await executeSql(`INSERT INTO enabled_currencies(code,decimal_places) VALUES('JPY',0),('USD',2);
    INSERT INTO accounts(id,name,type,category) VALUES(1001,'Bank','asset','cash'),(1002,'Expense','expense','other'),(1003,'Opening','equity','opening_balance');
    INSERT INTO budget_categories(id,name) VALUES(1001,'Living');
    INSERT INTO budget_category_accounts(budget_category_id,account_id,ratio) VALUES(1001,1002,100);
    WITH RECURSIVE n(id) AS (VALUES(1) UNION ALL SELECT id+1 FROM n WHERE id<600)
    INSERT INTO journal_entries(id,date,description,created_at) SELECT id,CASE WHEN id%2=0 THEN '2026-11-05' ELSE '2026-11-25' END,'Synthetic expense','2026-11-01 09:00:00' FROM n;
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) SELECT id,1002,100,0,'JPY' FROM journal_entries;
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) SELECT id,1001,0,100,'JPY' FROM journal_entries;
    INSERT INTO journal_entry_budget_allocations(journal_entry_id,budget_category_id,amount,currency,source) SELECT id,1001,-100,'JPY','manual' FROM journal_entries;
    INSERT INTO budget_adjustment_logs(journal_entry_id,budget_category_id,year_month,amount,currency,date,adjustment_type) SELECT id,1001,'2026-11',10,'JPY',date,'allocation' FROM journal_entries;
    INSERT INTO depreciation_schedules(id,source_journal_entry_id,asset_account_id,expense_account_id,total_amount,months,start_date,description) VALUES(1001,1,1001,1002,30000,300,'2026-11-01','Synthetic schedule');
    INSERT INTO depreciation_entries(schedule_id,journal_entry_id,month_number) SELECT 1001,id,id/2 FROM journal_entries WHERE id%2=0;`);
  const ids = Array.from({ length: 38 }, (_, index) => index + 1);
  const query = `SELECT journal_entry_id,account_id,debit,credit,currency FROM journal_lines WHERE journal_entry_id IN (${ids.map(() => "?").join(",")}) AND currency=?`;
  beforeIndexes = { query, parameters: [...ids, "JPY"], result: await DB.prepare(query).bind(...ids, "JPY").all() };
  unindexedLogRowsRead = (await DB.prepare(`SELECT * FROM budget_adjustment_logs WHERE journal_entry_id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all()).meta.rows_read;
  await executeSql(readFileSync(new URL(indexMigration, migrationDirectory), "utf8"));
});

after(async () => { await platform?.dispose(); });

function assertReadCounter(result) {
  assert.equal(result.success, true);
  assert.equal(typeof result.meta.rows_read, "number");
  assert.ok(result.meta.rows_read > 0, "workerd must supply a nonzero real row-read counter");
  assert.equal(result.meta.rows_written, 0);
}

// Routes use all/first/raw. Record executions, then replay the unchanged SELECTs
// with all() to collect their workerd counters (raw/first omit meta). Replays are
// outside the request and excluded from the recorded count; fixtures never change.
function createReadProfiler() {
  const reads = [];
  const wrap = (statement, sql, parameters = []) => new Proxy(statement, {
    get(target, property) {
      if (property === "bind") return (...values) => wrap(target.bind(...values), sql, values);
      if (["all", "first", "raw", "run"].includes(property)) return (...args) => {
        assert.match(sql, /^\s*(SELECT|WITH)\b/i, "profiling is for read-only routes");
        reads.push({ sql, parameters });
        return target[property](...args);
      };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const binding = new Proxy(DB, {
    get(target, property) {
      if (property === "prepare") return (sql) => wrap(target.prepare(sql), sql);
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  async function measure(invoke) {
    const start = reads.length;
    const response = await invoke(binding);
    assert.equal(response.status, 200);
    const body = await response.json();
    const executed = reads.slice(start);
    let rowsRead = 0;
    for (const { sql, parameters } of executed) {
      const result = await DB.prepare(sql).bind(...parameters).all();
      assert.equal(result.success, true);
      assert.equal(typeof result.meta.rows_read, "number");
      assert.equal(result.meta.rows_written, 0);
      rowsRead += result.meta.rows_read;
    }
    assert.ok(rowsRead > 0);
    return { body, rowsRead, queries: executed.length };
  }
  return { measure };
}

async function profile(invoke) {
  return createReadProfiler().measure(invoke);
}

test("entry/currency lookup reads a bounded subset rather than all same-currency lines", async () => {
  const { query, parameters, result: baseline } = beforeIndexes;
  const indexed = await DB.prepare(query).bind(...parameters).all();
  assertReadCounter(baseline);
  assertReadCounter(indexed);
  const sorted = (rows) => [...rows].sort((a, b) => a.journal_entry_id - b.journal_entry_id || a.account_id - b.account_id);
  assert.deepEqual(sorted(indexed.results), sorted(baseline.results));
  assert.equal(indexed.results.length, 76);
  assert.ok(indexed.meta.rows_read <= 250, `indexed lookup read ${indexed.meta.rows_read} rows`);
  assert.ok(indexed.meta.rows_read < baseline.meta.rows_read / 4);
  console.log(`line lookup rows_read: ${baseline.meta.rows_read} -> ${indexed.meta.rows_read}`);
  try {
    await executeSql(`WITH RECURSIVE n(id) AS (VALUES(1) UNION ALL SELECT id+1 FROM n WHERE id<2000)
      INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) SELECT 600,1001,1,0,'JPY' FROM n;`);
    const grown = await DB.prepare(query).bind(...parameters).all();
    assertReadCounter(grown);
    assert.deepEqual(sorted(grown.results), sorted(indexed.results));
    assert.ok(grown.meta.rows_read <= indexed.meta.rows_read + 10, "unrelated same-currency lines must not increase lookup work");
  } finally {
    await DB.prepare("DELETE FROM journal_lines WHERE id>1200").run();
  }
});

test("journal log lookup keeps reads bounded across many 50-entry chunks", async () => {
  let rowsRead = 0;
  for (let start = 1; start <= 600; start += 50) {
    const ids = Array.from({ length: 50 }, (_, offset) => start + offset);
    const result = await DB.prepare(`SELECT * FROM budget_adjustment_logs WHERE journal_entry_id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all();
    assertReadCounter(result);
    assert.equal(result.results.length, 50);
    rowsRead += result.meta.rows_read;
  }
  assert.ok(rowsRead <= 1900, `chunked log reads grew to ${rowsRead}`);
  assert.ok(rowsRead < unindexedLogRowsRead * 12 * 0.35);
  console.log(`12 journal log chunks rows_read: ${rowsRead}`);
});

test("depreciation lookup does not scan every schedule entry", async () => {
  const result = await DB.prepare("SELECT journal_entry_id,schedule_id FROM depreciation_entries WHERE journal_entry_id IN (2,4,6)").all();
  assertReadCounter(result);
  assert.equal(result.results.length, 3);
  assert.ok(result.meta.rows_read <= 12, `depreciation lookup read ${result.meta.rows_read} rows`);
});

test("actual budget pair route preserves responses and reads less than two summaries", async () => {
  const request = (path) => profile((binding) => budgetRouter.request(path, {}, { DB: binding }));
  const today = await request("/summary?year_month=2026-11&as_of=2026-11-10&currency=JPY");
  const total = await request("/summary?year_month=2026-11&currency=JPY");
  const pair = await request("/summary-pair?year_month=2026-11&as_of=2026-11-10&currency=JPY");
  assert.deepEqual(pair.body, { today: today.body, total: total.body });
  assert.notEqual(today.body.total_spent, total.body.total_spent);
  assert.ok(pair.queries < (today.queries + total.queries) * 0.65);
  assert.ok(pair.rowsRead < (today.rowsRead + total.rowsRead) * 0.65);
  console.log(`budget pair rows_read: ${today.rowsRead + total.rowsRead} -> ${pair.rowsRead}; queries: ${today.queries + total.queries} -> ${pair.queries}`);
});

test("actual accounts route eliminates per-line account reads with equal balances", async () => {
  const old = await DB.prepare(`SELECT jl.account_id,jl.currency,CASE WHEN a.type IN ('asset','expense') THEN SUM(jl.debit)-SUM(jl.credit) ELSE SUM(jl.credit)-SUM(jl.debit) END AS balance FROM journal_lines jl JOIN journal_entries je ON jl.journal_entry_id=je.id JOIN accounts a ON a.id=jl.account_id WHERE je.date<=? GROUP BY jl.account_id,jl.currency`).bind("2026-11-30").all();
  assertReadCounter(old);
  const measured = await profile((binding) => accountsRouter.request("/?as_of=2026-11-30", {}, { DB: binding }));
  for (const balance of old.results) {
    const account = measured.body.find((account) => account.id === balance.account_id);
    assert.equal(account.balances[balance.currency], balance.balance);
  }
  // Include every SELECT performed by the route, not only the aggregate.
  assert.ok(measured.rowsRead < old.meta.rows_read * 0.8);
  console.log(`account aggregate baseline rows_read: ${old.meta.rows_read}; optimized whole route: ${measured.rowsRead}`);
});

test("consecutive adjustment amounts reuse history while save still verifies fresh DB state", async () => {
  const profiler = createReadProfiler();
  const input = (amount) => ({ date: "2026-11-10", currency: "JPY", note: null,
    adjustments: [{ budget_category_id: 1001, adhoc_delta: amount }] });
  const request = (binding, path, body) => budgetRouter.request(path, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }, { DB: binding });
  const numerical = ({ token, ...body }) => body;
  const cold = await profiler.measure((binding) => request(binding, "/allocations/preview", input(1)));
  const warmReads = [];
  let last;
  for (const amount of [2, 30, -30, 100]) {
    last = await profiler.measure((binding) => request(binding, "/allocations/preview", input(amount)));
    const fresh = await profile((binding) => request(binding, "/allocations/preview", input(amount)));
    assert.deepEqual(numerical(last.body), numerical(fresh.body));
    assert.ok(last.rowsRead <= 20, `warm amount edit read ${last.rowsRead} rows`);
    assert.ok(last.rowsRead < cold.rowsRead / 20);
    warmReads.push(last.rowsRead);
  }
  await DB.prepare("UPDATE budget_adjustment_logs SET amount=amount+1 WHERE journal_entry_id=2").run();
  const refreshed = await profiler.measure((binding) => request(binding, "/allocations/preview", input(100)));
  assert.ok(refreshed.rowsRead > 1000, "changed DB revision must refresh cached history");
  assert.notDeepEqual(numerical(refreshed.body), numerical(last.body));
  const stale = await request(DB, "/allocations/batch", { ...input(100), preview_token: last.body.token });
  assert.equal(stale.status, 409);
  // Save bypasses the cross-request cache. Its own existing regression suite
  // also verifies guarded atomic writes, replay rejection and rollback.
  const saved = await request(DB, "/allocations/batch", { ...input(100), note: "Edited locally without preview", preview_token: refreshed.body.token });
  assert.equal(saved.status, 200);
  const note = await DB.prepare("SELECT note FROM budget_adjustment_logs WHERE note=?").bind("Edited locally without preview").first("note");
  assert.equal(note, "Edited locally without preview");
  console.log(`adjustment preview rows_read: initial ${cold.rowsRead}; consecutive edits ${warmReads.join(", ")}; revision refresh ${refreshed.rowsRead}`);
});
