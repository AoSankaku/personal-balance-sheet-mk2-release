import { afterEach, expect, test } from "bun:test";
import { depreciationRouter } from "../src/routes/depreciation";
import type { DepreciationBudgetSettings } from "../../shared/depreciationBudget";
import { createTestD1 } from "./helpers/d1";

type TestDatabase = ReturnType<typeof createTestD1>;
type InstrumentedDatabase = TestDatabase & {
  calls: { sql: string; parameters: unknown[]; operation: string }[];
  env: { DB: D1Database };
};

const handles: TestDatabase[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});

function fixture(options: { months?: number; maxParameters?: number } = {}) {
  const handle = createTestD1(options.maxParameters === undefined ? {} : { maxParameters: options.maxParameters });
  handles.push(handle);
  const months = options.months ?? 30;
  const startDate = months > 30 ? "2016-01-01" : "2024-05-01";
  const monthDate = (offset: number) => {
    const date = new Date(`${startDate}T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + offset);
    return date.toISOString().slice(0, 10);
  };
  handle.sqlite.exec(`INSERT INTO accounts(id,name,type,category,include_in_allocatable,is_depreciable,deduct_from_budget) VALUES
    (1001,'Bank','asset','cash',1,0,0),(1002,'Equipment','asset','property',0,1,0),
    (1003,'Depreciation expense','expense','other',1,0,0),(1004,'Opening balance','equity','opening_balance',1,0,0);
    INSERT INTO budget_categories(id,name) VALUES(1001,'Purchase reserve'),(1002,'Monthly source');
    INSERT INTO journal_entries(id,date,description,created_at) VALUES(900,'2016-10-31','Opening','2016-10-31 08:00:00');
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES
      (900,1001,1000000,0,'JPY'),(900,1004,0,1000000,'JPY');`);
  const openingMonth = months > 30 ? "2015-12" : "2024-04";
  const openingDate = `${openingMonth}-31`;
  handle.sqlite.query(`INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,currency,date,created_at,adjustment_type) VALUES
    (1001,?,300000,'JPY',? ,?,'allocation'),(1002,?,100000,'JPY',? ,?,'allocation')`)
    .run(openingMonth, openingDate, `${openingDate} 09:00:00`, openingMonth, openingDate, `${openingDate} 09:00:00`);
  handle.sqlite.query(`INSERT INTO journal_entries(id,date,description,created_at) VALUES(901,?,'Purchase',?)`)
    .run(startDate, `${startDate} 08:00:00`);
  handle.sqlite.exec(`INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES
    (901,1002,300000,0,'JPY'),(901,1001,0,300000,'JPY')`);
  const scheduleId = (handle.sqlite.query(`INSERT INTO depreciation_schedules
    (source_journal_entry_id,asset_account_id,expense_account_id,total_amount,months,start_date,description,budget_currency)
    VALUES(901,1002,1003,300000,?,?,'Equipment','JPY') RETURNING id`).get(months, startDate) as { id: number }).id;
  for (let index = 0; index < months; index += 1) {
    const date = monthDate(index);
    const id = 902 + index;
    const amount = Math.floor(300000 / months) + (index < 300000 % months ? 1 : 0);
    handle.sqlite.query("INSERT INTO journal_entries(id,date,description,created_at) VALUES(?,?,'Depreciation',?)")
      .run(id, date, `${date} 10:00:00`);
    handle.sqlite.query(`INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency)
      VALUES(?,1003,?,0,'JPY'),(?,1002,0,?,'JPY')`).run(id, amount, id, amount);
    handle.sqlite.query("INSERT INTO depreciation_entries(schedule_id,journal_entry_id,month_number) VALUES(?,?,?)")
      .run(scheduleId, id, index + 1);
  }
  const decisions: NonNullable<DepreciationBudgetSettings["reset_decisions"]> = [];
  const resetCount = months > 30 ? 1 : 6;
  for (let index = 0; index < resetCount; index += 1) {
    const resetDate = monthDate(Math.floor((index + 1) * (months - 1) / (resetCount + 1))).slice(0, 7) + "-15";
    const row = handle.sqlite.query(`INSERT INTO budget_adjustment_logs
      (budget_category_id,year_month,amount,currency,date,created_at,adjustment_type,reset_scope)
      VALUES(1002,?,0,'JPY',?,?,'reset','category') RETURNING id`)
      .get(resetDate.slice(0, 7), resetDate, `${resetDate} 12:00:00`) as { id: number };
    decisions.push({ reset_log_id: row.id, action: "continue" });
  }
  return { handle, scheduleId, decisions };
}

function instrument(handle: TestDatabase, options: { bumpRevisionAfterFirstRead?: boolean } = {}): InstrumentedDatabase {
  const calls: InstrumentedDatabase["calls"] = [];
  let revisionReads = 0;
  const wrap = (statement: any): any => new Proxy(statement, {
    get(target, key) {
      if (key === "bind") return (...parameters: unknown[]) => wrap(target.bind(...parameters));
      if (["all", "first", "raw", "run"].includes(String(key))) return async (...args: unknown[]) => {
        calls.push({ sql: target.query, parameters: [...target.parameters], operation: String(key) });
        const result = await target[key](...args);
        if (String(key) === "first" && /FROM\s+depreciation_budget_state/i.test(target.query)) {
          revisionReads += 1;
          if (options.bumpRevisionAfterFirstRead && revisionReads === 1) {
            handle.sqlite.query("UPDATE depreciation_budget_state SET revision=revision+1 WHERE id=1").run();
          }
        }
        return result;
      };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const DB = { ...handle.DB, prepare: (sql: string) => wrap(handle.DB.prepare(sql)) } as D1Database;
  return Object.assign(Object.create(handle), handle, { calls, env: { DB } }) as InstrumentedDatabase;
}

function settings(f: ReturnType<typeof fixture>): DepreciationBudgetSettings {
  return {
    method: "assigned",
    purchase_category_id: 1001,
    monthly_source_category_id: 1002,
    reset_decisions: f.decisions,
  };
}

async function preview(f: ReturnType<typeof fixture>, envDb = f.handle.DB) {
  return depreciationRouter.request(`/${f.scheduleId}/budget/preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ settings: settings(f) }),
  }, { DB: envDb });
}

