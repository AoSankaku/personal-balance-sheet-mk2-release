// Placement snapshots use the application's JST day, regardless of browser timezone.
const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
});

export function getPlacementPreviewDay(date = new Date()): string {
  const parts = dateFormatter.formatToParts(date);
  const part = (type: "year" | "month" | "day") => parts.find(item => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
