import type {
  ActualBalanceSnapshot,
  EnabledCurrency,
} from "@balance-sheet/shared";
import { hasMaterialBalanceDifference } from "./balanceReconciliation";

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
  enabledCurrencies: EnabledCurrency[] = [],
): TrialBalanceCarryForwardDraft {
  return {
    sourceSnapshotId: snapshot.id,
    sourceSnapshotDate: snapshot.snapshot_date,
    entries: snapshot.general_entries
      .filter(
        (entry) =>
          scope === "all" ||
          hasMaterialBalanceDifference(
            entry.amount - entry.book_value,
            entry.currency,
            enabledCurrencies,
          ),
      )
      .map((entry) => ({
        account_id: entry.account_id,
        amount: entry.amount,
      })),
  };
}
