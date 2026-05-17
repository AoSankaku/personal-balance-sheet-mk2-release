import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const source = readFileSync(
  new URL("../src/components/JournalTable.tsx", import.meta.url),
  "utf8",
);
const ledgerSource = readFileSync(
  new URL("../src/pages/LedgerPage.tsx", import.meta.url),
  "utf8",
);

describe("JournalTable currency display", () => {
  test("uses the selected display currency symbol for ledger amounts", () => {
    expect(source).toContain("displayCurrencySymbol");
    expect(source).toContain("formatCurrency(amount, locale, normalized, symbol)");
    expect(ledgerSource).toContain(
      "displayCurrencySymbol={displayCurrencySymbol}",
    );
    expect(ledgerSource).toContain("formatSelectedCurrency");
  });

  test("computes simple row signs from the visible currency-side account type", () => {
    expect(source).toContain("isSimpleDisplayPositive");
    expect(source).toContain('accountTypeMap.get(l.account_id) === "asset"');
  });
});
