import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

import {
  getOverviewBudgetSkeletonCategoryIds,
  getOverviewBudgetUsagePercentage,
  isOverviewSummaryLoading,
  shouldRefreshMonthScopedData,
} from "../src/lib/overviewSummaryLoading";

describe("Overview budget summary loading", () => {
  test("does not refresh unrelated month-scoped context data on Overview", () => {
    expect(shouldRefreshMonthScopedData("/")).toBe(false);
    expect(shouldRefreshMonthScopedData("/settings/budget")).toBe(true);
  });

  test("marks amounts as loading as soon as the selected date changes", () => {
    expect(
      isOverviewSummaryLoading({
        selectionKey: "2026-07-11|JPY",
        requestKey: "2026-07-10|JPY",
        requestPending: false,
      }),
    ).toBe(true);
  });

  test("keeps amounts loading while the matching request is pending", () => {
    expect(
      isOverviewSummaryLoading({
        selectionKey: "2026-07-11|JPY",
        requestKey: "2026-07-11|JPY",
        requestPending: true,
      }),
    ).toBe(true);
  });

  test("shows amounts only after the matching request finishes", () => {
    expect(
      isOverviewSummaryLoading({
        selectionKey: "2026-07-11|JPY",
        requestKey: "2026-07-11|JPY",
        requestPending: false,
      }),
    ).toBe(false);
  });

  test("uses the current category-row layout while amounts are loading", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/pages/OverviewPage.tsx"),
      "utf8",
    );
    const loadingBranch = source.match(
      /\{summaryLoading \? \([\s\S]*?\) : budgetCategories\.length/,
    )?.[0];

    expect(loadingBranch).toContain("className={classes.categoryItem}");
    expect(loadingBranch).not.toContain(
      '<Skeleton key={index} height={110} radius="md" />',
    );
  });

  test("fixes the skeleton row count to the non-savings category definitions", () => {
    expect(
      getOverviewBudgetSkeletonCategoryIds([
        { id: 11, budget_group: "日常支出" },
        { id: 12, budget_group: "貯蓄" },
        { id: 13, budget_group: "固定費" },
      ]),
    ).toEqual([11, 13]);
    expect(getOverviewBudgetSkeletonCategoryIds([])).toEqual([]);
  });

  test("keeps the hero structure stable when the total budget is not positive", () => {
    expect(getOverviewBudgetUsagePercentage(100, 125)).toBe(125);
    expect(getOverviewBudgetUsagePercentage(0, 125)).toBeNull();
    expect(getOverviewBudgetUsagePercentage(-100, 125)).toBeNull();

    const source = readFileSync(
      join(import.meta.dir, "../src/pages/OverviewPage.tsx"),
      "utf8",
    );
    expect(source.match(/className=\{classes\.heroMetrics\}/g)).toHaveLength(2);
    expect(source).not.toContain("{expenseTotalBudget > 0 && (");
  });

  test("derives hero skeleton heights from the real typography and progress", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/pages/OverviewPage.tsx"),
      "utf8",
    );
    const loadingHero = source.match(
      /\{summaryLoading \? \([\s\S]*?\) : displaySummary \? \(/,
    )?.[0];

    expect(loadingHero).toBeDefined();
    expect(loadingHero).not.toMatch(/<Skeleton[^>]*\bheight=/);
    expect(loadingHero).toContain("<BalanceDisplay");
    expect(loadingHero).toContain("<Progress");
  });

  test("derives category skeleton heights from the real row components", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/pages/OverviewPage.tsx"),
      "utf8",
    );
    const loadingCategories = source.match(
      /\{summaryLoading \? \([\s\S]*?\) : budgetCategories\.length/,
    )?.[0];

    expect(loadingCategories).toBeDefined();
    expect(loadingCategories).not.toMatch(/<Skeleton[^>]*\bheight=/);
    expect(loadingCategories).toContain("<ThemeIcon");
    expect(loadingCategories).toContain("<Progress");
  });

  test("keeps the savings summary and quick links mounted while loading", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/pages/OverviewPage.tsx"),
      "utf8",
    );
    const lowerOverview = source.slice(
      source.indexOf("{/* Budget including savings summary"),
      source.indexOf("{/* Recent transactions */}"),
    );

    expect(lowerOverview).not.toContain(
      "{!summaryLoading && displaySummary && displaySummary.total_budget > 0 && (",
    );
    expect(lowerOverview).toContain("{summaryLoading ? (");
    expect(lowerOverview).not.toMatch(/<Skeleton[^>]*\bheight=/);
    expect(lowerOverview.match(/className=\{classes\.quickLinks\}/g)).toHaveLength(
      1,
    );
  });

  test("does not show a redundant budget category count", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/pages/OverviewPage.tsx"),
      "utf8",
    );

    expect(source).not.toContain("{expenseCategories.length}");
  });

  test("reserves the carryover badge slot while category amounts load", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/pages/OverviewPage.tsx"),
      "utf8",
    );
    const loadingCategories = source.match(
      /\{summaryLoading \? \([\s\S]*?\) : budgetCategories\.length/,
    )?.[0];

    expect(loadingCategories).toContain('<Badge size="xs"');
    expect(source).toContain('visibility: "hidden"');
  });

  test("uses a representative formatted amount for natural skeleton widths", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/pages/OverviewPage.tsx"),
      "utf8",
    );

    expect(source).toContain("const overviewSkeletonAmount = 888_888;");
    expect(source).not.toContain("formatCurrency(0, locale, selectedCurrency)");
    expect(source).not.toContain("amount={0}");
  });
});
