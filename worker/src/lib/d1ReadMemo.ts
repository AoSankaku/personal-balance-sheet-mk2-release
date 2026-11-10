type ReadOperation = "all" | "first" | "raw" | "run";

type MemoizedRead = (key: string, execute: () => Promise<unknown>) => Promise<unknown>;

function encodeTypedValue(value: unknown): unknown {
  if (value === null) return ["null"];
  if (value === undefined) return ["undefined"];
  if (typeof value === "string") return ["string", value];
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "number") {
    return ["number", Number.isNaN(value) ? "NaN" : Object.is(value, -0) ? "-0" : String(value)];
  }
  if (typeof value === "bigint") return ["bigint", value.toString()];
  if (typeof value === "function" || typeof value === "symbol") {
    throw new TypeError("Unsupported D1 read key value");
  }
  if (value instanceof Date) return ["date", value.toISOString()];
  if (value instanceof ArrayBuffer) {
    return ["array-buffer", Array.from(new Uint8Array(value))];
  }
  if (ArrayBuffer.isView(value)) {
    return [
      value.constructor.name,
      Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)),
    ];
  }
  if (Array.isArray(value)) return ["array", value.map(encodeTypedValue)];
  if (typeof value === "object") {
    return ["object", Object.keys(value).sort().map((key) => [key, encodeTypedValue((value as Record<string, unknown>)[key])])];
  }
  throw new TypeError("Unsupported D1 read key value");
}

function cloneResult<T>(result: T): T {
  return structuredClone(result);
}

