import { createBoundedReusableD1ReadMemo } from "./d1ReadMemo";

const previewReads = createBoundedReusableD1ReadMemo({
  maxScopesPerDatabase: 2,
  ttlMs: 30_000,
  maxReadsPerScope: 128,
  maxBytesPerScope: 4 * 1024 * 1024,
});

function dateCurrencyKey(date: string, currency: string): string {
  return JSON.stringify([date, currency]);
}

/**
 * Share immutable D1 reads between adjustment previews for the same date,
 * currency, and mutation revision. The caller must read the revision directly
 * before using this binding and verify it again after calculating the preview.
 */
export function createBudgetAdjustmentPreviewDb(
  DB: D1Database,
  date: string,
  currency: string,
  revision: number,
): D1Database {
  const pairKey = dateCurrencyKey(date, currency);
  const scopeKey = `${pairKey}:${revision}`;
  previewReads.invalidateScopes(
    DB,
    (cachedKey) => cachedKey.startsWith(`${pairKey}:`) && cachedKey !== scopeKey,
  );
  return previewReads.get(DB, scopeKey);
}
