import { afterEach, expect, test } from "bun:test";
import app from "../src/index";
import { createTestD1 } from "./helpers/d1";

const dailyReadLimit =
  "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.";

function failAccountLookup(handle: ReturnType<typeof createTestD1>) {
  let successfulOperations = 0;
  let failedAccountLookups = 0;

  const wrapStatement = (statement: D1PreparedStatement, query: string) =>
    new Proxy(statement, {
      get(target, property) {
        if (property === "bind") {
          return (...parameters: unknown[]) =>
            wrapStatement(target.bind(...parameters), query);
        }

        const value = Reflect.get(target, property, target);
        if (!["all", "first", "raw", "run"].includes(String(property))) {
          return typeof value === "function" ? value.bind(target) : value;
        }

        return async (...parameters: unknown[]) => {
          if (/\bFROM\s+["`]?accounts["`]?(?:\s|$)/i.test(query)) {
            failedAccountLookups++;
            throw new Error("Account lookup failed", {
              cause: new Error(dailyReadLimit),
            });
          }
          successfulOperations++;
          return value.apply(target, parameters);
        };
      },
    });

  const DB = new Proxy(handle.DB, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) => wrapStatement(target.prepare(query), query);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as D1Database;

  return {
    DB,
    successfulOperations: () => successfulOperations,
    failedAccountLookups: () => failedAccountLookups,
  };
}

const fixtures: ReturnType<typeof createTestD1>[] = [];
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.close()));

function setup() {
  const fixture = createTestD1();
  fixtures.push(fixture);
  fixture.sqlite.exec("INSERT INTO enabled_currencies(code, decimal_places) VALUES ('JPY', 0)");
  return fixture;
}

async function expectQuotaResponse(
  path: string,
  init: RequestInit,
) {
  const fixture = setup();
  const tracked = failAccountLookup(fixture);
  const response = await app.request(path, init, { DB: tracked.DB });

  expect(response.status).toBe(503);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toMatchObject({
    error: "d1_limit_exceeded",
    limit_type: "daily_read",
  });
  expect(tracked.successfulOperations()).toBeGreaterThan(0);
  expect(tracked.failedAccountLookups()).toBe(1);
}

test("budget adjustment preview preserves a quota error from its account lookup", async () => {
  await expectQuotaResponse("/api/budget/allocations/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ date: "2026-01-31", currency: "JPY", adjustments: [] }),
  });
});

test("budget placement preview preserves a quota error from its account lookup", async () => {
  await expectQuotaResponse(
    "/api/income-transfer-requirements/placement-preview?currency=JPY",
    {},
  );
});
