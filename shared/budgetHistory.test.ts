import { describe, expect, test } from "bun:test";
import { replayBudgetHistory } from "./budgetHistory";

type Log = {
  id: number;
  type: string;
  budget_category_id: number;
  amount: number;
  currency?: string;
  date: string;
  created_at: string;
  adjustment_type?: string;
  is_reference?: boolean;
};

function log(
  id: number,
  type: string,
  amount: number,
  date: string,
  overrides: Partial<Log> = {},
): Log {
  return {
    id,
    type,
    budget_category_id: 1,
    amount,
    currency: "JPY",
    date,
    created_at: `${date}T00:00:00.000Z`,
    ...overrides,
  };
}

describe("replayBudgetHistory", () => {
  test("recomputes reset corrections after historical entries are added, edited, or removed", () => {
    const expense = log(1, "simple", -100, "2026-01-10");
    const reset = log(2, "reset", -900, "2026-02-01", {
      adjustment_type: "reset",
    });

    const first = replayBudgetHistory([expense, reset]);
    expect(first.logs.find((row) => row.type === "reset")?.amount).toBe(100);
    expect(first.balances.get("reset:2")).toBe(0);

    const backdatedIncome = log(3, "income", 350, "2026-01-20");
    const afterAdding = replayBudgetHistory([expense, backdatedIncome, reset]);
    expect(afterAdding.logs.find((row) => row.type === "reset")?.amount).toBe(
      -250,
    );

    const editedExpense = { ...expense, amount: -200 };
    const afterEditing = replayBudgetHistory([
      editedExpense,
      backdatedIncome,
      reset,
    ]);
    expect(afterEditing.logs.find((row) => row.type === "reset")?.amount).toBe(
      -150,
    );

    const afterDeletingIncome = replayBudgetHistory([editedExpense, reset]);
    expect(
      afterDeletingIncome.logs.find((row) => row.type === "reset")?.amount,
    ).toBe(200);
  });

  test("applies multiple resets independently, including negative reset balances", () => {
    const logs = [
      log(1, "income", 300, "2026-01-01"),
      log(2, "simple", -100, "2026-01-02"),
      log(3, "reset", 12345, "2026-01-03", { adjustment_type: "reset" }),
      log(4, "simple", -500, "2026-01-04"),
      log(5, "reset", -12345, "2026-01-05", { adjustment_type: "reset" }),
      log(6, "simple", -25, "2026-01-06"),
      log(7, "simple", -70, "2026-01-07"),
      log(8, "reset", 0, "2026-01-08", { adjustment_type: "reset" }),
    ];

    const { logs: replayed, balances } = replayBudgetHistory(logs);
    expect(replayed.map((row) => row.amount)).toEqual([
      300, -100, -200, -500, 500, -25, -70, 95,
    ]);
    expect(balances.get("reset:3")).toBe(0);
    expect(balances.get("reset:5")).toBe(0);
    expect(balances.get("reset:8")).toBe(0);
  });

  test("isolates balances by category and currency and excludes reference rows", () => {
    const logs = [
      log(1, "simple", -100, "2026-01-01"),
      log(2, "simple", 60, "2026-01-02", { currency: "USD" }),
      log(3, "simple", 40, "2026-01-03", { budget_category_id: 2 }),
      log(4, "simple", -900, "2026-01-04", { is_reference: true }),
      log(5, "reset", 0, "2026-01-05", { adjustment_type: "reset" }),
    ];

    const { logs: replayed, balances } = replayBudgetHistory(logs);
    expect(replayed).toHaveLength(logs.length);
    expect(balances.get("simple:4")).toBe(-100);
    expect(replayed.find((row) => row.id === 5)?.amount).toBe(100);
    expect(balances.get("reset:5")).toBe(0);
    expect(balances.get("simple:2")).toBe(60);
    expect(balances.get("simple:3")).toBe(40);
  });

  test("preserves input order and does not mutate input rows", () => {
    const later = log(2, "simple", -25, "2026-02-02");
    const earlierReset = log(1, "reset", 500, "2026-02-01", {
      adjustment_type: "reset",
    });
    const input = [later, earlierReset];
    const before = structuredClone(input);

    const result = replayBudgetHistory(input);

    expect(result.logs.map((row) => row.id)).toEqual([2, 1]);
    expect(input).toEqual(before);
  });
});
