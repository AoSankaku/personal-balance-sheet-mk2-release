import { describe, expect, test } from "bun:test";
import app from "../src/index";

const dailyRead = "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.";
const dailyWrite = "D1_ERROR: Your account has exceeded D1's free tier daily row write limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.";
const invocationLimit = "D1_ERROR: Too many API requests by single Worker invocation";

function failingDb(error: unknown) {
  let calls = 0;
  const fail = async () => { calls++; throw error; };
  const statement = { bind: () => statement, all: fail, first: fail, run: fail, raw: fail };
  return {
    DB: { prepare: () => statement, batch: fail, exec: fail } as unknown as D1Database,
    calls: () => calls,
  };
}

describe("D1 limits through the full API", () => {
  test("returns a sanitized quota contract for JSON reads, erase, balance fetch and DB download", async () => {
    const cases = [
      { path: "/api/accounts", init: {} },
      { path: "/api/admin/erase", init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: "ledger_all" }) } },
      { path: "/api/crypto/balance?chain=binance&address=BTC", init: {} },
      { path: "/api/admin/export-db", init: {} },
    ];
    for (const { path, init } of cases) {
      const fixture = failingDb(new Error("Failed query: SELECT api_secret FROM credentials; params: PRIVATE", { cause: new Error(dailyRead) }));
      const response = await app.request(path, init, { DB: fixture.DB });
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
      const body = await response.json();
      expect(body).toMatchObject({ error: "d1_limit_exceeded", limit_type: "daily_read" });
      expect(JSON.stringify(body)).not.toContain("PRIVATE");
      expect(JSON.stringify(body)).not.toContain("api_secret");
      expect(fixture.calls()).toBe(1);
    }
  });

  test("distinguishes write limits and omits daily-reset hints for invocation limits", async () => {
    for (const [message, limit_type] of [[dailyWrite, "daily_write"], [invocationLimit, "requests_per_invocation"]]) {
      const fixture = failingDb(new Error(message));
      const response = await app.request("/api/accounts", {}, { DB: fixture.DB });
      expect(response.status).toBe(503);
      const body = await response.json() as { limit_type: string; retry_at: string | null };
      expect(body.limit_type).toBe(limit_type!);
      if (limit_type === "requests_per_invocation") {
        expect(body.retry_at).toBeNull();
        expect(response.headers.has("Retry-After")).toBe(false);
      }
    }
  });
});
