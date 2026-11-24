import type { D1LimitErrorBody, D1LimitType } from "../../../shared/d1Limits";

const DATABASE_NOT_INITIALIZED_MESSAGE =
  "Database schema is missing. Run `bun run db:migrate` from the worker directory, then restart the Worker dev server.";

function errorMessages(error: unknown): string[] {
  const messages: string[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();

  while (current && !seen.has(current) && seen.size < 32) {
    seen.add(current);
    if (typeof current === "string") {
      messages.push(current);
      break;
    }
    if (typeof current !== "object") break;

    const candidate = current as { message?: unknown; cause?: unknown };
    if (typeof candidate.message === "string") {
      messages.push(candidate.message);
    } else {
      // Preserve the former handling for non-Error thrown values while still
      // walking error-like causes when they are available.
      messages.push(String(current));
    }
    current = candidate.cause;
  }

  return messages;
}

const D1_DAILY_READ_LIMIT =
  /^(?:D1_(?:EXEC_)?ERROR:\s*)?Your account has exceeded D1's free tier daily row read limit\b/i;
const D1_DAILY_WRITE_LIMIT =
  /^(?:D1_(?:EXEC_)?ERROR:\s*)?Your account has exceeded D1's free tier daily row write limit\b/i;
const D1_INVOCATION_REQUEST_LIMIT =
  /^D1_(?:EXEC_)?ERROR:\s*Too many API requests by single Worker invocation\b/i;

export function getD1LimitType(error: unknown): D1LimitType | null {
  for (const message of errorMessages(error)) {
    if (D1_DAILY_READ_LIMIT.test(message)) return "daily_read";
    if (D1_DAILY_WRITE_LIMIT.test(message)) return "daily_write";
    // The bare invocation message is shared by other bindings. Require a D1
    // marker so unrelated per-Worker subrequest limits remain distinct.
    if (D1_INVOCATION_REQUEST_LIMIT.test(message)) {
      return "requests_per_invocation";
    }
  }
  return null;
}

export function d1LimitExceededResponse(
  limitType: D1LimitType,
  now = new Date(),
): D1LimitErrorBody {
  const retryAt =
    limitType === "requests_per_invocation"
      ? null
      : new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
        ).toISOString();

  return {
    error: "d1_limit_exceeded",
    limit_type: limitType,
    retry_at: retryAt,
  };
}

export function isMissingD1TableError(error: unknown): boolean {
  return errorMessages(error).some((message) =>
    /D1_ERROR:.*no such table:|no such table:.*SQLITE_ERROR/i.test(message),
  );
}

export function databaseNotInitializedResponse() {
  return {
    error: "database_not_initialized",
    message: DATABASE_NOT_INITIALIZED_MESSAGE,
  };
}
