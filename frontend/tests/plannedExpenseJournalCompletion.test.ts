import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("planned expense journal completion", () => {
  test("submits a planned expense and its journal entry through one API call", () => {
    const source = readFileSync(
      new URL("../src/pages/InputPage.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("api.plannedExpenses.completeWithJournal");
    expect(source).not.toContain("await api.journal.create(input);");
  });
});
