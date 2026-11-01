import { describe, expect, test } from "bun:test";

import { api } from "../src/api/client";
import {
  createInFlightRequestDeduper,
  createInvalidatableInFlightRequestDeduper,
} from "../src/api/inFlightRequest";

describe("createInFlightRequestDeduper", () => {
  test("shares one request between concurrent callers with the same key", async () => {
    const dedupe = createInFlightRequestDeduper();
    let requestCount = 0;
    let resolveRequest!: (value: number) => void;
    const pending = new Promise<number>((resolve) => {
      resolveRequest = resolve;
    });
    const request = () => {
      requestCount++;
      return pending;
    };

    const first = dedupe("2026-05|2026-05-02|JPY", request);
    const second = dedupe("2026-05|2026-05-02|JPY", request);

    expect(first).toBe(second);
    expect(requestCount).toBe(1);

    resolveRequest(42);
    await expect(first).resolves.toBe(42);
  });

  test("starts a fresh request after the previous request settles", async () => {
    const dedupe = createInFlightRequestDeduper();
    let requestCount = 0;
    const request = async () => ++requestCount;

    await expect(dedupe("key", request)).resolves.toBe(1);
    await expect(dedupe("key", request)).resolves.toBe(2);
  });
});

describe("createInvalidatableInFlightRequestDeduper", () => {
  test("shares pending reads, detaches old reads at a write, and preserves the newer read", async () => {
    const { dedupe, invalidate } = createInvalidatableInFlightRequestDeduper();
    let resolveOld!: (value: number) => void;
    let count = 0;
    const oldPending = new Promise<number>((resolve) => { resolveOld = resolve; });
    const old = dedupe("snapshots", () => { count++; return oldPending; });
    expect(dedupe("snapshots", async () => { count++; return -1; })).toBe(old);
    invalidate();
    const fresh = dedupe("snapshots", async () => { count++; return 2; });
    await expect(fresh).resolves.toBe(2);
    resolveOld(1);
    await expect(old).resolves.toBe(1);
    await expect(dedupe("snapshots", async () => { count++; return 3; })).resolves.toBe(3);
    expect(count).toBe(3);
  });

  test("removes failed pending reads so callers can retry", async () => {
    const { dedupe } = createInvalidatableInFlightRequestDeduper();
    let count = 0;
    await expect(dedupe("state", async () => { count++; throw new Error("offline"); })).rejects.toThrow("offline");
    await expect(dedupe("state", async () => { count++; return []; })).resolves.toEqual([]);
    expect(count).toBe(2);
  });
});

describe("budget summary API request deduplication", () => {
  test("issues one fetch for concurrent identical summary calls", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    let resolveFetch!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    globalThis.fetch = (() => {
      fetchCount++;
      return pendingResponse;
    }) as typeof fetch;

    try {
      const first = api.budget.summary("2026-05", "2026-05-02", "JPY");
      const second = api.budget.summary("2026-05", "2026-05-02", "JPY");

      expect(fetchCount).toBe(1);
      resolveFetch(
        new Response(
          JSON.stringify({
            year_month: "2026-05",
            currency: "JPY",
            monthly_income: 0,
            categories: [],
            total_budget: 0,
            total_spent: 0,
            total_available: 0,
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      );

      const [firstResult, secondResult] = await Promise.all([first, second]);
      expect(firstResult).toEqual(secondResult);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("serves sequential identical summary calls from session cache", async () => {
    api.__testing.clearSessionCache();
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount++;
      return new Response(
        JSON.stringify({
          year_month: "2026-05",
          currency: "JPY",
          monthly_income: 0,
          categories: [],
          total_budget: 0,
          total_spent: 0,
          total_available: 0,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      await api.budget.summary("2026-05", undefined, "JPY");
      await api.budget.summary("2026-05", undefined, "JPY");

      expect(fetchCount).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      api.__testing.clearSessionCache();
    }
  });

  test("invalidates cached derived reads after a journal mutation succeeds", async () => {
    api.__testing.clearSessionCache();
    const originalFetch = globalThis.fetch;
    const fetchedPaths: string[] = [];
    globalThis.fetch = (async (input, init) => {
      const path = String(input).replace(/^\/api/, "");
      fetchedPaths.push(path);
      if (init?.method === "POST") {
        return new Response(
          JSON.stringify({
            id: 1,
            date: "2026-05-01",
            description: "income",
            created_at: "2026-05-01 00:00:00",
            lines: [],
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          year_month: "2026-05",
          currency: "JPY",
          monthly_income: 0,
          categories: [],
          total_budget: 0,
          total_spent: 0,
          total_available: 0,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      await api.budget.summary("2026-05", undefined, "JPY");
      await api.journal.create({
        date: "2026-05-01",
        description: "income",
        lines: [],
      });
      await api.budget.summary("2026-05", undefined, "JPY");

      expect(
        fetchedPaths.filter((path) => path.startsWith("/budget/summary")),
      ).toHaveLength(2);
    } finally {
      globalThis.fetch = originalFetch;
      api.__testing.clearSessionCache();
    }
  });
});
