import { describe, expect, test } from "bun:test";
import type { JournalEntry } from "@balance-sheet/shared";
import { getRecentCsvImportLastRecordedDate } from "../src/lib/csvImportHistory";

function entry(
  overrides: Partial<JournalEntry> & Pick<JournalEntry, "id" | "date">,
): JournalEntry {
  return {
    description: "CSV transaction",
    source: "csv_import",
    created_at: "2026-08-01 12:00:00",
    lines: [
      {
        id: overrides.id * 2,
        journal_entry_id: overrides.id,
        account_id: 10,
        debit: 100,
        credit: 0,
        currency: "JPY",
      },
    ],
    ...overrides,
  };
}

describe("getRecentCsvImportLastRecordedDate", () => {
  const now = new Date(2026, 7, 4);

  test("returns the latest CSV transaction date for the selected account", () => {
    const journal = [
      entry({ id: 1, date: "2026-07-30" }),
      entry({ id: 2, date: "2026-08-02" }),
      entry({
        id: 3,
        date: "2026-08-03",
        source: "manual",
      }),
    ];

    expect(getRecentCsvImportLastRecordedDate(journal, 10, now)).toBe(
      "2026-08-02",
    );
  });

  test("hides accounts that have never been imported", () => {
    expect(
      getRecentCsvImportLastRecordedDate(
        [entry({ id: 1, date: "2026-08-01", source: "manual" })],
        10,
        now,
      ),
    ).toBeNull();
  });

  test("hides accounts whose latest import is older than six months", () => {
    expect(
      getRecentCsvImportLastRecordedDate(
        [
          entry({
            id: 1,
            date: "2026-01-31",
            created_at: "2026-02-03 12:00:00",
          }),
        ],
        10,
        now,
      ),
    ).toBeNull();
  });

  test("shows an import performed exactly six months ago", () => {
    expect(
      getRecentCsvImportLastRecordedDate(
        [
          entry({
            id: 1,
            date: "2026-02-01",
            created_at: "2026-02-04 00:00:00",
          }),
        ],
        10,
        now,
      ),
    ).toBe("2026-02-01");
  });

  test("clamps the six-month cutoff to the end of a shorter month", () => {
    expect(
      getRecentCsvImportLastRecordedDate(
        [
          entry({
            id: 1,
            date: "2026-02-28",
            created_at: "2026-02-28 00:00:00",
          }),
        ],
        10,
        new Date(2026, 7, 31),
      ),
    ).toBe("2026-02-28");
  });

  test("ignores CSV entries that do not contain the selected account", () => {
    expect(
      getRecentCsvImportLastRecordedDate(
        [
          entry({
            id: 1,
            date: "2026-08-01",
            lines: [
              {
                id: 2,
                journal_entry_id: 1,
                account_id: 20,
                debit: 100,
                credit: 0,
                currency: "JPY",
              },
            ],
          }),
        ],
        10,
        now,
      ),
    ).toBeNull();
  });
});
