import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");
const source = (path: string) => readFileSync(join(root, path), "utf8");

describe("budget funding persistence wiring", () => {
  test("adds an append-only funding allocation migration and schema", () => {
    const migration = source("drizzle/0010_budget_funding_allocations.sql");
    const schema = source("src/db/schema.ts");

    expect(migration).toContain("CREATE TABLE `budget_funding_allocations`");
    expect(migration).toContain("source_journal_entry_id");
    expect(schema).toContain('"budget_funding_allocations"');
  });

  test("persists and reloads funding allocations with journal entries", () => {
    const route = source("src/routes/journal.ts");

    expect(route).toContain("budget_funding");
    expect(route).toContain("budgetFundingAllocations");
    expect(route).toContain("source_journal_entry_id");
    expect(route).toContain("principal_amount");
    expect(route).toContain("loan_settlement_source_journal_entry_ids");
    expect(route).toContain("CASE kind");
    expect(route).toContain("calculateBudgetFundingImpact");
    expect(route).toContain(
      "budget funding components do not match journal lines",
    );
  });

  test("includes funding adjustments in budget summaries", () => {
    const route = source("src/routes/budget.ts");

    expect(route).toContain("sumBudgetFundingAfterResetsByPeriod");
    expect(route).toContain("funding_adjustment");
    expect(route).toContain("borrowed_funding");
    expect(route).toContain("lent_funding");
  });
});
