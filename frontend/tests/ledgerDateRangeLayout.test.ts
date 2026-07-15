import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const ledgerPageSource = readFileSync(
  join(import.meta.dir, "../src/pages/LedgerPage.tsx"),
  "utf8",
);
const ledgerPageStyles = readFileSync(
  join(import.meta.dir, "../src/pages/LedgerPage.module.css"),
  "utf8",
);

describe("ledger date range shortcut layout", () => {
  test("uses the responsive date controls in both toolbars", () => {
    const responsiveControls = ledgerPageSource.match(
      /className=\{classes\.dateRangeControls\}/g,
    );

    expect(responsiveControls).toHaveLength(2);
  });

  test("keeps all controls on one desktop row and uses a deliberate mobile grid", () => {
    expect(ledgerPageStyles).toMatch(
      /grid-template-columns:\s*13\.75rem\s+repeat\(2,\s*max-content\)/,
    );
    expect(ledgerPageStyles).toMatch(/@media \(max-width:\s*36em\)/);
    expect(ledgerPageStyles).toMatch(/grid-column:\s*1 \/ -1/);
  });

  test("clears both the selected and applied date ranges from every clear action", () => {
    const completeClearActions = ledgerPageSource.match(
      /setJournalRange\(\[null, null\]\);\s*setAppliedJournalRange\(\[null, null\]\);/g,
    );

    expect(completeClearActions).toHaveLength(2);
  });
});
