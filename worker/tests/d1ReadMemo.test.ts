import { afterEach, expect, test } from "bun:test";
import { createRequestScopedD1ReadMemo } from "../src/lib/d1ReadMemo";
import { createTestD1 } from "./helpers/d1";

const handles: ReturnType<typeof createTestD1>[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});

function countedBinding(handle: ReturnType<typeof createTestD1>, delayMs = 0) {
  const executions: { sql: string; operation: string }[] = [];
  const wrapStatement = (statement: any): any => new Proxy(statement, {
    get(target, property) {
      if (property === "bind") return (...parameters: unknown[]) => wrapStatement(target.bind(...parameters));
      if (["all", "first", "raw", "run"].includes(String(property))) {
        return async (...args: unknown[]) => {
          executions.push({ sql: target.query, operation: String(property) });
          if (delayMs) await Bun.sleep(delayMs);
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

test("memo keys distinguish SQL parameter types, read operations, first columns, and options", async () => {
  const handle = createTestD1();
  handles.push(handle);
  const counted = countedBinding(handle);
  const DB = createRequestScopedD1ReadMemo(counted.DB);

  const numeric = await DB.prepare("SELECT ? AS value").bind(1).first<{ value: number }>();
  numeric!.value = 77;
  const numericAgain = await DB.prepare("SELECT ? AS value").bind(1).first<{ value: number }>();
  expect(numericAgain?.value).toBe(1);
  await DB.prepare("SELECT ? AS value").bind(1).first("value");
  await DB.prepare("SELECT ? AS value").bind("1").first("value");
  await DB.prepare("SELECT ? AS value").bind(1).first();
  await DB.prepare("SELECT ? AS value").bind(1).all();
  await DB.prepare("SELECT ? AS value").bind(1).raw({ columnNames: true });
  await DB.prepare("SELECT ? AS value").bind(1).raw({ columnNames: false });

  expect(counted.executions).toHaveLength(6);
});

test("concurrent exact reads share one in-flight query but receive independent result copies", async () => {
  const handle = createTestD1();
  handles.push(handle);
  const counted = countedBinding(handle, 5);
  const DB = createRequestScopedD1ReadMemo(counted.DB);

  const [first, concurrent] = await Promise.all([
    DB.prepare("SELECT ? AS value").bind(3).first<{ value: number }>(),
    DB.prepare("SELECT ? AS value").bind(3).first<{ value: number }>(),
  ]);
  first!.value = 99;
  expect(concurrent?.value).toBe(3);
  expect(counted.executions).toHaveLength(1);
});

test("revision SELECTs are never memoized and a new request wrapper sees later writes", async () => {
  const handle = createTestD1();
  handles.push(handle);
  const counted = countedBinding(handle);
  const firstRequest = createRequestScopedD1ReadMemo(counted.DB);

  expect(await firstRequest.prepare("SELECT revision FROM depreciation_budget_state WHERE id=1").first())
    .toMatchObject({ revision: 0 });
  handle.sqlite.query("UPDATE depreciation_budget_state SET revision=revision+1 WHERE id=1").run();
  expect(await firstRequest.prepare("SELECT revision FROM depreciation_budget_state WHERE id=1").first())
    .toMatchObject({ revision: 1 });
  expect(await createRequestScopedD1ReadMemo(counted.DB)
    .prepare("SELECT revision FROM depreciation_budget_state WHERE id=1").first())
    .toMatchObject({ revision: 1 });
  expect(counted.executions.filter((row) => row.sql.includes("depreciation_budget_state"))).toHaveLength(3);
});
