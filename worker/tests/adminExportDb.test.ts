import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import app from "../src/index";

type MockResult = { results: Record<string, unknown>[] };

function createExportDatabaseMock(): D1Database {
  const schemaRows = [
    {
      name: "_cf_METADATA",
      type: "table",
      sql: "CREATE TABLE _cf_METADATA (key TEXT PRIMARY KEY, value BLOB)",
    },
    {
      name: "notes",
      type: "table",
      sql: "CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL)",
    },
    {
      name: "notes_body_idx",
      type: "index",
      sql: "CREATE INDEX notes_body_idx ON notes (body)",
    },
  ];

  const prepare = (query: string) => ({
    all: async (): Promise<MockResult> => {
      if (query.includes("FROM sqlite_schema")) {
        return {
          results: query.includes("name NOT GLOB '_cf_*'")
            ? schemaRows.filter(({ name }) => !name.startsWith("_cf_"))
            : schemaRows,
        };
      }
      if (query === 'SELECT * FROM "notes"') {
        return {
          results: [
            { id: 1, body: "first" },
            { id: 3, body: "third" },
          ],
        };
      }
      throw new Error(`Unexpected export query: ${query}`);
    },
  });

  return { prepare } as unknown as D1Database;
}

describe("GET /api/admin/export-db", () => {
  test("rebuilds a downloadable SQLite database from a current D1 binding", async () => {
    const response = await app.request(
      "/api/admin/export-db",
      {},
      { DB: createExportDatabaseMock() },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/x-sqlite3",
    );
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="balance-sheet-\d{4}-\d{2}-\d{2}\.sqlite"$/,
    );

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 16))).toBe(
      "SQLite format 3\0",
    );

    const exported = Database.deserialize(bytes);
    expect(
      exported.query("SELECT id, body FROM notes ORDER BY id").all(),
    ).toEqual([
      { id: 1, body: "first" },
      { id: 3, body: "third" },
    ]);
    expect(
      exported
        .query(
          "SELECT name FROM sqlite_schema WHERE type = 'index' AND name = 'notes_body_idx'",
        )
        .get(),
    ).toEqual({ name: "notes_body_idx" });
    exported.close();
  });
});
