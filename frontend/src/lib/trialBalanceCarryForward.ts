import type { ActualBalanceSnapshot } from "@balance-sheet/shared";

export type TrialBalanceCarryForwardScope = "differences" | "all";

export interface TrialBalanceCarryForwardDraft {
  sourceSnapshotId: number;
  sourceSnapshotDate: string;
  entries: Array<{
    account_id: number;
    amount: number;
  }>;
}

export function buildTrialBalanceCarryForward(
  snapshot: ActualBalanceSnapshot,
  scope: TrialBalanceCarryForwardScope,
): TrialBalanceCarryForwardDraft {
  return {
    sourceSnapshotId: snapshot.id,
    sourceSnapshotDate: snapshot.snapshot_date,
    entries: snapshot.general_entries
      .filter(
        (entry) =>
          scope === "all" || Math.abs(entry.amount - entry.book_value) > 0.5,
      )
      .map((entry) => ({
        account_id: entry.account_id,
        amount: entry.amount,
      })),
  };
}
