import { expect, test } from "bun:test";
import type { BudgetSummaryPair } from "@balance-sheet/shared";
import { api } from "../src/api/client";

function makePair(totalAvailable: number): BudgetSummaryPair {
  const summary = (total: number) => ({
    year_month: "2026-11",
    currency: "JPY",
    monthly_income: 0,
    categories: [],
    total_budget: total,
    total_spent: 0,
    total_available: total,
  });
  return { today: summary(totalAvailable - 10), total: summary(totalAvailable) };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

test("summary pair seeds the individual today and month-end summaries", async () => {
  api.__testing.clearSessionCache();
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = (async () => {
    fetchCount++;
    return jsonResponse(makePair(100));
  }) as typeof fetch;

  try {
    const pending = api.budget.summaryPair("2026-11", "2026-11-10", "JPY");
    const concurrent = api.budget.summaryPair("2026-11", "2026-11-10", "JPY");
    expect(concurrent).toBe(pending);
    const pair = await pending;
    await expect(api.budget.summaryPair("2026-11", "2026-11-10", "JPY")).resolves.toEqual(pair);
    await expect(api.budget.summary("2026-11", "2026-11-10", "JPY")).resolves.toEqual(pair.today);
    await expect(api.budget.summary("2026-11", undefined, "JPY")).resolves.toEqual(pair.total);
    expect(fetchCount).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
    api.__testing.clearSessionCache();
  }
});

test("a pair pending across a mutation cannot repopulate the summary cache", async () => {
  api.__testing.clearSessionCache();
  const originalFetch = globalThis.fetch;
  let resolveOldPair!: (response: Response) => void;
  let resolveOldSummary!: (response: Response) => void;
  let pairRequests = 0;
  let summaryRequests = 0;
  globalThis.fetch = ((input, init) => {
    if ((init?.method ?? "GET") === "POST") return Promise.resolve(jsonResponse({ id: 1 }));
    if (String(input).includes("summary-pair")) {
      pairRequests++;
      if (pairRequests === 1) return new Promise<Response>((resolve) => { resolveOldPair = resolve; });
      return Promise.resolve(jsonResponse(makePair(200)));
    }
    summaryRequests++;
    return new Promise<Response>((resolve) => { resolveOldSummary = resolve; });
  }) as typeof fetch;

  try {
    const stalePending = api.budget.summaryPair("2026-11", "2026-11-10", "JPY");
    const staleSummary = api.budget.summary("2026-11", undefined, "JPY");
    await api.journal.create({ date: "2026-11-10", description: "test", lines: [] });

    const fresh = await api.budget.summaryPair("2026-11", "2026-11-10", "JPY");
    expect(fresh.total.total_available).toBe(200);

    resolveOldPair(jsonResponse(makePair(100)));
    await stalePending;
    resolveOldSummary(jsonResponse(makePair(100).total));
    await staleSummary;
    await expect(api.budget.summaryPair("2026-11", "2026-11-10", "JPY")).resolves.toEqual(fresh);
    await expect(api.budget.summary("2026-11", undefined, "JPY")).resolves.toEqual(fresh.total);
    expect(pairRequests).toBe(2);
    expect(summaryRequests).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
    api.__testing.clearSessionCache();
  }
});

test("a pair started during a write does not seed after the write completes", async () => {
  api.__testing.clearSessionCache();
  const originalFetch = globalThis.fetch;
  let resolveMutation!: (response: Response) => void;
  let resolvePair!: (response: Response) => void;
  let pairRequests = 0;
  let summaryRequests = 0;
  globalThis.fetch = ((input, init) => {
    const path = String(input);
    if ((init?.method ?? "GET") === "POST") {
      return new Promise<Response>((resolve) => { resolveMutation = resolve; });
    }
    if (path.includes("summary-pair")) {
      pairRequests++;
      return new Promise<Response>((resolve) => { resolvePair = resolve; });
    }
    summaryRequests++;
    return Promise.resolve(jsonResponse(makePair(300).total));
  }) as typeof fetch;

  try {
    const mutation = api.journal.create({ date: "2026-11-10", description: "test", lines: [] });
    const pendingPair = api.budget.summaryPair("2026-11", "2026-11-10", "JPY");
    resolveMutation(jsonResponse({ id: 2 }));
    await mutation;
    resolvePair(jsonResponse(makePair(100)));
    await pendingPair;

    await expect(api.budget.summary("2026-11", undefined, "JPY")).resolves.toEqual(makePair(300).total);
    expect(pairRequests).toBe(1);
    expect(summaryRequests).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
    api.__testing.clearSessionCache();
  }
});
