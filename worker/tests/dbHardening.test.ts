import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const workerDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaSql = readFileSync(join(workerDir, "drizzle/0000_init.sql"), "utf8");
const enabledCurrencyBackgroundColorMigrationSql = readFileSync(
  join(workerDir, "drizzle/0004_enabled_currency_background_color.sql"),
  "utf8",
);
const journalRoute = readFileSync(
  join(workerDir, "src/routes/journal.ts"),
  "utf8",
);

describe("database hardening", () => {
  test("declares unique indexes for logical singleton rows", () => {
    expect(schemaSql).toContain(
      "idx_budget_allocations_category_month_currency_unique",
    );
    expect(schemaSql).toContain("idx_budget_category_accounts_unique");
    expect(schemaSql).toContain("idx_budget_filter_steps_order_unique");
    expect(schemaSql).toContain("idx_loan_settlements_entry_unique");
    expect(schemaSql).toContain("idx_actual_balance_entries_unique");
  });

  test("declares journal aggregation indexes", () => {
    expect(schemaSql).toContain("idx_journal_entries_date_id");
    expect(schemaSql).toContain("idx_journal_lines_entry");
    expect(schemaSql).toContain("idx_journal_lines_account_entry");
    expect(schemaSql).toContain("idx_journal_lines_currency_account");
  });

  test("stores money amounts as integers instead of floating point", () => {
    const integerMoneyColumns = [
      "debit",
      "credit",
      "amount",
      "fixed_amount",
      "adhoc_amount",
      "goal_balance",
      "balance_cap",
      "total_principal",
      "monthly_payment",
      "principal_amount",
      "interest_amount",
    ];

    for (const column of integerMoneyColumns) {
      expect(schemaSql).not.toContain(`\`${column}\` REAL`);
    }

    expect(schemaSql).toContain("`ratio` REAL");
    expect(schemaSql).toContain("`income_ratio` REAL");
    expect(schemaSql).toContain("`annual_interest_rate` REAL");
  });

  test("stores enabled currency precision for custom minor units", () => {
    expect(schemaSql).toContain("`decimal_places` INTEGER NOT NULL DEFAULT 2");
    expect(schemaSql).toContain("chk_enabled_currencies_decimal_places_range");
  });

  test("stores custom currency icon separately from typed symbols", () => {
    expect(schemaSql).toContain("`custom_symbol` TEXT");
    expect(schemaSql).toContain("`custom_icon` TEXT");
    expect(enabledCurrencyBackgroundColorMigrationSql).toContain(
      "ADD COLUMN `background_color` TEXT",
    );
  });

  test("canonical schema rejects fractional money values", () => {
    const db = new Database(":memory:");
    db.exec(schemaSql);

    expect(() => {
      db.exec(`
        INSERT INTO budget_adjustment_logs
          (budget_category_id, year_month, amount, currency, date, adjustment_type)
        VALUES (1, '2026-05', 123.45, 'JPY', '2026-05-07', 'manual')
      `);
    }).toThrow();

    db.close();
  });

  test("uses D1 batch for journal multi-statement writes", () => {
    expect(journalRoute).not.toContain("db.transaction(");
    expect(journalRoute).toContain("c.env.DB.batch");
  });
});
