import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { api } from "../src/api/client";

const realFetch = globalThis.fetch;
beforeEach(() => api.__testing.clearSessionCache());
afterEach(() => {
  globalThis.fetch = realFetch;
  api.__testing.clearSessionCache();
});

describe("trial balance shared reads", () => {
  test("shares snapshots and card state independently while pending", async () => {
    const paths: string[] = [];
    let resolveSnapshots!: (response: Response) => void;
    let resolveCardState!: (response: Response) => void;
    globalThis.fetch = ((input) => {
      const path = String(input);
      paths.push(path);
      return new Promise<Response>((resolve) => {
        if (path.endsWith("/trial-balance/snapshots")) resolveSnapshots = resolve;
        else resolveCardState = resolve;
      });
    }) as typeof fetch;

    const firstSnapshots = api.trialBalance.listSnapshots();
    const secondSnapshots = api.trialBalance.listSnapshots();
    const firstCardState = api.trialBalance.getCreditCardState();
    const secondCardState = api.trialBalance.getCreditCardState();
    expect(paths).toHaveLength(2);
    resolveSnapshots(Response.json([]));
    resolveCardState(Response.json([]));
    await expect(Promise.all([firstSnapshots, secondSnapshots, firstCardState, secondCardState])).resolves.toEqual([[], [], [], []]);
  });

  test("a write detaches an older snapshot read and later reads see fresh data", async () => {
    let resolveOld!: (response: Response) => void;
    let resolveFresh!: (response: Response) => void;
    let snapshotCount = 0;
    globalThis.fetch = ((input, init) => {
      const path = String(input);
      if (init?.method === "DELETE") return Promise.resolve(Response.json({ ok: true }));
      if (path.endsWith("/trial-balance/snapshots")) {
        snapshotCount++;
        if (snapshotCount === 1) return new Promise<Response>((resolve) => { resolveOld = resolve; });
        return new Promise<Response>((resolve) => { resolveFresh = resolve; });
      }
      return Promise.resolve(Response.json({ snapshot_date: null }));
    }) as typeof fetch;

    const old = api.trialBalance.listSnapshots();
    await api.trialBalance.deleteSnapshot(1);
    const fresh = api.trialBalance.listSnapshots();
    const joinedFresh = api.trialBalance.listSnapshots();
    expect(snapshotCount).toBe(2);
    resolveOld(Response.json([{ id: 1 }]));
    await expect(old).resolves.toEqual([{ id: 1 }]);
    expect(api.trialBalance.listSnapshots()).toBe(fresh);
    resolveFresh(Response.json([{ id: 2 }]));
    await expect(Promise.all([fresh, joinedFresh])).resolves.toEqual([[{ id: 2 }], [{ id: 2 }]]);
    expect(snapshotCount).toBe(2);
  });

  test("does not retain failed snapshot requests", async () => {
    let count = 0;
    globalThis.fetch = (async () => {
      count++;
      return count === 1
        ? Response.json({ error: "unavailable" }, { status: 503 })
        : Response.json([]);
    }) as typeof fetch;

    await expect(api.trialBalance.listSnapshots()).rejects.toThrow("unavailable");
    await expect(api.trialBalance.listSnapshots()).resolves.toEqual([]);
    expect(count).toBe(2);
  });
});