test("memoized preview keeps its complete response while reducing repeated D1 reads by over 70%", async () => {
  const f = fixture();
  const baseline = await preview(f);
  expect(baseline.status).toBe(200);
  const expected = await baseline.json();

  const measured = instrument(f.handle);
  const response = await preview(f, measured.env.DB);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(expected);
  const selectCalls = measured.calls.filter(({ sql }) => /^\s*(?:SELECT|WITH)\b/i.test(sql));
  expect(selectCalls.length).toBeLessThan(155);
});

test("each preview request sees fresh data after an earlier request", async () => {
  const f = fixture();
  const first = await preview(f);
  expect(first.status).toBe(200);
  const firstBody = await first.json() as { boundaries: { category_name: string }[] };
  expect(firstBody.boundaries.some((row) => row.category_name === "Monthly source")).toBe(true);

  f.handle.sqlite.query("UPDATE budget_categories SET name='Renamed monthly source' WHERE id=1002").run();
  const second = await preview(f);
  expect(second.status).toBe(200);
  const secondBody = await second.json() as { boundaries: { category_name: string }[] };
  expect(secondBody.boundaries.some((row) => row.category_name === "Renamed monthly source")).toBe(true);
});

test("revision reads bypass the preview memo and a concurrent revision change makes preview stale", async () => {
  const f = fixture();
  const measured = instrument(f.handle, { bumpRevisionAfterFirstRead: true });
  const response = await preview(f, measured.env.DB);
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: "stale_preview" });
  expect(measured.calls.filter(({ sql, operation }) => operation === "first" && /FROM\s+depreciation_budget_state/i.test(sql))).toHaveLength(2);
});

test("a long preview history stays below D1's 100 bound-parameter ceiling", async () => {
  const f = fixture({ months: 130, maxParameters: 100 });
  const response = await preview(f);
  expect(response.status).toBe(200);
  const body = await response.json() as { timeline: unknown[] };
  expect(body.timeline.length).toBeGreaterThan(1);
});
