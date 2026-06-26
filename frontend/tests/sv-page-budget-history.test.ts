import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("SvPage budget history loading", () => {
  test("uses the budget history endpoint instead of per-month summary calls", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/pages/SvPage.tsx"),
      "utf8",
    );

    expect(source).toContain("api.budget.history");
    expect(source).not.toContain("api.budget.summary(ym");
  });
});
