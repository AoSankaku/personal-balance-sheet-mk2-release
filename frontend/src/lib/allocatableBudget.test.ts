import { describe, expect, test } from "bun:test";
import { summarizeBudgetFunding } from "./allocatableBudget";

describe("summarizeBudgetFunding", () => {
  test("separates net reconciliation from positive-claims funding", () => {
    const summary = summarizeBudgetFunding(770_310, [535_039, 295_555, -38_105]);

    expect(summary.netBudgetBalance).toBe(792_489);
    expect(summary.positiveBudgetClaims).toBe(830_594);
    expect(summary.unfundedOverspending).toBe(38_105);
    expect(summary.reconciliationGap).toBe(-22_179);
    expect(summary.fundingGap).toBe(-60_284);
  });
});
