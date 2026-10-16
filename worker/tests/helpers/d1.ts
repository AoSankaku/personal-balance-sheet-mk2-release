import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Runs real migration SQL and D1 queries against an isolated SQLite database. */
export function createTestD1() {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const migrationDirectory = join(import.meta.dir, "../../drizzle");
  for (const name of readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(join(migrationDirectory, name), "utf8"));
  }

  class Statement {
    constructor(readonly query: string, readonly parameters: unknown[] = []) {}
    bind(...parameters: unknown[]) {
      return new Statement(this.query, parameters);
    }
    execute() {
      const results = sqlite.prepare(this.query).all(...this.parameters as never[]);
      const meta = sqlite.query("SELECT changes() AS changes, last_insert_rowid() AS last_row_id").get() as object;
      return { success: true, results, meta };
    }
    async all() { return this.execute(); }
    async run() { return this.execute(); }
    async raw() { return sqlite.prepare(this.query).values(...this.parameters as never[]); }
    async first(column?: string) {
      const row = sqlite.prepare(this.query).get(...this.parameters as never[]) as Record<string, unknown> | null;
      return column ? row?.[column] ?? null : row;
    }
  }

  const DB = {
    prepare: (query: string) => new Statement(query),
    batch: async (statements: Statement[]) =>
      sqlite.transaction(() => statements.map((statement) => statement.execute()))(),
    exec: async (query: string) => { sqlite.exec(query); return { count: 1, duration: 0 }; },
  } as unknown as D1Database;

  return { DB, sqlite, close: () => sqlite.close() };
}
