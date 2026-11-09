import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { summarizeBudgetFunding } from "../src/lib/allocatableBudget";
import { budgetGuideLink, budgetTermHelp } from "../src/lib/budgetHelp";
import { guideAnchorFromHash, remarkGuideAnchors, resolveGuideSection } from "../src/lib/guideNavigation";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";

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
      const html = renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGuideAnchors], children: guide }));
      for (const anchor of anchors) {
        expect(guide.match(new RegExp(`\\{#${anchor}\\}`, "g"))?.length ?? 0, `${locale}: ${anchor}`).toBe(1);
        expect(html, `${locale}: rendered ${anchor}`).toContain(`id="${anchor}"`);
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
    expect(100_000 - summary.positiveBudgetClaims - summary.referenceReserve - summary.depreciationNonCashOffset).toBe(-5_000);
    for (const locale of locales) {
      const guide = readFileSync(join(root, "guides", locale === "ja" ? "" : locale, "03-budget.md"), "utf8");
      expect(guide).toContain("100,000");
      expect(guide).toContain("85,000");
      expect(guide).toContain("−15,000");
    }
  });

  test("every question icon links to its own section and has localized help", () => {
    const typedKeys = readFileSync(join(root, "i18n/translationKeys.ts"), "utf8");
    for (const [hint, anchor] of Object.values(budgetTermHelp)) {
      const link = new URL(budgetGuideLink(anchor), "https://example.test");
      expect(link.pathname).toBe("/settings/guides");
      expect(link.searchParams.get("section")).toBe("budget");
      expect(anchors).toContain(guideAnchorFromHash(link.hash));
      expect(typedKeys).toContain(`"${hint}"`);
    }
  });

  test("renders explicit Markdown anchors without exposing their marker", () => {
    const html = renderToStaticMarkup(createElement(ReactMarkdown, {
      remarkPlugins: [remarkGuideAnchors],
      children: "## 普通の見出し\n\n### 純整合差額 **G** {#budget-net-gap}\n\n説明 {#not-a-heading}\n\n### Keep {#INVALID}",
    }));
    expect(html).toContain('<h3 id="budget-net-gap">純整合差額 <strong>G</strong></h3>');
    expect(html).toContain("<h2>普通の見出し</h2>");
    expect(html).not.toContain("{#budget-net-gap}");
    expect(html).toContain("{#not-a-heading}");
    expect(html).toContain("{#INVALID}");
  });

  test("selects valid chapters and tolerates invalid or missing URL input", () => {
    const ids = ["overview", "budget", "loans"];
    expect(resolveGuideSection("budget", ids)).toBe("budget");
    expect(resolveGuideSection(null, ids)).toBe("overview");
    expect(resolveGuideSection("missing", ids)).toBe("overview");
    expect(guideAnchorFromHash("#budget-net-gap")).toBe("budget-net-gap");
    expect(guideAnchorFromHash("#budget%2Dnet%2Dgap")).toBe("budget-net-gap");
    expect(guideAnchorFromHash("#%broken")).toBeNull();
    expect(guideAnchorFromHash("#")).toBeNull();
    expect(guideAnchorFromHash("")).toBeNull();
  });
});
