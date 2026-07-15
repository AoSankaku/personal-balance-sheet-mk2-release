export type DateRange = [Date | null, Date | null];

export function completedDateRange(
  current: DateRange,
  next: DateRange,
): DateRange {
  const [from, to] = next;
  return (from === null) === (to === null) ? next : current;
}
