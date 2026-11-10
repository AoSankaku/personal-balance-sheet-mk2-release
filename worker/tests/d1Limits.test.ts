import { describe, expect, test } from "bun:test";
import { getD1LimitType, d1LimitExceededResponse } from "../src/lib/d1Errors";
import { loadCurrencyDecimalPlaces } from "../src/lib/currencyPrecision";

const dailyRead = "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.";
const dailyWrite = "D1_ERROR: Your account has exceeded D1's free tier daily row write limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.";
const invocationLimit = "D1_ERROR: Too many API requests by single Worker invocation";

describe("D1 limit classification", () => {
  test("distinguishes daily row reads, writes and D1 invocation requests", () => {
    expect(getD1LimitType(new Error(dailyRead))).toBe("daily_read");
    expect(getD1LimitType(new Error(dailyWrite))).toBe("daily_write");
    expect(getD1LimitType(new Error(invocationLimit))).toBe("requests_per_invocation");
    expect(getD1LimitType(dailyRead.replace("D1_ERROR: ", ""))).toBe("daily_read");
  });

  test("finds wrapped and error-like causes, including circular chains", () => {
    expect(getD1LimitType(new Error("Failed query: select secret params", { cause: new Error(dailyRead) }))).toBe("daily_read");
    expect(getD1LimitType({ message: "wrapper", cause: { message: dailyWrite } })).toBe("daily_write");
    const cycle: { message: string; cause?: unknown } = { message: "wrapper" };
    cycle.cause = cycle;
    expect(getD1LimitType(cycle)).toBeNull();
  });

  test("keeps non-quota failures distinct and ignores quota text inside SQL", () => {
    for (const message of [
      "D1_ERROR: no such table: accounts: SQLITE_ERROR",
      "D1_ERROR: Exceeded maximum DB size.",
      "D1 DB is overloaded. Too many requests queued.",
      "D1 DB storage operation exceeded timeout which caused object to be reset.",
      "D1 query result exceeded the maximum response size limit of 50 MB",
      "Too many subrequests.",
      "Too many API requests by single Worker invocation",
      "rate limit exceeded",
      "Failed query: SELECT 'Your account has exceeded D1's free tier daily row read limit.'",
    ]) expect(getD1LimitType(new Error(message))).toBeNull();
  });

  test("calculates only daily retry times at the next UTC midnight", () => {
    const now = new Date("2026-11-10T23:59:59.000Z");
    for (const kind of ["daily_read", "daily_write"] as const) {
      expect(d1LimitExceededResponse(kind, now)).toMatchObject({
        error: "d1_limit_exceeded", limit_type: kind, retry_at: "2026-11-11T00:00:00.000Z",
      });
    }
    expect(d1LimitExceededResponse("daily_read", new Date("2026-11-11T00:00:00.000Z")).retry_at).toBe("2026-11-12T00:00:00.000Z");
    expect(d1LimitExceededResponse("requests_per_invocation", now).retry_at).toBeNull();
  });

  test("does not fall back to guessed currency precision after a quota failure", async () => {
    const error = new Error(dailyRead);
    const db = { select: () => ({ from: async () => { throw error; } }) };
    await expect(loadCurrencyDecimalPlaces(db as never)).rejects.toBe(error);
    const legacyFailure = { select: () => ({ from: async () => { throw new Error("legacy schema missing"); } }) };
    expect(await loadCurrencyDecimalPlaces(legacyFailure as never)).toEqual({});
  });
});

