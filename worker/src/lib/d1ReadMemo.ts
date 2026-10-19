type ReadOperation = "all" | "first" | "raw";

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

/**
 * Deduplicates exact SELECT reads for one request. The returned binding is not
 * shared with later requests; write operations and revision reads always go
 * directly to the original D1 binding.
 */
export function createRequestScopedD1ReadMemo(DB: D1Database): D1Database {
  const pendingReads = new Map<string, Promise<unknown>>();

  const wrapStatement = (statement: D1PreparedStatement, sql: string, parameters: unknown[]): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, property) {
        if (property === "bind") {
          return (...nextParameters: unknown[]) => wrapStatement(target.bind(...nextParameters), sql, [...nextParameters]);
        }
        if (property === "all" || property === "first" || property === "raw") {
          return async (...operationArgs: unknown[]) => {
            const operation = property as ReadOperation;
            if (!isMemoizableSelect(sql, parameters)) return Reflect.apply(target[property], target, operationArgs);

            let key: string;
            try {
              key = JSON.stringify([
                sql,
                encodeTypedValue(parameters),
                operation,
                encodeTypedValue(operationArgs),
              ]);
            } catch {
              return Reflect.apply(target[property], target, operationArgs);
            }

            let resultPromise = pendingReads.get(key);
            if (!resultPromise) {
              resultPromise = Promise.resolve()
                .then(() => Reflect.apply(target[property], target, operationArgs))
                .then(cloneResult);
              pendingReads.set(key, resultPromise);
              resultPromise.catch(() => {
                if (pendingReads.get(key) === resultPromise) pendingReads.delete(key);
              });
            }
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
