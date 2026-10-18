/** Keep Drizzle-built mutations and derived ledger updates in one D1 batch. */
export function prepareMutation(
  DB: D1Database,
  query: { toSQL(): { sql: string; params: unknown[] } },
): D1PreparedStatement {
  const compiled = query.toSQL();
  return DB.prepare(compiled.sql).bind(...compiled.params);
}
