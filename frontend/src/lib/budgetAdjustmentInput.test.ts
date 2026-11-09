import { afterEach, describe, expect, test } from "bun:test";
import { buildBudgetAdjustmentInput } from "./budgetAdjustmentInput";
import { beginBudgetAdjustmentSave, budgetAdjustmentDrafts, finishBudgetAdjustmentSave, getBudgetAdjustmentSaveState, resetBudgetAdjustmentDrafts, setBudgetAdjustmentDraft, subscribeBudgetAdjustmentSave } from "../utils/inputDrafts";

const input = (amounts: Record<number, number | string>, selectedCategoryIds = [1, 2], decimalPlaces = 0) =>
  buildBudgetAdjustmentInput({ date: "2026-11-09", currency: decimalPlaces === 2 ? "USD" : "JPY", note: "  Travel cover  ", selectedCategoryIds, amounts, decimalPlaces });

describe("budget adjustment draft input", () => {
  test("keeps a signed nonzero total and only submits selected nonzero changes", () => {
    expect(input({ 1: -10_000, 2: 8_000, 3: 999 })).toEqual({
      input: { date: "2026-11-09", currency: "JPY", note: "Travel cover", adjustments: [
        { budget_category_id: 1, adhoc_delta: -10_000 }, { budget_category_id: 2, adhoc_delta: 8_000 },
      ] }, total: -2_000,
    });
    expect(input({ 1: -10_000, 2: 10_000 })?.total).toBe(0);
    expect(input({ 1: 0, 2: "" })?.input.adjustments).toEqual([]);
  });

  test("uses minor units so USD cents have an exact total", () => {
    expect(input({ 1: 0.1, 2: 0.2 }, [2, 1, 2], 2)?.total).toBe(0.3);
    expect(input({ 1: -10.01, 2: 8.02 }, [1, 2], 2)?.total).toBe(-1.99);
  });

  test.each([NaN, Infinity, -Infinity, "-", "abc", 0.5, Number.MAX_SAFE_INTEGER + 1])("does not reinterpret an invalid amount as zero: %s", value => {
    expect(input({ 1: value }, [1])).toBeNull();
  });

  test("does not round away excess cents or a total outside the safe integer range", () => {
    expect(input({ 1: 1.001 }, [1], 2)).toBeNull();
    expect(input({ 1: Number.MAX_SAFE_INTEGER, 2: 1 })).toBeNull();
  });
});

afterEach(resetBudgetAdjustmentDrafts);
test("currency drafts remain separate and clearing one keeps the other", () => {
  const base = { date: new Date(2026, 10, 9), note: "", selectedCategoryIds: [1], showOnlySelected: true };
  setBudgetAdjustmentDraft("JPY", { ...base, amounts: { 1: -10_000 } });
  setBudgetAdjustmentDraft("USD", { ...base, amounts: { 1: 1.23 } });
  expect(budgetAdjustmentDrafts.JPY.amounts[1]).toBe(-10_000);
  expect(budgetAdjustmentDrafts.USD.amounts[1]).toBe(1.23);
  setBudgetAdjustmentDraft("JPY", null);
  expect(budgetAdjustmentDrafts.JPY).toBeUndefined();
  expect(budgetAdjustmentDrafts.USD.amounts[1]).toBe(1.23);
  resetBudgetAdjustmentDrafts();
  expect(budgetAdjustmentDrafts).toEqual({});
});

test("save state spans remounts, rejects duplicate starts, and clears a completed currency draft", () => {
  setBudgetAdjustmentDraft("JPY", { date: new Date(), note: "", selectedCategoryIds: [1], amounts: { 1: -500 }, showOnlySelected: false });
  const before = getBudgetAdjustmentSaveState().version;
  let notifications = 0;
  const unsubscribe = subscribeBudgetAdjustmentSave(() => notifications++);
  expect(beginBudgetAdjustmentSave("JPY")).toBe(true);
  expect(beginBudgetAdjustmentSave("USD")).toBe(false);
  expect(getBudgetAdjustmentSaveState().saving).toBe(true);
  finishBudgetAdjustmentSave("USD", "saved");
  expect(getBudgetAdjustmentSaveState().saving).toBe(true);
  finishBudgetAdjustmentSave("JPY", "saved");
  expect(getBudgetAdjustmentSaveState()).toEqual({ saving: false, version: before + 1 });
  expect(budgetAdjustmentDrafts.JPY).toBeUndefined();
  expect(notifications).toBe(2);
  unsubscribe();
});

test.each(["stale", "failed", "uncertain"] as const)("preserves amounts and outcome across remounts: %s", outcome => {
  setBudgetAdjustmentDraft("JPY", { date: new Date(), note: "", selectedCategoryIds: [1], amounts: { 1: -500 }, showOnlySelected: true });
  expect(beginBudgetAdjustmentSave("JPY")).toBe(true);
  finishBudgetAdjustmentSave("JPY", outcome);
  expect(budgetAdjustmentDrafts.JPY.amounts[1]).toBe(-500);
  expect(budgetAdjustmentDrafts.JPY.saveStatus).toBe(outcome);
});
