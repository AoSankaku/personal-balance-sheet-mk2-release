import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const ledgerPageSource = readFileSync(
  join(import.meta.dir, "../src/pages/LedgerPage.tsx"),
  "utf8",
);

describe("ledger date range shortcut layout", () => {
  test("keeps the All and This month buttons together in both toolbars", () => {
    const shortcutGroups = ledgerPageSource.match(
      /<Group gap="xs" wrap="nowrap">[\s\S]*?\{t\("filterAll"\)\}[\s\S]*?\{t\("filterThisMonth"\)\}[\s\S]*?<\/Group>/g,
    );

    expect(shortcutGroups).toHaveLength(2);
  });
});
