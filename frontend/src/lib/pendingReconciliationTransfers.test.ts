import { describe, expect, test } from "bun:test";
import type {
  BudgetPlacementReconciliation,
  IncomeTransferRequirement,
  IncomeTransferRequirementGroup,
  JournalEntry,
} from "@balance-sheet/shared";
import { summarizePendingReconciliationTransfers } from "./pendingReconciliationTransfers";

function requirement(
  overrides: Partial<IncomeTransferRequirement> &
    Pick<IncomeTransferRequirement, "id" | "source_income_journal_entry_id">,
): IncomeTransferRequirement {
  return {
    budget_category_id: 1,
    budget_category_name: "Living",
    from_account_id: 10,
    to_account_id: 20,
    amount: 1000,
    currency: "JPY",
    transfer_journal_entry_id: null,
    completion_source: null,
    created_at: "2026-08-01 12:00:00",
    completed_at: null,
    ...overrides,
  };
}

function entry(id: number, requirements: IncomeTransferRequirement[]): JournalEntry {
  return {
    id,
    date: "2026-08-01",
    description: "Income",
    source: "manual",
    created_at: "2026-08-01 12:00:00",
    lines: [],
    income_transfer_requirements: requirements,
  };
}

function group(requirements: IncomeTransferRequirement[]): IncomeTransferRequirementGroup {
  const first = requirements[0]!;
  return {
    key: `${first.source_income_journal_entry_id}:${first.from_account_id}:${first.to_account_id}:${first.currency}`,
    requirement_ids: requirements.map((item) => item.id),
    source_income_journal_entry_id: first.source_income_journal_entry_id,
    from_account_id: first.from_account_id,
    to_account_id: first.to_account_id,
    amount: requirements.reduce((sum, item) => sum + item.amount, 0),
    currency: first.currency,
    transfer_journal_entry_id: null,
    completion_source: null,
    is_squashed: requirements.length > 1,
    requirements,
  };
}

function plan(overrides: Partial<BudgetPlacementReconciliation> = {}): BudgetPlacementReconciliation {
  return {
    transfers: [],
    groups: [],
    unplaced_difference: 0,
    unplaced_after_difference: 0,
    total_difference: 0,
    after_total_difference: 0,
    unfunded_overspending: 0,
    liabilities: [],
    liability_total: 0,
    adjusted_total_difference: 0,
    as_of: "2026-10-30",
    currency: "JPY",
    revision: 1,
    token: "preview",
    requirement_ids: [],
    unresolved_requirement_ids: [],
    pending_transfers: [],
    expense_evidence: [],
    ...overrides,
  };
}

