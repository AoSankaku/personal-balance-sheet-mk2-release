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

  return getRecentCsvImportLastRecordedDates(journal, now).get(accountId) ?? null;
}

export function getRecentCsvImportLastRecordedDates(
  journal: JournalEntry[],
  now = new Date(),
): Map<number, string> {
  const latestByAccount = new Map<
    number,
    { importDate: string; recordedDate: string }
  >();

  for (const entry of journal) {
    if (entry.source !== "csv_import") continue;
    const importDate = entry.created_at.slice(0, 10);
    for (const accountId of new Set(entry.lines.map((line) => line.account_id))) {
      const latest = latestByAccount.get(accountId);
      latestByAccount.set(accountId, {
        importDate:
          !latest || importDate > latest.importDate
            ? importDate
            : latest.importDate,
        recordedDate:
          !latest || entry.date > latest.recordedDate
            ? entry.date
            : latest.recordedDate,
      });
    }
  }

  const cutoff = sixMonthsAgoDate(now);
  return new Map(
    [...latestByAccount]
      .filter(([, latest]) => latest.importDate >= cutoff)
      .map(([accountId, latest]) => [accountId, latest.recordedDate]),
  );
}
