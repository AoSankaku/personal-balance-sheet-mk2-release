import { describe, expect, test } from "bun:test";

import { normalizeBudgetAdjustmentNote } from "../src/lib/budgetAdjustmentNote";

describe("normalizeBudgetAdjustmentNote", () => {
  test("trims a non-empty comment", () => {
    expect(normalizeBudgetAdjustmentNote("  emergency reset  ")).toBe(
      "emergency reset",
    );
  });

  test("returns null for blank comments", () => {
    expect(normalizeBudgetAdjustmentNote("   ")).toBeNull();
    expect(normalizeBudgetAdjustmentNote("")).toBeNull();
    expect(normalizeBudgetAdjustmentNote(null)).toBeNull();
  });
});
