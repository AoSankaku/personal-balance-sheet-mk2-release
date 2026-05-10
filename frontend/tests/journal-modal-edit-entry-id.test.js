import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("JournalModal loan edit wiring", () => {
  test("passes the current journal entry id to SimpleEntryForm while editing", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/components/JournalModal.tsx"),
      "utf8",
    );

    const simpleEntryForm = source.match(
      /<SimpleEntryForm[\s\S]*?initialDraft=\{simpleInitDraft \?\? undefined\}[\s\S]*?\/>/,
    )?.[0];

    expect(simpleEntryForm).toContain("editEntryId={editEntry?.id}");
  });
});
