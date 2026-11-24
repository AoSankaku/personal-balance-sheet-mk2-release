export type D1LimitType =
  | "daily_read"
  | "daily_write"
  | "requests_per_invocation";

export interface D1LimitErrorBody {
  error: "d1_limit_exceeded";
  limit_type: D1LimitType;
  retry_at: string | null;
}

export function isD1LimitErrorBody(value: unknown): value is D1LimitErrorBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const body = value as Partial<D1LimitErrorBody>;
  if (body.error !== "d1_limit_exceeded") return false;

  if (body.limit_type === "requests_per_invocation") {
    return body.retry_at === null;
  }

  if (body.limit_type !== "daily_read" && body.limit_type !== "daily_write") {
    return false;
  }

  if (typeof body.retry_at !== "string") return false;
  const timestamp = Date.parse(body.retry_at);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString() === body.retry_at
  );
}
