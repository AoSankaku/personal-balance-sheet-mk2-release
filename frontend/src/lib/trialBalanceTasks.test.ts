import { describe, expect, test } from "bun:test";
import { computeTrialBalanceTask } from "./trialBalanceTasks";

describe("computeTrialBalanceTask", () => {
  test("does not create a task when the monthly reminder is disabled", () => {
    expect(
      computeTrialBalanceTask({
        today: new Date(2026, 6, 15),
        enabled: false,
        day: 15,
        latestSnapshotDate: null,
      }),
    ).toBeNull();
  });

  test("waits until the configured day", () => {
    expect(
      computeTrialBalanceTask({
        today: new Date(2026, 6, 14),
        enabled: true,
        day: 15,
        latestSnapshotDate: "2026-06-20",
      }),
    ).toBeNull();
  });

  test("creates a task on the configured day when this month has not been checked", () => {
    expect(
      computeTrialBalanceTask({
        today: new Date(2026, 6, 15),
        enabled: true,
        day: 15,
        latestSnapshotDate: "2026-06-30",
      }),
    ).toEqual({
      id: "trial-balance-2026-07",
      scheduledDate: "2026-07-15",
    });
  });

  test("suppresses the task when a snapshot was already saved this month", () => {
    expect(
      computeTrialBalanceTask({
        today: new Date(2026, 6, 20),
        enabled: true,
        day: 15,
        latestSnapshotDate: "2026-07-03",
      }),
    ).toBeNull();
  });

  test("uses month end when the configured day does not exist", () => {
    expect(
      computeTrialBalanceTask({
        today: new Date(2026, 1, 28),
        enabled: true,
        day: 31,
        latestSnapshotDate: null,
      }),
    ).toEqual({
      id: "trial-balance-2026-02",
      scheduledDate: "2026-02-28",
    });
  });

  test("rejects an invalid configured day", () => {
    expect(
      computeTrialBalanceTask({
        today: new Date(2026, 6, 15),
        enabled: true,
        day: 0,
        latestSnapshotDate: null,
      }),
    ).toBeNull();
  });
});
