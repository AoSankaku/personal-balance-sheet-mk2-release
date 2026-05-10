import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const currenciesRouteSource = readFileSync(
  new URL("../src/routes/currencies.ts", import.meta.url),
  "utf8",
);

describe("currency route safety", () => {
  test("rejects disabling the final enabled currency", () => {
    expect(currenciesRouteSource).toContain("remaining.length <= 1");
    expect(currenciesRouteSource).toContain("at_least_one_required");
  });

  test("checks nested Drizzle causes when ignoring duplicate currency columns", () => {
    expect(currenciesRouteSource).toContain("current = current.cause");
    expect(currenciesRouteSource).toContain("duplicate column|already exists");
  });
});
