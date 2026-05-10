export const pad = (n: number): string => String(n).padStart(2, "0");

/** YYYY-MM-DD in local timezone (avoids UTC shift from toISOString) */
export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
