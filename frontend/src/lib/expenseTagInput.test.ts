import { describe, expect, test } from "bun:test";
import {
  buildManualTagExpenseSubmission,
  buildSimpleExpenseTagFields,
  buildTagExpenseAmounts,
  initializeTagExpenseInputState,
  normalizeExpenseTagNames,
  resetTagExpenseInputState,
} from "./expenseTagInput";

describe("expense tag input helpers", () => {
  test("trims, removes empty and duplicate names, and preserves distinct tags", () => {
    expect(normalizeExpenseTagNames(["  2026年秋旅行 ", "", "旅行", "2026年秋旅行"])).toEqual([
      "2026年秋旅行",
      "旅行",
    ]);
  });

  test("keeps manual amounts for other currencies when replacing the current currency", () => {
    expect(
      buildTagExpenseAmounts(
        [{ currency: "USD", amount: 12.5 }, { currency: "JPY", amount: 100 }],
        "JPY",
        -80,
      ),
    ).toEqual([
      { currency: "USD", amount: 12.5 },
      { currency: "JPY", amount: -80 },
    ]);
  });

  test("does not add a current-currency amount when the manual input is blank", () => {
    expect(buildTagExpenseAmounts([{ currency: "USD", amount: 12.5 }], "JPY", "")).toEqual([
      { currency: "USD", amount: 12.5 },
    ]);
  });

  test("converts the numeric strings emitted while editing a number input", () => {
    expect(buildTagExpenseAmounts([], "USD", "12.5")).toEqual([
      { currency: "USD", amount: 12.5 },
    ]);
  });

  test("rejects a cleared manual amount instead of silently replacing it in the payload", () => {
    expect(
      buildManualTagExpenseSubmission([{ currency: "USD", amount: 12.5 }], "JPY", "", 100),
    ).toBeNull();
  });

  test("submits the displayed calculated amount when manual mode has not been edited", () => {
    expect(
      buildManualTagExpenseSubmission([], "JPY", undefined, -50),
    ).toEqual([{ currency: "JPY", amount: -50 }]);
  });

  test("accepts an explicit zero manual amount", () => {
    expect(buildManualTagExpenseSubmission([], "JPY", 0, 100)).toEqual([
      { currency: "JPY", amount: 0 },
    ]);
  });

  test("preserves tags when a simple edit changes a non-expense field such as its date", () => {
    expect(buildSimpleExpenseTagFields([" 2026年秋旅行 "])).toEqual({
      expense_tags: ["2026年秋旅行"],
      tag_expense_mode: "auto",
    });
  });

  test("falls back to automatic mode when a saved manual amount belongs to another currency", () => {
    expect(
      initializeTagExpenseInputState("manual", [{ currency: "JPY", amount: 200 }], "USD"),
    ).toEqual({ mode: "auto", amounts: [], manualInputs: {} });
  });

  test("resets the manual amount when the selected currency changes", () => {
    expect(resetTagExpenseInputState()).toEqual({
      mode: "auto",
      amounts: [],
      manualInputs: {},
    });
  });
});
