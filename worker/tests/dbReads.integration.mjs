import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";

// Use the explicit runner: it compiles actual route modules, starts an isolated
// nonpersistent workerd D1, and disposes it. No real local or remote DB is opened.
if (!process.env.DB_READ_ROUTES_MODULE) throw new Error("Run bun run test:db-reads from worker");
const { accountsRouter, budgetRouter, createDb, journalRouter, loadBudgetFundingHistory, reportsRouter } =
  await import(pathToFileURL(process.env.DB_READ_ROUTES_MODULE).href);
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
  async function measure(invoke, { allowZeroRows = false } = {}) {
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
    assert.ok(allowZeroRows ? rowsRead >= 0 : rowsRead > 0);
    return { body, rowsRead, queries: executed.length, sql: executed.map((read) => read.sql) };
  }
  return { measure };
}

async function profile(invoke, options) {
  return createReadProfiler().measure(invoke, options);
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

test("explicit P&L API retains full-period and dated totals", async () => {
  const report = (path) => profile((binding) => reportsRouter.request(path, {}, { DB: binding }));
  const all = await report("/pl");
  const dated = await report("/pl?from=2026-11-01&to=2026-11-15");
  assert.deepEqual(all.body, { income: 0, expense: 60_000, net_income: -60_000 });
  assert.deepEqual(dated.body, { income: 0, expense: 30_000, net_income: -30_000 });
  console.log(`P&L full-period API rows_read: ${all.rowsRead} (avoided when the UI issues no report request)`);
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

test("journal list preserves tag amounts without rereading journal lines", async () => {
  await executeSql(`INSERT INTO expense_tags(id,name) VALUES (1001,'Travel');
    INSERT INTO journal_entry_expense_tags(journal_entry_id,tag_id) VALUES (1,1001),(2,1001);
    INSERT INTO journal_entry_tag_amounts(journal_entry_id,currency,amount) VALUES (2,'JPY',35);
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES
      (1,1002,0,25,'JPY'),(1,1001,25,0,'JPY'),(1,1002,123,0,'USD'),(1,1001,0,123,'USD');`);
  try {
    const measured = await profile((binding) => journalRouter.request("/?as_of=2026-11-30", {}, { DB: binding }));
    assert.equal(measured.body.length, 600);
    const auto = measured.body.find((entry) => entry.id === 1);
    const manual = measured.body.find((entry) => entry.id === 2);
    assert.deepEqual(auto.expense_tags, [{ id: 1001, name: "Travel" }]);
    assert.equal(auto.tag_expense_mode, "auto");
    assert.deepEqual(auto.tag_expense_amounts, [
      { currency: "JPY", amount: 75 }, { currency: "USD", amount: 1.23 },
    ]);
    assert.equal(manual.tag_expense_mode, "manual");
    assert.deepEqual(manual.tag_expense_amounts, [{ currency: "JPY", amount: 35 }]);
    assert.ok(auto.lines.every((line) => !("account_type" in line)));

    const lineReads = measured.sql.filter((sql) => /\bfrom\s+"?journal_lines\b/i.test(sql));
    assert.equal(lineReads.filter((sql) => /"journal_lines"\."id"/.test(sql)).length, 12);
    assert.equal(measured.sql.some((sql) => /json_each.*join journal_lines/is.test(sql)), false);
    const legacyRead = await DB.prepare(`SELECT jl.journal_entry_id, jl.account_id, a.type AS account_type,
        jl.debit, jl.credit, jl.currency
      FROM json_each(?) requested
      JOIN journal_lines jl ON jl.journal_entry_id=requested.value
      JOIN accounts a ON a.id=jl.account_id`)
      .bind(JSON.stringify(measured.body.map((entry) => entry.id))).all();
    assertReadCounter(legacyRead);
    assert.equal(legacyRead.results.length, 1204);
    assert.ok(legacyRead.meta.rows_read >= 3000, "the removed duplicate scan must be material on this fixture");
    assert.ok(measured.rowsRead <= 15_000, `journal route read ${measured.rowsRead} rows`);
    console.log(`journal route rows_read: ${measured.rowsRead}; eliminated tag-line lookup: ${legacyRead.meta.rows_read}`);
  } finally {
    await executeSql(`DELETE FROM journal_entry_tag_amounts WHERE journal_entry_id=2;
      DELETE FROM journal_entry_expense_tags WHERE tag_id=1001;
      DELETE FROM expense_tags WHERE id=1001;
      DELETE FROM journal_lines WHERE journal_entry_id=1 AND (credit=25 OR debit=25 OR currency='USD');`);
  }
});

const fundingHistoryColumns = `f.journal_entry_id, f.budget_category_id, f.kind, f.effect,
  f.amount, e.date, f.created_at, source.date AS source_date, source.created_at AS source_created_at`;
const fundingSourceJoin = "LEFT JOIN journal_entries source ON source.id = f.source_journal_entry_id";

async function originalFundingHistory(currency, firstMonth, periodEnd) {
  const oldest = await DB.prepare(`SELECT MIN(substr(e.date, 1, 7)) AS month
    FROM budget_funding_allocations f JOIN journal_entries e ON e.id = f.journal_entry_id
    WHERE f.currency = ?`).bind(currency).all();
  const month = oldest.results[0].month;
  const start = month && month < firstMonth ? month : firstMonth;
  const history = await DB.prepare(`SELECT ${fundingHistoryColumns}
    FROM budget_funding_allocations f JOIN journal_entries e ON e.id = f.journal_entry_id
    ${fundingSourceJoin} WHERE f.currency = ? AND e.date >= ? AND e.date <= ?`)
    .bind(currency, start + "-01", periodEnd).all();
  return { start, history: history.results, rowsRead: oldest.meta.rows_read + history.meta.rows_read };
}

function comparableFunding(rows) {
  return rows.map(row => JSON.stringify(row)).sort();
}

test("budget summary carries earlier funding forward and respects the settlement date", async () => {
  await executeSql(`INSERT INTO budget_categories(id,name) VALUES (1002,'Loans only');
    INSERT INTO journal_entries(id,date,description) VALUES
      (8001,'2024-01-01','Borrowing'),(8002,'2024-03-20','Repayment'),(8003,'2024-04-01','Later borrowing');
    INSERT INTO budget_funding_allocations(journal_entry_id,budget_category_id,kind,amount,currency,source_journal_entry_id) VALUES
      (8001,1002,'borrow',150,'USD',NULL),(8002,1002,'repay',25,'USD',8001),(8003,1002,'borrow',100,'USD',NULL);`);
  try {
    const request = (asOf) => budgetRouter.request(`/summary?year_month=2024-03&as_of=${asOf}&currency=USD`, {}, { DB });
    const category = async (date) => {
      const response = await request(date);
      assert.equal(response.status, 200);
      return (await response.json()).categories.find(({ category }) => category.id === 1002);
    };
    const early = await category("2024-03-19");
    const late = await category("2024-03-20");
    assert.equal(early.available, 1.5);
    assert.equal(late.carryover, 1.5);
    assert.equal(late.available, 1.25);
    assert.equal(late.funding_adjustment, 1.25);
  } finally {
    await executeSql("DELETE FROM journal_entries WHERE id BETWEEN 8001 AND 8003; DELETE FROM budget_categories WHERE id=1002;");
  }
});

test("funding history matches both legacy reads with bounded rows across periods and densities", async () => {
  const startId = 10_000;
  const phases = [
    { name: "small/sparse", entries: 300, from: 0, dataWhere: "id % 53 = 0" },
    { name: "large/sparse", entries: 3600, from: 300, dataWhere: "id % 53 = 0" },
    { name: "large/dense", entries: 3600, from: 3600, dataWhere: "id % 53 <> 0" },
  ];
  const cases = [
    ["JPY", "2023-12", "2023-12-31"],
    ["JPY", "2024-01", "2024-01-31"],
    ["JPY", "2025-12", "2025-12-31"],
    ["USD", "2025-12", "2025-12-31"],
    ["EUR", "2025-12", "2025-12-31"],
  ];
  try {
    for (const phase of phases) {
      const {entries, from, dataWhere} = phase;
      if (entries > from) {
        await executeSql(`WITH RECURSIVE n(i) AS (VALUES(${from}) UNION ALL SELECT i+1 FROM n WHERE i+1<${entries})
          INSERT INTO journal_entries(id,date,description,created_at) SELECT i+${startId},date('2024-01-01','+'||(i/4)||' days'),'Funding test','2024-01-01 10:00:00' FROM n;`);
      }
      const fromId = phase.name === "large/dense" ? startId : startId + from;
      await executeSql(`INSERT INTO budget_funding_allocations(journal_entry_id,budget_category_id,kind,effect,amount,currency,source_journal_entry_id)
        SELECT id,CASE WHEN id%7=0 THEN NULL ELSE 1001 END,CASE WHEN id%2=0 THEN 'lend' ELSE 'collect' END,
        CASE WHEN id%5=0 THEN 'component_only' ELSE 'apply' END,100+(id%19),
        CASE WHEN id%4=0 THEN 'USD' ELSE 'JPY' END,CASE WHEN id%2=1 AND id>${startId} THEN id-1 END
        FROM journal_entries WHERE id>=${fromId} AND id<${startId + entries} AND ${dataWhere};`);
      for (const [currency, firstMonth, periodEnd] of cases) {
        const baseline = await originalFundingHistory(currency, firstMonth, periodEnd);
        const result = await profile(async (binding) => Response.json(
          await loadBudgetFundingHistory(createDb({ DB: binding }), currency, periodEnd),
        ), { allowZeroRows: true });
        const oldest = result.body[0]?.date.slice(0, 7);
        const start = oldest && oldest < firstMonth ? oldest : firstMonth;
        assert.equal(start, baseline.start);
        assert.deepEqual(comparableFunding(result.body), comparableFunding(baseline.history));
        assert.equal(result.queries, 1);
        assert.ok(result.rowsRead <= baseline.rowsRead, `${phase.name} ${currency} through ${periodEnd} regressed`);
        if (currency === "JPY" && periodEnd === "2025-12-31") {
          const ceiling = phase.name === "large/dense" ? 0.65 : 0.1;
          assert.ok(result.rowsRead <= baseline.rowsRead * ceiling, `wide ${phase.name} range savings regressed`);
        }
        console.log(`funding history ${phase.name} ${currency} through ${periodEnd}: ${baseline.rowsRead} -> ${result.rowsRead}`);
      }
    }
  } finally {
    await DB.prepare("DELETE FROM journal_entries WHERE id >= ?").bind(startId).run();
  }
});
