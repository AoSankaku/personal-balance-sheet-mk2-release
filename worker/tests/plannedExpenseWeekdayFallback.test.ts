import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readRepoFile(path: string) {
  return readFileSync(join(repoDir, path), "utf8");
}

describe("planned expense weekday fallback persistence", () => {
  test("adds recurrence_week_fallback to the planned expense schema", () => {
    const migrationSql = readRepoFile(
      "worker/drizzle/0008_planned_expense_weekday_fallback.sql",
    );
    const schemaSource = readRepoFile("worker/src/db/schema.ts");
    const sharedTypes = readRepoFile("shared/types.ts");

    expect(migrationSql).toContain("recurrence_week_fallback");
    expect(schemaSource).toContain('recurrence_week_fallback: text("recurrence_week_fallback"');
    expect(sharedTypes).toContain("PlannedExpenseWeekFallback");
  });

  test("validates and resolves recurrence_week_fallback in planned expense routes", () => {
    const routeSource = readRepoFile("worker/src/routes/plannedExpenses.ts");

    expect(routeSource).toContain("recurrence_week_fallback");
    expect(routeSource).toContain("resolvePlannedExpenseWeekdayRuleDate");
    expect(routeSource).toContain("invalid recurrence_week_fallback");
  });
});
