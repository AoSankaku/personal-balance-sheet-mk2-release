import initSqlJs, {
  type SqlJsDatabase,
} from "sql.js-runtime/dist/sql-asm.js";

type SchemaObject = {
  name: string;
  type: "index" | "table" | "trigger" | "view";
  sql: string;
};

type SQLiteValue = number | string | Uint8Array | null;

const SCHEMA_QUERY = `SELECT name, type, sql
FROM sqlite_schema
WHERE sql IS NOT NULL
  AND name NOT LIKE 'sqlite_%'
  AND name NOT GLOB '_cf_*'
ORDER BY CASE type
  WHEN 'table' THEN 0
  WHEN 'view' THEN 1
  WHEN 'index' THEN 2
  WHEN 'trigger' THEN 3
  ELSE 4
END, name`;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function toSQLiteValue(value: unknown): SQLiteValue {
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(
      value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
    );
  }
  throw new TypeError(`Unsupported D1 export value: ${typeof value}`);
}

function ensureSqlJsWorkerLocation(): void {
  const runtimeGlobal = globalThis as typeof globalThis & {
    location?: { href: string };
  };
  if (runtimeGlobal.location) return;

  Object.defineProperty(runtimeGlobal, "location", {
    configurable: true,
    value: { href: "https://worker.invalid/" },
  });
}

async function copyTable(
  source: D1Database,
  target: SqlJsDatabase,
  tableName: string,
): Promise<void> {
  const { results } = await source
    .prepare(`SELECT * FROM ${quoteIdentifier(tableName)}`)
    .all<Record<string, unknown>>();

  if (results.length === 0) return;

  const columns = Object.keys(results[0]!);
  const insertSql = `INSERT INTO ${quoteIdentifier(tableName)} (${columns
    .map(quoteIdentifier)
    .join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
  const statement = target.prepare(insertSql);

  try {
    for (const row of results) {
      statement.run(columns.map((column) => toSQLiteValue(row[column])));
    }
  } finally {
    statement.free();
  }
}

export async function exportD1ToSQLite(source: D1Database): Promise<Uint8Array> {
  const { results: schemaObjects } = await source
    .prepare(SCHEMA_QUERY)
    .all<SchemaObject>();
  ensureSqlJsWorkerLocation();
  const SQL = await initSqlJs();
  const target = new SQL.Database();

  try {
    target.run("PRAGMA foreign_keys = OFF");
    target.run("BEGIN");

    const tables = schemaObjects.filter(({ type }) => type === "table");
    for (const table of tables) {
      target.run(table.sql);
    }
    for (const table of tables) {
      await copyTable(source, target, table.name);
    }
    for (const schemaObject of schemaObjects) {
      if (schemaObject.type !== "table") {
        target.run(schemaObject.sql);
      }
    }

    target.run("COMMIT");
    return target.export();
  } catch (error) {
    try {
      target.run("ROLLBACK");
    } catch {
      // Preserve the original export error if the transaction already ended.
    }
    throw error;
  } finally {
    target.close();
  }
}
