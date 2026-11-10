import { expect, test } from "bun:test";
import type { BudgetSummary } from "@balance-sheet/shared";
import { api } from "../src/api/client";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

const summary: BudgetSummary = {
  year_month: "2026-11",
  currency: "JPY",
  monthly_income: 0,
  categories: [],
  total_budget: 100,
  total_spent: 0,
  total_available: 100,
};

test("budget adjustment preview preserves derived read caches and batch still invalidates them", async () => {
  api.__testing.clearSessionCache();
  const originalFetch = globalThis.fetch;
  let summaryRequests = 0;
  let placementRequests = 0;
  let snapshotRequests = 0;
  let previewBody: unknown;
  let batchBody: unknown;
  let resolveSnapshots!: (response: Response) => void;

  globalThis.fetch = ((input, init) => {
    const path = String(input);
    if (path.includes("/budget/summary?")) {
      summaryRequests++;
      return Promise.resolve(jsonResponse(summary));
    }
    if (path.includes("/income-transfer-requirements/placement-preview")) {
      placementRequests++;
      return Promise.resolve(jsonResponse({}));
    }
    if (path.includes("/trial-balance/snapshots")) {
      snapshotRequests++;
      return new Promise<Response>((resolve) => { resolveSnapshots = resolve; });
    }
    if (path.endsWith("/budget/allocations/preview")) {
      previewBody = JSON.parse(String(init?.body));
      return Promise.resolve(jsonResponse({
        date: "2026-11-10", currency: "JPY", adjustment_total: 1,
        categories: [], allocatable_before: 100, allocatable_after: 101,
        token: "preview-token",
      }));
    }
    if (path.endsWith("/budget/allocations/batch")) {
      batchBody = JSON.parse(String(init?.body));
      return Promise.resolve(jsonResponse({ logs: [] }));
    }
    throw new Error(`Unexpected API request: ${path}`);
  }) as typeof fetch;

  try {
    await api.budget.summary("2026-11", undefined, "JPY");
    const placement = await api.incomeTransferRequirements.placementPreview("JPY");
    const snapshotsPending = api.trialBalance.listSnapshots();

    const input = {
      date: "2026-11-10",
      currency: "JPY",
      note: null,
      adjustments: [{ budget_category_id: 1, adhoc_delta: 1 }],
    };
    await api.budget.previewAdjustments(input);

    await expect(api.budget.summary("2026-11", undefined, "JPY")).resolves.toEqual(summary);
    await expect(api.incomeTransferRequirements.placementPreview("JPY")).resolves.toBe(placement);
    expect(api.trialBalance.listSnapshots()).toBe(snapshotsPending);
    expect(previewBody).toEqual(input);
    expect(summaryRequests).toBe(1);
    expect(placementRequests).toBe(1);
    expect(snapshotRequests).toBe(1);

    resolveSnapshots(jsonResponse([]));
    await snapshotsPending;

    await api.budget.applyAdjustments({
      ...input,
      note: "saved memo",
      preview_token: "preview-token",
    });
    expect(batchBody).toMatchObject({ note: "saved memo", preview_token: "preview-token" });
    await api.budget.summary("2026-11", undefined, "JPY");
    await api.incomeTransferRequirements.placementPreview("JPY");
    const freshSnapshots = api.trialBalance.listSnapshots();
    expect(summaryRequests).toBe(2);
    expect(placementRequests).toBe(2);
    expect(snapshotRequests).toBe(2);
    resolveSnapshots(jsonResponse([]));
    await freshSnapshots;
  } finally {
    globalThis.fetch = originalFetch;
    api.__testing.clearSessionCache();
  }
});
