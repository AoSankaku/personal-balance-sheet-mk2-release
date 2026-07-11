import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const workerDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function readWorkerFile(path: string) {
  return readFileSync(join(workerDir, path), "utf8");
}

describe("calendar week start settings", () => {
  test("adds a persisted budget_settings column with a Sunday default", () => {
    const migrationSql = readWorkerFile(
      "drizzle/0005_planned_expense_recurrence_patterns.sql",
    );
    const schemaSource = readWorkerFile("src/db/schema.ts");

    expect(migrationSql).toContain("calendar_week_start");
    expect(migrationSql).toContain("DEFAULT 0");
    expect(schemaSource).toContain('calendar_week_start: integer("calendar_week_start")');
  });

  test("exposes and validates calendar_week_start through budget settings API", () => {
    const routeSource = readWorkerFile("src/routes/budget.ts");

    expect(routeSource).toContain("calendar_week_start");
    expect(routeSource).toContain("normalizeCalendarWeekStart");
    expect(routeSource).toContain("calendar_week_start must be an integer from 0 to 6");
  });
});
