import type { JournalEntry } from "@balance-sheet/shared";

function sixMonthsAgoDate(now: Date): string {
  const targetMonth = new Date(now.getFullYear(), now.getMonth() - 6, 1);
  const lastDayOfTargetMonth = new Date(
    targetMonth.getFullYear(),
    targetMonth.getMonth() + 1,
    0,
  ).getDate();
  const cutoff = new Date(
    targetMonth.getFullYear(),
    targetMonth.getMonth(),
    Math.min(now.getDate(), lastDayOfTargetMonth),
  );
  return [
    cutoff.getFullYear(),
    String(cutoff.getMonth() + 1).padStart(2, "0"),
    String(cutoff.getDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Returns the latest transaction date imported by CSV for an account, but only
 * when that account has participated in a CSV import within the last six months.
 */
export function getRecentCsvImportLastRecordedDate(
  journal: JournalEntry[],
  accountId: number | null,
  now = new Date(),
): string | null {
  if (!accountId) return null;

  const importedEntries = journal.filter(
    (entry) =>
      entry.source === "csv_import" &&
      entry.lines.some((line) => line.account_id === accountId),
  );
  if (importedEntries.length === 0) return null;

  const latestImportDate = importedEntries.reduce(
    (latest, entry) =>
      entry.created_at.slice(0, 10) > latest
        ? entry.created_at.slice(0, 10)
        : latest,
    "",
  );
  if (latestImportDate < sixMonthsAgoDate(now)) return null;

  return importedEntries.reduce(
    (latest, entry) => (entry.date > latest ? entry.date : latest),
    "",
  );
}
