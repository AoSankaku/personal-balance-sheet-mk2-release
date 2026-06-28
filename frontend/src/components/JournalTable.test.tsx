import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { formatNarrativeAmountLabel } from "./JournalTable";

describe("formatNarrativeAmountLabel", () => {
  test("keeps simple ledger narrative amounts unsigned", () => {
    expect(formatNarrativeAmountLabel("JPY 58,886", "negative")).toBe(
      "JPY 58,886",
    );
    expect(formatNarrativeAmountLabel("JPY 58,886", "positive")).toBe(
      "JPY 58,886",
    );
  });

  test("preserves neutral transfer amounts", () => {
    expect(formatNarrativeAmountLabel("JPY 10,000", "neutral")).toBe(
      "JPY 10,000",
    );
  });
});

describe("simple ledger locale narratives", () => {
  const jaLocale = parse(
    readFileSync("frontend/src/i18n/locales/ja.yaml", "utf8"),
  );
  const enLocale = parse(
    readFileSync("frontend/src/i18n/locales/en.yaml", "utf8"),
  );

  test("places the repayment cue before the amount", () => {
    expect(jaLocale.ledgerSimpleLiabilityDecrease).toContain("返済 {amount}");
    expect(enLocale.ledgerSimpleLiabilityDecrease).toContain("repaid {amount}");
  });

  test("places balance change cues before the amount", () => {
    expect(jaLocale.ledgerSimpleAssetIncrease).toContain("残高増加 {amount}");
    expect(jaLocale.ledgerSimpleAssetDecrease).toContain("残高減少 {amount}");
    expect(enLocale.ledgerSimpleAssetIncrease).toContain(
      "balance increase {amount}",
    );
    expect(enLocale.ledgerSimpleAssetDecrease).toContain(
      "balance decrease {amount}",
    );
  });
});
