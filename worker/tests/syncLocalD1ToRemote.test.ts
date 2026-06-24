import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import {
  IMPORT_TABLE_ORDER,
  buildDeleteSql,
  buildTableImports,
  parseCountResults,
  parseDatabaseList,
  parseOptions,
  splitSqlStatements,
} from "../scripts/sync-local-d1-to-remote.mjs";

describe("D1 sync SQL processing", () => {
  test("keeps the fixed import order in sync with every application table", async () => {
    const schema = await readFile(
      new URL("../drizzle/0000_init.sql", import.meta.url),
      "utf8",
    );
    const schemaTables = [
      ...schema.matchAll(
        /CREATE TABLE IF NOT EXISTS [`"]([^`"]+)[`"]/giu,
      ),
    ].map((match) => match[1]);

    expect(new Set(IMPORT_TABLE_ORDER)).toEqual(new Set(schemaTables));
  });

  test("splits statements without breaking semicolons or Japanese text in strings", () => {
    const sql = `
BEGIN TRANSACTION;
INSERT INTO accounts (id, name) VALUES (1, '生活費;日本語');
INSERT INTO journal_entries (id, description) VALUES (2, 'it''s fine');
COMMIT;
`;

    expect(splitSqlStatements(sql)).toEqual([
      "BEGIN TRANSACTION;",
      "INSERT INTO accounts (id, name) VALUES (1, '生活費;日本語');",
      "INSERT INTO journal_entries (id, description) VALUES (2, 'it''s fine');",
      "COMMIT;",
    ]);
  });

  test("keeps only application INSERT statements and groups them in dependency order", () => {
    const sql = `
PRAGMA foreign_keys = OFF;
CREATE TABLE ignored (id INTEGER);
INSERT INTO sqlite_sequence VALUES('accounts', 1);
INSERT INTO "_cf_METADATA" VALUES('key', 'value');
INSERT INTO d1_migrations VALUES(1, 'migration.sql', 1);
INSERT INTO journal_lines VALUES(1, 10, 20, 100, 0, '2026-01-01');
INSERT INTO accounts VALUES(20, '現金', 'asset', 'cash', 'JPY', 1, '2026-01-01');
`;

    const imports = buildTableImports(sql);

    expect([...imports.keys()]).toEqual(["accounts", "journal_lines"]);
    expect(imports.get("accounts")).toStartWith(
      "PRAGMA defer_foreign_keys = true;\n",
    );
    expect(imports.get("accounts")).toContain("'現金'");
    expect(imports.get("journal_lines")).toContain(
      "INSERT INTO journal_lines",
    );
  });

  test("fails before wiping remote data when an unknown table would be omitted", () => {
    expect(() =>
      buildTableImports("INSERT INTO future_table VALUES(1);"),
    ).toThrow("future_table");
  });

  test("builds remote deletion SQL in reverse dependency order", () => {
    const sql = buildDeleteSql();
    const deleteStatements = sql
      .split("\n")
      .filter((line) => line.startsWith("DELETE FROM"));

    expect(deleteStatements[0]).toBe(
      `DELETE FROM "${IMPORT_TABLE_ORDER.at(-1)}";`,
    );
    expect(deleteStatements.at(-1)).toBe(
      `DELETE FROM "${IMPORT_TABLE_ORDER[0]}";`,
    );
    expect(sql).not.toContain("_cf_METADATA");
    expect(sql).not.toContain("d1_migrations");
    expect(sql).not.toContain("sqlite_sequence");
  });
});

describe("D1 sync command output parsing", () => {
  test("finds a database by name from wrangler JSON", () => {
    const databases = parseDatabaseList(
      JSON.stringify([
        {
          uuid: "12345678-1234-4abc-8def-1234567890ab",
          name: "balance-sheet-db",
        },
      ]),
    );

    expect(databases.get("balance-sheet-db")).toBe(
      "12345678-1234-4abc-8def-1234567890ab",
    );
  });

  test("parses table counts from wrangler d1 execute JSON", () => {
    const counts = parseCountResults(
      JSON.stringify([
        {
          results: [
            { table_name: "accounts", row_count: 12 },
            { table_name: "journal_entries", row_count: "8" },
          ],
          success: true,
        },
      ]),
    );

    expect(counts).toEqual(
      new Map([
        ["accounts", 12],
        ["journal_entries", 8],
      ]),
    );
  });
});

describe("D1 sync CLI options", () => {
  test("supports documented flags", () => {
    expect(parseOptions(["--yes", "--skip-backup"])).toEqual({
      yes: true,
      dryRun: false,
      skipBackup: true,
      verifyOnly: false,
    });
    expect(parseOptions(["--dry-run"]).dryRun).toBe(true);
    expect(parseOptions(["--verify-only"]).verifyOnly).toBe(true);
  });

  test("rejects unknown flags", () => {
    expect(() => parseOptions(["--force"])).toThrow("--force");
  });
});
