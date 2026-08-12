import { describe, expect, test } from "bun:test";

import { waitForDevSync } from "./wait-for-dev-sync.mjs";

describe("waitForDevSync", () => {
  test("waits until main and dev contain the pushed merge at the same commit", async () => {
    const remoteHeads = [
      { main: "merge", dev: "previous" },
      { main: "bumped", dev: "previous" },
      { main: "bumped", dev: "bumped" },
    ];
    let currentTime = 0;
    let waits = 0;

    const result = await waitForDevSync({
      expectedCommit: "merge",
      getRemoteHeads: async () => remoteHeads.shift(),
      containsExpectedCommit: async (expected, head) =>
        expected === "merge" && head === "bumped",
      sleep: async (milliseconds) => {
        waits += 1;
        currentTime += milliseconds;
      },
      now: () => currentTime,
      intervalMs: 5,
      timeoutMs: 100,
    });

    expect(result).toBe("bumped");
    expect(waits).toBe(2);
  });

  test("does not accept matching remote heads that lack the pushed merge", async () => {
    const remoteHeads = [
      { main: "stale", dev: "stale" },
      { main: "current", dev: "current" },
    ];
    let currentTime = 0;

    const result = await waitForDevSync({
      expectedCommit: "merge",
      getRemoteHeads: async () => remoteHeads.shift(),
      containsExpectedCommit: async (_expected, head) => head === "current",
      sleep: async (milliseconds) => {
        currentTime += milliseconds;
      },
      now: () => currentTime,
      intervalMs: 5,
      timeoutMs: 100,
    });

    expect(result).toBe("current");
  });

  test("fails with a clear error after the timeout", async () => {
    let currentTime = 0;

    await expect(
      waitForDevSync({
        expectedCommit: "merge",
        getRemoteHeads: async () => ({ main: "main", dev: "dev" }),
        containsExpectedCommit: async () => false,
        sleep: async (milliseconds) => {
          currentTime += milliseconds;
        },
        now: () => currentTime,
        intervalMs: 5,
        timeoutMs: 10,
      }),
    ).rejects.toThrow("Timed out waiting for origin/dev");
  });
});
