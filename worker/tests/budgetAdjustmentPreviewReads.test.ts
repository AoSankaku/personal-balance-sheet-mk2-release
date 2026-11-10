import { afterEach, expect, test } from "bun:test";
import { budgetRouter } from "../src/routes/budget";
import { createBoundedReusableD1ReadMemo } from "../src/lib/d1ReadMemo";
import { createTestD1 } from "./helpers/d1";

type Harness = ReturnType<typeof createTestD1>;
type Adjustment = { budget_category_id: number; adhoc_delta: number };
type Preview = {
  date: string;
  currency: string;
  adjustment_total: number;
  categories: { budget_category_id: number; before_available: number; after_available: number }[];
  allocatable_before: number;
  allocatable_after: number;
  token: string;
};

const handles: Harness[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});

function countedBinding(handle: Harness) {
  const executions: { sql: string; operation: string }[] = [];
  const wrapStatement = (statement: any): any => new Proxy(statement, {
    get(target, property) {
      if (property === "bind") return (...parameters: unknown[]) => wrapStatement(target.bind(...parameters));
      if (["all", "first", "raw", "run"].includes(String(property))) {
        return async (...args: unknown[]) => {
          executions.push({ sql: target.query, operation: String(property) });
          return target[property](...args);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const DB = new Proxy(handle.DB, {
    get(target, property) {
      if (property === "prepare") return (sql: string) => wrapStatement(target.prepare(sql));
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { DB: DB as D1Database, executions };
}

function seedPreviewScenario(handle: Harness) {
  handle.sqlite.exec(`
    INSERT INTO enabled_currencies(code, decimal_places) VALUES ('JPY', 0), ('USD', 2);
    INSERT INTO accounts(id,name,type,category,include_in_allocatable) VALUES
      (101,'Bank','asset','cash',1),(102,'Opening balance','equity','opening_balance',1);
    INSERT INTO journal_entries(id,date,description,created_at) VALUES
      (101,'2026-01-01','Opening balance','2026-01-01 00:00:00');
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES
      (101,101,50000,0,'JPY'),(101,102,0,50000,'JPY');
  `);
  const category = (name: string, cap: number | null = null, overflow: number | null = null) => Number(
    handle.sqlite.query(`
      INSERT INTO budget_categories(name,balance_cap,overflow_budget_category_id)
      VALUES (?,?,?) RETURNING id
    `).get<{ id: number }>(name, cap, overflow)!.id,
  );
  const overflow = category("Overflow");
  const capped = category("Capped", 1_000, overflow);
  const deficit = category("Deficit");
  const reset = category("Reset history");
  const currency = category("Other currency");
  const log = (categoryId: number, amount: number, date: string, code = "JPY", type = "allocation", createdAt = `${date} 09:00:00`) => {
    handle.sqlite.query(`
      INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,currency,date,adjustment_type,created_at)
      VALUES (?,?,?,?,?,?,?)
    `).run(categoryId, date.slice(0, 7), amount, code, date, type, createdAt);
  };
  log(capped, 1_500, "2026-01-01");
  log(deficit, -5_000, "2026-01-01");
  log(reset, 7_000, "2026-01-01");
  log(reset, 0, "2026-01-10", "JPY", "reset", "2026-01-10 10:00:00");
  log(reset, 2_000, "2026-01-20");
  log(currency, 12_345, "2026-01-01", "USD");
  return { capped, deficit, overflow, reset, currency };
}

function request(handle: Harness, path: string, body: unknown, DB: D1Database = handle.DB) {
  return budgetRouter.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, { DB });
}

function previewBody(currency: string, adjustments: Adjustment[]) {
  return { date: "2026-01-31", currency, adjustments };
}

function financialResult(preview: Preview) {
  const { token: _token, ...result } = preview;
  return result;
}

test("warm amount edits reuse history and account reads while matching uncached financial results", async () => {
  const warmHandle = createTestD1();
  const referenceHandle = createTestD1();
  handles.push(warmHandle, referenceHandle);
  const ids = seedPreviewScenario(warmHandle);
  const referenceIds = seedPreviewScenario(referenceHandle);
  const counted = countedBinding(warmHandle);

  const firstBody = previewBody("JPY", [
    { budget_category_id: ids.deficit, adhoc_delta: 3_000 },
    { budget_category_id: ids.capped, adhoc_delta: 500 },
    { budget_category_id: ids.reset, adhoc_delta: 300 },
  ]);
  const firstResponse = await request(warmHandle, "/allocations/preview", firstBody, counted.DB);
  expect(firstResponse.status).toBe(200);
  const firstPreview = await firstResponse.json() as Preview;
  const expensiveReads = () => counted.executions.filter(({ sql }) =>
    /\b(?:budget_adjustment_logs|journal_lines)\b/i.test(sql),
  );
  const readsAfterFirstPreview = expensiveReads().length;
  expect(readsAfterFirstPreview).toBeGreaterThan(0);

  const editedBody = previewBody("JPY", [
    { budget_category_id: ids.deficit, adhoc_delta: 3_100 },
    { budget_category_id: ids.capped, adhoc_delta: 600 },
    { budget_category_id: ids.reset, adhoc_delta: 400 },
  ]);
  const editedResponse = await request(warmHandle, "/allocations/preview", editedBody, counted.DB);
  expect(editedResponse.status).toBe(200);
  const editedPreview = await editedResponse.json() as Preview;
  expect(expensiveReads()).toHaveLength(readsAfterFirstPreview);

  const uncachedResponse = await request(referenceHandle, "/allocations/preview", {
    date: editedBody.date,
    currency: editedBody.currency,
    adjustments: editedBody.adjustments.map((item) => ({
      ...item,
      budget_category_id: item.budget_category_id === ids.deficit ? referenceIds.deficit
        : item.budget_category_id === ids.capped ? referenceIds.capped : referenceIds.reset,
    })),
  });
  expect(uncachedResponse.status).toBe(200);
  const uncachedPreview = await uncachedResponse.json() as Preview;
  expect(financialResult(editedPreview)).toEqual(financialResult(uncachedPreview));
  expect(firstPreview.categories.find((item) => item.budget_category_id === ids.capped)?.after_available).toBe(1_000);
  expect(editedPreview.categories.find((item) => item.budget_category_id === ids.overflow)?.after_available).toBe(1_100);
  expect(editedPreview.categories.find((item) => item.budget_category_id === ids.deficit)?.after_available).toBe(-1_900);
  expect(editedPreview.categories.find((item) => item.budget_category_id === ids.reset)?.after_available).toBe(2_400);

  const usdBody = previewBody("USD", [{ budget_category_id: ids.currency, adhoc_delta: 1.25 }]);
  const usdResponse = await request(warmHandle, "/allocations/preview", usdBody, counted.DB);
  expect(usdResponse.status).toBe(200);
  const usdPreview = await usdResponse.json() as Preview;
  const uncachedUsdResponse = await request(referenceHandle, "/allocations/preview", {
    ...usdBody,
    adjustments: [{ budget_category_id: referenceIds.currency, adhoc_delta: 1.25 }],
  });
  expect(uncachedUsdResponse.status).toBe(200);
  const uncachedUsdPreview = await uncachedUsdResponse.json() as Preview;
  expect(financialResult(usdPreview)).toEqual(financialResult(uncachedUsdPreview));
  expect(usdPreview.categories.find((item) => item.budget_category_id === ids.currency)).toMatchObject({
    before_available: 123.45,
    after_available: 124.7,
  });

  const readsBeforeRevisionChange = expensiveReads().length;
  warmHandle.sqlite.exec("UPDATE depreciation_budget_state SET revision=revision+1 WHERE id=1");
  const refreshedResponse = await request(warmHandle, "/allocations/preview", editedBody, counted.DB);
  expect(refreshedResponse.status).toBe(200);
  expect(expensiveReads().length).toBeGreaterThan(readsBeforeRevisionChange);
});

test("bounded reusable memo separates scopes, expires, and never caches writes or revision reads", async () => {
  const handle = createTestD1();
  handles.push(handle);
  const counted = countedBinding(handle);
  let time = 0;
  const cache = createBoundedReusableD1ReadMemo({
    maxScopesPerDatabase: 2,
    ttlMs: 100,
    now: () => time,
  });

  await cache.get(counted.DB, "date-a:JPY:0").prepare("SELECT 1 AS value").first();
  await cache.get(counted.DB, "date-a:JPY:0").prepare("SELECT 1 AS value").first();
  expect(counted.executions).toHaveLength(1);

  await cache.get(counted.DB, "date-a:USD:0").prepare("SELECT 1 AS value").first();
  expect(counted.executions).toHaveLength(2);
  await cache.get(counted.DB, "date-b:JPY:0").prepare("SELECT 1 AS value").first();
  await cache.get(counted.DB, "date-a:JPY:0").prepare("SELECT 1 AS value").first();
  expect(counted.executions).toHaveLength(4);

  const memo = cache.get(counted.DB, "date-b:JPY:0");
  await memo.prepare("SELECT revision FROM depreciation_budget_state WHERE id=1").first();
  await memo.prepare("SELECT revision FROM depreciation_budget_state WHERE id=1").first();
  expect(counted.executions.filter(({ sql }) => sql.includes("depreciation_budget_state"))).toHaveLength(2);

  await memo.prepare("SELECT 2 AS value").run();
  await memo.prepare("SELECT 2 AS value").run();
  expect(counted.executions.filter(({ sql, operation }) => sql === "SELECT 2 AS value" && operation === "run")).toHaveLength(1);

  await memo.prepare("UPDATE budget_categories SET name=name WHERE id=1").run();
  await memo.prepare("UPDATE budget_categories SET name=name WHERE id=1").run();
  expect(counted.executions.filter(({ sql, operation }) => sql.startsWith("UPDATE") && operation === "run")).toHaveLength(2);

  time = 101;
  await cache.get(counted.DB, "date-b:JPY:0").prepare("SELECT 1 AS value").first();
  expect(counted.executions.filter(({ sql }) => sql === "SELECT 1 AS value")).toHaveLength(5);

  const otherHandle = createTestD1();
  handles.push(otherHandle);
  const otherBinding = countedBinding(otherHandle);
  await cache.get(otherBinding.DB, "date-b:JPY:0").prepare("SELECT 1 AS value").first();
  expect(otherBinding.executions).toHaveLength(1);

  const invalidRead = () => cache.get(counted.DB, "date-b:JPY:0")
    .prepare("SELECT * FROM nonexistent_table").first();
  await expect(invalidRead()).rejects.toThrow();
  await expect(invalidRead()).rejects.toThrow();
  expect(counted.executions.filter(({ sql }) => sql.includes("nonexistent_table"))).toHaveLength(2);
});

test("batch save rereads current history and account balances after a cached preview", async () => {
  const handle = createTestD1();
  handles.push(handle);
  const ids = seedPreviewScenario(handle);
  const counted = countedBinding(handle);
  const body = previewBody("JPY", [{ budget_category_id: ids.deficit, adhoc_delta: 250 }]);
  const previewResponse = await request(handle, "/allocations/preview", body, counted.DB);
  expect(previewResponse.status).toBe(200);
  const preview = await previewResponse.json() as Preview;
  const historyAndBalanceReads = () => counted.executions.filter(({ sql }) =>
    /\b(?:budget_adjustment_logs|journal_lines)\b/i.test(sql),
  );
  const previewReadCount = historyAndBalanceReads().length;

  const saveResponse = await request(handle, "/allocations/batch", {
    ...body,
    note: "Updated memo",
    preview_token: preview.token,
  }, counted.DB);
  expect(saveResponse.status).toBe(200);
  expect(historyAndBalanceReads().length).toBeGreaterThan(previewReadCount);
  expect(await saveResponse.json()).toMatchObject({
    logs: [{ note: "Updated memo", budget_category_id: ids.deficit, amount: 250 }],
  });
});

test("oversized results are returned but not retained", async () => {
  const handle = createTestD1();
  handles.push(handle);
  const counted = countedBinding(handle);
  const cache = createBoundedReusableD1ReadMemo({ maxBytesPerScope: 16 });

  const read = () => cache.get(counted.DB, "large-result").prepare("SELECT 'a much longer value' AS value").first<{ value: string }>();
  expect((await read())?.value).toBe("a much longer value");
  expect((await read())?.value).toBe("a much longer value");
  expect(counted.executions).toHaveLength(2);
});

test("read-count cap evicts least-recently-used SELECT results", async () => {
  const handle = createTestD1();
  handles.push(handle);
  const counted = countedBinding(handle);
  const cache = createBoundedReusableD1ReadMemo({ maxReadsPerScope: 1 });
  const memo = () => cache.get(counted.DB, "bounded-reads");

  await memo().prepare("SELECT 1 AS value").first();
  await memo().prepare("SELECT 2 AS value").first();
  await memo().prepare("SELECT 1 AS value").first();
  expect(counted.executions).toHaveLength(3);
});
