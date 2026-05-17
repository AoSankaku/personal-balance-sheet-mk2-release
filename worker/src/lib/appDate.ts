export const DEFAULT_APP_TIME_ZONE = "Asia/Tokyo";

export function toLocalDateString(
  date = new Date(),
  timeZone = DEFAULT_APP_TIME_ZONE,
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

export function resolveAsOfDate(asOf: string | null | undefined): string {
  return asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf)
    ? asOf
    : toLocalDateString();
}
