/** Keep Drizzle-built mutations and derived ledger updates in one D1 batch. */
export function prepareMutation(
  DB: D1Database,
  query: { toSQL(): { sql: string; params: unknown[] } },
): D1PreparedStatement {
  const compiled = query.toSQL();
  return DB.prepare(compiled.sql).bind(...compiled.params);
}

export async function readBudgetMutationRevision(DB: D1Database): Promise<number> {
  return (await DB.prepare("SELECT revision FROM depreciation_budget_state WHERE id=1").first<{revision:number}>())!.revision;
}

/** Check a read-before-write decision inside the same transaction as its writes. */
export async function runBudgetGuardedBatch(DB: D1Database, revision: number, statements: D1PreparedStatement[]) {
  try {
    return (await DB.batch([
      DB.prepare("DELETE FROM depreciation_budget_apply_guard WHERE id=1"),
      DB.prepare("INSERT INTO depreciation_budget_apply_guard(id,expected_revision) VALUES(1,?)").bind(revision),
      ...statements,
    ])).slice(2);
  } catch (error) {
    let cause: unknown = error;
    const seen = new Set<unknown>();
    while (cause && !seen.has(cause)) {
      if (String(cause).includes("stale_depreciation_budget_preview")) return null;
      seen.add(cause);
      cause = cause instanceof Error ? cause.cause : null;
    }
    throw error;
  }
}
