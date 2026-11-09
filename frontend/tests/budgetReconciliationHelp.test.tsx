import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { summarizeBudgetFunding } from "../src/lib/allocatableBudget";

const root = join(import.meta.dir, "..", "src");
const locales = ["ja", "en", "fr", "es", "zh-CN", "zh-TW"];
const anchors = [
  "budget-reconciliation", "budget-resources", "budget-net-balance",
  "budget-net-gap", "budget-reference-reserve", "budget-purchase-reserve",
  "budget-non-cash-offset", "budget-adjusted-gap", "budget-positive-claims",
  "budget-secured", "budget-funding-gap", "budget-overspending",
  "budget-placement-gap", "budget-excluded-transfers",
];

describe("budget reconciliation guide", () => {
  test("provides stable, unique deep-link targets in every supported language", () => {
    for (const locale of locales) {
      const guide = readFileSync(join(root, "guides", locale === "ja" ? "" : locale, "03-budget.md"), "utf8");
      for (const anchor of anchors) {
        expect(guide.match(new RegExp(`\\{#${anchor}\\}`, "g"))?.length ?? 0, `${locale}: ${anchor}`).toBe(1);
      }
    }
  });

  test("the documented example separates reconciliation, overspending and placement", () => {
    // Synthetic guide example: cash 100,000, card debt 10,000,
    // category balances 100,000 and -15,000, reserves 2,000 and 3,000.
    const summary = summarizeBudgetFunding(90_000, [100_000, -15_000], 2_000, 3_000);
    expect(summary.reconciliationGap).toBe(5_000);
    expect(summary.adjustedReconciliationGap).toBe(0);
    expect(summary.unfundedOverspending).toBe(15_000);
    expect(summary.fundingGap).toBe(-15_000);
    expect(summary.fundingGap).toBe(summary.adjustedReconciliationGap - summary.unfundedOverspending);
    expect(100_000 - summary.positiveBudgetClaims).toBe(0);
    for (const locale of locales) {
      const guide = readFileSync(join(root, "guides", locale === "ja" ? "" : locale, "03-budget.md"), "utf8");
      expect(guide).toContain("100,000");
      expect(guide).toContain("85,000");
      expect(guide).toContain("−15,000");
    }
  });
});
