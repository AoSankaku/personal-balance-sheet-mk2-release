import { describe, expect, test } from "bun:test";
import type { IncomeTransferRequirementGroup } from "@balance-sheet/shared";
import { splitBudgetPlacementTransfersByDeferral } from "./budgetPlacementDeferral";
import type { BudgetPlacementTransfer } from "./budgetPlacement";

function pendingGroup(id: number, deferred: boolean | undefined): IncomeTransferRequirementGroup {
  return {
    key: `income-${id}`,
    requirement_ids: [id],
    source_income_journal_entry_id: id,
    from_account_id: 1,
    to_account_id: 2,
    amount: 100,
    currency: "JPY",
    transfer_journal_entry_id: null,
    completion_source: null,
    is_squashed: false,
    requirements: [{
      id,
      source_income_journal_entry_id: id,
      budget_category_id: 4,
      budget_category_name: "Travel",
      from_account_id: 1,
      to_account_id: 2,
      amount: 100,
      currency: "JPY",
      is_deferred: deferred,
      transfer_journal_entry_id: null,
      completion_source: null,
      created_at: "2026-06-02T00:00:00.000Z",
      completed_at: null,
    }],
  };
}

const transfers: BudgetPlacementTransfer[] = [{
  from_account_id: 2,
  to_account_id: 3,
  amount: 30,
  currency: "JPY",
}];

describe("budget placement task deferral", () => {
  test("hides the whole plan from actionable counts while every covered income group is deferred", () => {
    const result = splitBudgetPlacementTransfersByDeferral({
      transfers,
      pendingGroups: [pendingGroup(1, true), pendingGroup(2, true)],
      settings: null,
    });

    expect(result.actionableTransfers).toEqual([]);
    expect(result.deferredTransfers).toEqual(transfers);
    expect(result.deferredGroupCount).toBe(2);
    expect(result.fullyDeferred).toBe(true);
  });

  test("restores computed placement amounts when the covered income group is resumed", () => {
    const result = splitBudgetPlacementTransfersByDeferral({
      transfers,
      pendingGroups: [pendingGroup(1, false)],
      settings: null,
    });

    expect(result.actionableTransfers).toEqual(transfers);
    expect(result.deferredTransfers).toEqual([]);
    expect(result.fullyDeferred).toBe(false);
  });

  test("keeps below-threshold covered groups deferred until explicitly resumed", () => {
    const result = splitBudgetPlacementTransfersByDeferral({
      transfers,
      pendingGroups: [pendingGroup(1, undefined)],
      settings: { transfer_thresholds: { JPY: 500 } },
    });

    expect(result.fullyDeferred).toBe(true);
    expect(result.actionableTransfers).toEqual([]);
  });

  test("keeps an expenses-only placement plan actionable and leaves mixed plans reviewable", () => {
    const expensesOnly = splitBudgetPlacementTransfersByDeferral({
      transfers,
      pendingGroups: [],
      settings: null,
    });
    const mixed = splitBudgetPlacementTransfersByDeferral({
      transfers,
      pendingGroups: [pendingGroup(1, true), pendingGroup(2, false)],
      settings: null,
    });

    expect(expensesOnly.actionableTransfers).toEqual(transfers);
    expect(mixed.actionableTransfers).toEqual(transfers);
    expect(mixed.fullyDeferred).toBe(false);
    expect(mixed.deferredGroupCount).toBe(1);
  });
});
