import { describe, expect, test } from "bun:test";
import { databaseNotInitializedResponse, isMissingD1TableError } from "../src/lib/d1Errors";

describe("D1 error handling", () => {
  test("detects missing table errors through nested causes", () => {
    const error = new Error("wrapper");
    const cause = new Error("D1_ERROR: no such table: budget_categories: SQLITE_ERROR");
    (error as Error & { cause: Error }).cause = cause;

    expect(isMissingD1TableError(error)).toBe(true);
  });

  test("does not classify unrelated errors as missing schema", () => {
    expect(isMissingD1TableError(new Error("network failed"))).toBe(false);
  });

  test("returns a clear initialization error response body", () => {
    expect(databaseNotInitializedResponse()).toEqual({
      error: "database_not_initialized",
      message:
        "Database schema is missing. Run `bun run db:migrate` from the worker directory, then restart the Worker dev server.",
    });
  });
});
