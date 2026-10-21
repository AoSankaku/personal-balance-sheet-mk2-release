import { describe, expect, test } from "bun:test";
import type { IncomeTransferRequirement, IncomeTransferRequirementGroup } from "@balance-sheet/shared";
import { filterUncoveredIncomeTransfers } from "./incomeTransferPlacementTasks";

function requirement(id: number): IncomeTransferRequirement {
  return { id, source_income_journal_entry_id: id + 100, budget_category_id: id, budget_category_name: `Budget ${id}`, from_account_id: 1, to_account_id: 2, amount: id, currency: "JPY", transfer_journal_entry_id: null, completion_source: null, created_at: "2026-10-01", completed_at: null };
}

function group(rows: IncomeTransferRequirement[]): IncomeTransferRequirementGroup {
  return { key: "g", requirement_ids: rows.map(row => row.id), source_income_journal_entry_id: rows[0]!.source_income_journal_entry_id, from_account_id: 1, to_account_id: 2, amount: rows.reduce((sum, row) => sum + row.amount, 0), currency: "JPY", transfer_journal_entry_id: null, completion_source: null, is_squashed: rows.length > 1, requirements: rows };
}

describe("filterUncoveredIncomeTransfers", () => {
  test("hides covered pending income amounts so they are not shown twice beside placement transfers", () => {
    expect(filterUncoveredIncomeTransfers([group([requirement(1), requirement(2)])], [1, 2])).toEqual([]);
  });

  test("retains only uncovered members of a partially covered saved group", () => {
    expect(filterUncoveredIncomeTransfers([group([requirement(1), requirement(2)])], [1])).toEqual([group([requirement(2)])]);
  });

  test("keeps all saved tasks when the placement request failed or covered none", () => {
    const saved = group([requirement(1), requirement(2)]);
    expect(filterUncoveredIncomeTransfers([saved], [])).toEqual([saved]);
  });
});
