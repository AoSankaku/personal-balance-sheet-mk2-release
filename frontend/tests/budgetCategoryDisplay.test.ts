import { describe, expect, test } from "bun:test";

import { shouldShowCarryoverBadge } from "../src/lib/budgetCategoryDisplay";

describe("budget category display", () => {
  test("hides carryover badges for savings goals", () => {
    expect(shouldShowCarryoverBadge("貯蓄")).toBe(false);
  });

  test("keeps carryover badges visible for regular budget categories", () => {
    expect(shouldShowCarryoverBadge("日常支出")).toBe(true);
  });
});