function isMemoizableSelect(sql: string, parameters: readonly unknown[]): boolean {
  const usesClockFunction = /\b(?:date|time|datetime|julianday|unixepoch|strftime)\s*\(/i.test(sql);
  const hasNowInput = /\bnow\b/i.test(sql) || parameters.some((parameter) =>
    typeof parameter === "string" && parameter.toLowerCase() === "now",
  );
  return /^\s*select\b/i.test(sql) &&
    !/\bdepreciation_budget_state\b/i.test(sql) &&
    !/\b(?:random|randomblob|current_timestamp|current_date|current_time|changes|last_insert_rowid)\b/i.test(sql) &&
    !(usesClockFunction && hasNowInput);
}

function createMemoizedBinding(DB: D1Database, memoizeRead: MemoizedRead): D1Database {
  const wrapStatement = (statement: D1PreparedStatement, sql: string, parameters: unknown[]): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, property) {
        if (property === "bind") {
          return (...nextParameters: unknown[]) => wrapStatement(target.bind(...nextParameters), sql, [...nextParameters]);
        }
        if (["all", "first", "raw", "run"].includes(String(property))) {
          return async (...operationArgs: unknown[]) => {
            const operation = property as ReadOperation;
            if (!isMemoizableSelect(sql, parameters)) return Reflect.apply(target[operation], target, operationArgs);

            let key: string;
            try {
              key = JSON.stringify([
                sql,
                encodeTypedValue(parameters),
                operation,
                encodeTypedValue(operationArgs),
              ]);
            } catch {
              return Reflect.apply(target[operation], target, operationArgs);
            }

            const resultPromise = memoizeRead(
              key,
              () => Reflect.apply(target[operation], target, operationArgs),
            );
            return cloneResult(await resultPromise);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

  return new Proxy(DB, {
    get(target, property) {
      if (property === "prepare") {
        return (sql: string) => wrapStatement(target.prepare(sql), sql, []);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * Deduplicates exact SELECT reads for one request. The returned binding is not
 * shared with later requests; write operations and revision reads always go
 * directly to the original D1 binding.
 */
export function createRequestScopedD1ReadMemo(DB: D1Database): D1Database {
  const pendingReads = new Map<string, Promise<unknown>>();
  return createMemoizedBinding(DB, (key, execute) => {
    let resultPromise = pendingReads.get(key);
    if (!resultPromise) {
      resultPromise = Promise.resolve().then(execute).then(cloneResult);
      pendingReads.set(key, resultPromise);
      resultPromise.catch(() => {
        if (pendingReads.get(key) === resultPromise) pendingReads.delete(key);
      });
    }
    return resultPromise;
  });
}

export type BoundedReusableD1ReadMemoOptions = {
  maxScopesPerDatabase?: number;
  ttlMs?: number;
  maxReadsPerScope?: number;
  maxBytesPerScope?: number;
  now?: () => number;
};

type CachedRead = {
  promise: Promise<unknown>;
  lastAccessedAt: number;
  bytes: number;
};

type CachedScope = {
  reads: Map<string, CachedRead>;
  lastAccessedAt: number;
  bytes: number;
};

/**
 * Creates a bounded cross-request SELECT cache. Callers must include every
 * piece of domain state that affects a read in `scopeKey`, and must use a
 * revision or other freshness check before and after relying on the cache.
 */
export function createBoundedReusableD1ReadMemo(
  options: BoundedReusableD1ReadMemoOptions = {},
) {
  const maxScopes = Math.max(1, options.maxScopesPerDatabase ?? 2);
  const ttlMs = Math.max(1, options.ttlMs ?? 30_000);
  const maxReads = Math.max(1, options.maxReadsPerScope ?? 128);
  const maxBytes = Math.max(1, options.maxBytesPerScope ?? 4 * 1024 * 1024);
  const now = options.now ?? Date.now;
  const scopesByDatabase = new WeakMap<D1Database, Map<string, CachedScope>>();

  function pruneReads(scope: CachedScope) {
    while (scope.reads.size > maxReads || scope.bytes > maxBytes) {
      const oldest = [...scope.reads.entries()].reduce<[string, CachedRead] | null>(
        (current, entry) => !current || entry[1].lastAccessedAt < current[1].lastAccessedAt
          ? entry
          : current,
        null,
      );
      if (!oldest) return;
      scope.reads.delete(oldest[0]);
      scope.bytes -= oldest[1].bytes;
    }
  }

  function makeReadMemo(DB: D1Database, scopeKey: string, scope: CachedScope): D1Database {
    return createMemoizedBinding(DB, (key, execute) => {
      const databaseScopes = scopesByDatabase.get(DB);
      if (databaseScopes?.get(scopeKey) !== scope) {
        return Promise.resolve().then(execute).then(cloneResult);
      }

      const timestamp = now();
      let entry = scope.reads.get(key);
      if (entry) {
        entry.lastAccessedAt = timestamp;
        scope.lastAccessedAt = timestamp;
        return entry.promise;
      }

      const created: CachedRead = {
        promise: Promise.resolve().then(execute).then(cloneResult),
        lastAccessedAt: timestamp,
        bytes: 0,
      };
      scope.reads.set(key, created);
      scope.lastAccessedAt = timestamp;
      pruneReads(scope);
      created.promise.then((result) => {
        if (scope.reads.get(key) !== created) return;
        let size: number;
        try {
          const serialized = JSON.stringify(result);
          if (serialized === undefined) throw new TypeError("Unserializable D1 result");
          size = new TextEncoder().encode(serialized).byteLength;
        } catch {
          scope.reads.delete(key);
          return;
        }
        if (size > maxBytes) {
          scope.reads.delete(key);
          return;
        }
        created.bytes = size;
        scope.bytes += size;
        pruneReads(scope);
      }, () => {
        if (scope.reads.get(key) === created) scope.reads.delete(key);
      });
      created.promise.catch(() => {});
      return created.promise;
    });
  }

  return {
    get(DB: D1Database, scopeKey: string): D1Database {
      let databaseScopes = scopesByDatabase.get(DB);
      if (!databaseScopes) {
        databaseScopes = new Map();
        scopesByDatabase.set(DB, databaseScopes);
      }

      const timestamp = now();
      let scope = databaseScopes.get(scopeKey);
      if (scope && timestamp - scope.lastAccessedAt >= ttlMs) {
        databaseScopes.delete(scopeKey);
        scope = undefined;
      }
      if (!scope) {
        scope = { reads: new Map(), lastAccessedAt: timestamp, bytes: 0 };
        databaseScopes.set(scopeKey, scope);
      }
      scope.lastAccessedAt = timestamp;

      while (databaseScopes.size > maxScopes) {
        const oldest = [...databaseScopes.entries()].reduce<[string, CachedScope] | null>(
          (current, entry) => !current || entry[1].lastAccessedAt < current[1].lastAccessedAt
            ? entry
            : current,
          null,
        );
        if (!oldest) break;
        databaseScopes.delete(oldest[0]);
      }

      return makeReadMemo(DB, scopeKey, scope);
    },

    invalidateScopes(DB: D1Database, shouldInvalidate: (scopeKey: string) => boolean): void {
      const databaseScopes = scopesByDatabase.get(DB);
      if (!databaseScopes) return;
      for (const key of databaseScopes.keys()) {
        if (shouldInvalidate(key)) databaseScopes.delete(key);
      }
    },
  };
}
