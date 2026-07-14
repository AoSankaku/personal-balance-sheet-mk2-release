import { describe, expect, test } from "bun:test";
import type { ActualBalanceSnapshot } from "@balance-sheet/shared";
import { buildTrialBalanceCarryForward } from "./trialBalanceCarryForward";

const snapshot: ActualBalanceSnapshot = {
  id: 41,
  snapshot_date: "2026-06-30",
  snapshot_time: "21:15",
  created_at: "2026-06-30T21:15:00Z",
  general_entries: [
    {
      id: 1,
      snapshot_id: 41,
      account_id: 10,
      account_name: "Cash",
      amount: 12_500,
      book_value: 12_000,
    },
    {
      id: 2,
      snapshot_id: 41,
      account_id: 20,
      account_name: "Bank",
      amount: 80_000,
      book_value: 80_000,
    },
    {
      id: 3,
      snapshot_id: 41,
      account_id: 30,
      account_name: "Wallet",
      amount: 5_000.4,
      book_value: 5_000,
    },
  ],
};

describe("trial-balance carry-forward", () => {
  test("carries only material differences when requested", () => {
    expect(buildTrialBalanceCarryForward(snapshot, "differences")).toEqual({
      sourceSnapshotId: 41,
      sourceSnapshotDate: "2026-06-30",
      entries: [{ account_id: 10, amount: 12_500 }],
    });
  });

  test("carries every entered value when requested", () => {
    expect(buildTrialBalanceCarryForward(snapshot, "all").entries).toEqual([
      { account_id: 10, amount: 12_500 },
      { account_id: 20, amount: 80_000 },
      { account_id: 30, amount: 5_000.4 },
    ]);
  });

  test("does not carry the old snapshot date as the date of the new trial", () => {
    const draft = buildTrialBalanceCarryForward(snapshot, "all");

    expect(draft).not.toHaveProperty("snapshot_date");
    expect(draft).not.toHaveProperty("targetDate");
  });
});
