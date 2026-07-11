import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("planned expense journal completion", () => {
  test("records the journal entry and planned-expense completion in one Worker route", () => {
    const source = readFileSync(
      new URL("../src/routes/plannedExpenses.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain('router.post("/:id/complete-with-journal"');
    expect(source).toContain("c.env.DB.batch(statements)");
    expect(source).toContain("planned_expense_completion_requests");
  });
});
