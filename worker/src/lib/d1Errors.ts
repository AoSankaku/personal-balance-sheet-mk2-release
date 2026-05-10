const DATABASE_NOT_INITIALIZED_MESSAGE =
  "Database schema is missing. Run `bun run db:migrate` from the worker directory, then restart the Worker dev server.";

function errorMessages(error: unknown): string[] {
  const messages: string[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();

  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      messages.push(current.message);
      current = current.cause;
    } else {
      messages.push(String(current));
      break;
    }
  }

  return messages;
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