describe("summarizePendingReconciliationTransfers", () => {
  test("includes placement transfers even when there are no saved income requirements", () => {
    const summary = summarizePendingReconciliationTransfers({
      journal: [],
      plan: plan({
        transfers: [{ from_account_id: 10, to_account_id: 30, amount: 2500, currency: "JPY" }],
      }),
      currency: "JPY",
    });

    expect(summary.taskCount).toBe(1);
    expect(summary.actionableTaskCount).toBe(1);
    expect(summary.taskCountByAccount.get(10)).toBe(1);
    expect(summary.taskCountByAccount.get(30)).toBe(1);
  });

  test("does not double count a saved requirement covered by a placement transfer", () => {
    const saved = requirement({ id: 1, source_income_journal_entry_id: 1 });
    const summary = summarizePendingReconciliationTransfers({
      journal: [entry(1, [saved])],
      plan: plan({
        transfers: [{ from_account_id: 10, to_account_id: 20, amount: 1000, currency: "JPY" }],
        requirement_ids: [1],
        pending_transfers: [group([saved])],
      }),
      currency: "JPY",
    });

    expect(summary.taskCount).toBe(1);
    expect(summary.taskCountByAccount.get(10)).toBe(1);
    expect(summary.taskCountByAccount.get(20)).toBe(1);
  });

  test("keeps covered but unresolved requirements visible when no placement transfer is available", () => {
    const unresolved = requirement({ id: 7, source_income_journal_entry_id: 7 });
    const summary = summarizePendingReconciliationTransfers({
      journal: [entry(7, [unresolved])],
      plan: plan({
        requirement_ids: [7],
        unresolved_requirement_ids: [7],
        pending_transfers: [group([unresolved])],
      }),
      currency: "JPY",
    });

    expect(summary.taskCount).toBe(1);
    expect(summary.taskCountByAccount.get(10)).toBe(1);
    expect(summary.taskCountByAccount.get(20)).toBe(1);
  });

  test("counts a proposed placement transfer and a distinct unresolved income task separately", () => {
    const unresolved = requirement({ id: 8, source_income_journal_entry_id: 8 });
    const summary = summarizePendingReconciliationTransfers({
      journal: [entry(8, [unresolved])],
      plan: plan({
        transfers: [{ from_account_id: 10, to_account_id: 30, amount: 300, currency: "JPY" }],
        requirement_ids: [8],
        unresolved_requirement_ids: [8],
        pending_transfers: [group([unresolved])],
      }),
      currency: "JPY",
    });

    expect(summary.taskCount).toBe(2);
    expect(summary.taskCountByAccount.get(10)).toBe(2);
    expect(summary.taskCountByAccount.get(20)).toBe(1);
    expect(summary.taskCountByAccount.get(30)).toBe(1);
  });

  test("ignores completed requirements and requirements in other currencies", () => {
    const summary = summarizePendingReconciliationTransfers({
      journal: [entry(1, [
        requirement({ id: 1, source_income_journal_entry_id: 1, completion_source: "created" }),
        requirement({ id: 2, source_income_journal_entry_id: 1, currency: "USD" }),
      ])],
      plan: plan({
        transfers: [{ from_account_id: 40, to_account_id: 50, amount: 20, currency: "USD" }],
      }),
      currency: "JPY",
    });

    expect(summary.taskCount).toBe(0);
    expect(summary.taskCountByAccount.size).toBe(0);
  });

  test("counts deferred placement and uncovered saved tasks while preserving both account indicators", () => {
    const covered = requirement({ id: 1, source_income_journal_entry_id: 1, amount: 100 });
    const uncovered = requirement({
      id: 2,
      source_income_journal_entry_id: 2,
      from_account_id: 30,
      to_account_id: 40,
      amount: 100,
    });
    const summary = summarizePendingReconciliationTransfers({
      journal: [entry(1, [covered]), entry(2, [uncovered])],
      plan: plan({
        transfers: [{ from_account_id: 10, to_account_id: 20, amount: 100, currency: "JPY" }],
        requirement_ids: [1],
        pending_transfers: [group([covered])],
      }),
      settings: { transfer_thresholds: { JPY: 500 } },
      currency: "JPY",
    });

    expect(summary.taskCount).toBe(2);
    expect(summary.actionableTaskCount).toBe(0);
    expect(summary.deferredTaskCount).toBe(2);
    expect(summary.taskCountByAccount.get(10)).toBe(1);
    expect(summary.taskCountByAccount.get(20)).toBe(1);
    expect(summary.taskCountByAccount.get(30)).toBe(1);
    expect(summary.taskCountByAccount.get(40)).toBe(1);
  });

  test("falls back to known saved requirements and reports preview loading or failure", () => {
    const saved = requirement({ id: 1, source_income_journal_entry_id: 1 });
    const loading = summarizePendingReconciliationTransfers({
      journal: [entry(1, [saved])],
      plan: null,
      currency: "JPY",
      loading: true,
    });
    const unavailable = summarizePendingReconciliationTransfers({
      journal: [entry(1, [saved])],
      plan: null,
      currency: "JPY",
      error: new Error("preview unavailable"),
    });

    expect(loading.taskCount).toBe(1);
    expect(loading.previewStatus).toBe("loading");
    expect(unavailable.taskCount).toBe(1);
    expect(unavailable.previewStatus).toBe("unavailable");
  });
});
