import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workerRoot = join(import.meta.dir, "..");

describe("budget reset log filtering", () => {
  test("supports a reset-only adjustment-log query without loading expense allocations", () => {
    const route = readFileSync(
      join(workerRoot, "src/routes/budget.ts"),
      "utf8",
    );

    expect(route).toContain('c.req.query("resets_only")');
    expect(route).toContain("const journalAllocRows = resetsOnly");
    expect(route).toMatch(/\?\s*\[\]\s*:\s*await db/);
    expect(route).toContain('row.adjustment_type !== "reset"');
  });
});
