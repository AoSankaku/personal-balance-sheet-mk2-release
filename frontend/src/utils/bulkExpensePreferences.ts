export const BULK_COPY_LAST_DATE_STORAGE_KEY = "bulkCopyLastDate";

export function shouldCopyLastDateByDefault(
  storedValue: string | null,
): boolean {
  return storedValue !== "false";
}
