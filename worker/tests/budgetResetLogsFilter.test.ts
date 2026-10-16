import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workerRoot = join(import.meta.dir, "..");

describe("budget reset log filtering", () => {
  test("replays all expense history before applying the reset-only filter", () => {
    const route = readFileSync(
      join(workerRoot, "src/routes/budget.ts"),
      "utf8",
    );

    expect(route).toContain('c.req.query("resets_only")');
    expect(route).toContain("const journalAllocRows = await db");
    expect(route).toContain("replayBudgetHistory(");
    expect(route).toMatch(
      /const replayed = replayBudgetHistory\([\s\S]*?const filtered = replayed\.filter/,
    );
    expect(route).toContain('row.adjustment_type !== "reset"');
  });
});
