import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readRepoFile(path: string) {
  return readFileSync(join(repoDir, path), "utf8");
}

describe("planned expense weekday fallback persistence", () => {
  test("applies the planned-expense migration chain without losing existing rows", () => {
    const db = new Database(":memory:");

    try {
      db.exec(readRepoFile("worker/drizzle/0000_init.sql"));
      db.exec(readRepoFile("worker/drizzle/0001_planned_expenses.sql"));
      db.exec(`
        INSERT INTO planned_expense_categories (id, kind, name, estimated_amount)
        VALUES (1, 'scheduled_payment', 'Utilities', 5000);
        INSERT INTO planned_expenses (
          id, kind, category_id, name, estimated_amount, recurrence_type,
          recurrence_interval_months, recurrence_day
        ) VALUES (
          1, 'scheduled_payment', 1, 'Electricity', 5000, 'recurring', 2, 15
        );
      `);

      for (const migration of [
        "0002_planned_expense_ordering.sql",
        "0004_enabled_currency_background_color.sql",
        "0005_planned_expense_recurrence_patterns.sql",
        "0006_planned_expense_completion_requests.sql",
      ]) {
        db.exec(readRepoFile(`worker/drizzle/${migration}`));
      }

      expect(
        db
          .query(
            `SELECT name, recurrence_interval, recurrence_unit,
                    recurrence_monthly_mode, recurrence_day,
                    recurrence_week_fallback
             FROM planned_expenses WHERE id = 1`,
          )
          .get(),
      ).toEqual({
        name: "Electricity",
        recurrence_interval: 2,
        recurrence_unit: "month",
        recurrence_monthly_mode: "day_of_month",
        recurrence_day: 15,
        recurrence_week_fallback: "previous_week",
      });
      expect(() =>
        db.exec("UPDATE planned_expenses SET recurrence_count = 0 WHERE id = 1"),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  test("keeps the migration compatible with D1 migration execution", () => {
    const migrationSql = readRepoFile(
      "worker/drizzle/0005_planned_expense_recurrence_patterns.sql",
    );

    expect(migrationSql).toContain("PRAGMA defer_foreign_keys = true");
    expect(migrationSql).not.toContain("PRAGMA foreign_keys");
    expect(migrationSql).toContain(
      "CHECK(recurrence_count IS NULL OR recurrence_count > 0)",
    );
    expect(migrationSql).not.toContain("CREATE TRIGGER");
  });

  test("adds recurrence_week_fallback to the planned expense schema", () => {
    const migrationSql = readRepoFile(
      "worker/drizzle/0005_planned_expense_recurrence_patterns.sql",
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
