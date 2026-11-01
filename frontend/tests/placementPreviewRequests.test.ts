import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { api } from "../src/api/client";

const realFetch = globalThis.fetch;
beforeEach(() => api.__testing.clearSessionCache());
afterEach(() => { globalThis.fetch = realFetch; api.__testing.clearSessionCache(); setSystemTime(); });
const preview = (token: string, currency = "JPY") => Response.json({ token, currency });

describe("placement preview request sharing", () => {
  test("shares concurrent consumers and repeated navigation reads", async () => {
    let count = 0;
    globalThis.fetch = (async () => preview(`token-${++count}`)) as typeof fetch;
    const concurrent = await Promise.all(Array.from({ length: 3 }, () => api.incomeTransferRequirements.placementPreview("JPY")));
    for (let i = 0; i < 6; i++) await api.incomeTransferRequirements.placementPreview("JPY");
    expect(count).toBe(1);
    expect(concurrent.every(item => item.token === "token-1")).toBe(true);
  });

  test("explicit refresh bypasses settled data, then shares the new result", async () => {
    let count = 0;
    globalThis.fetch = (async () => preview(`token-${++count}`)) as typeof fetch;
    await api.incomeTransferRequirements.placementPreview("JPY");
    await api.incomeTransferRequirements.placementPreview("JPY");
    expect((await api.incomeTransferRequirements.placementPreview("JPY", { force: true })).token).toBe("token-2");
    expect((await api.incomeTransferRequirements.placementPreview("JPY")).token).toBe("token-2");
    expect(count).toBe(2);
  });

  test.each([
    ["journal", () => api.journal.create({ date: "2026-11-02", description: "test", lines: [] })],
    ["deferral", () => api.incomeTransferRequirements.defer(1, true)],
    ["raw credit-card mutation", () => api.creditCardSettings.delete(1)],
    ["raw depreciation mutation", () => api.depreciation.delete(1)],
  ] as const)("refreshes after %s without relying only on budget revision", async (_label, mutate) => {
    let count = 0;
    globalThis.fetch = (async (_input, init) => init?.method && init.method !== "GET"
      ? Response.json({ ok: true }) : preview(`token-${++count}`)) as typeof fetch;
    await api.incomeTransferRequirements.placementPreview("JPY");
    await api.incomeTransferRequirements.placementPreview("JPY");
    await mutate();
    expect((await api.incomeTransferRequirements.placementPreview("JPY")).token).toBe("token-2");
    expect(count).toBe(2);
  });

  test("an old in-flight read cannot repopulate the cache after a mutation", async () => {
    let resolveOld!: (response: Response) => void;
    const oldResponse = new Promise<Response>(resolve => { resolveOld = resolve; });
    let count = 0;
    globalThis.fetch = (async (_input, init) => {
      if (init?.method === "PATCH") return Response.json({ ok: true });
      return ++count === 1 ? oldResponse : preview("fresh");
    }) as typeof fetch;
    const old = api.incomeTransferRequirements.placementPreview("JPY");
    await api.incomeTransferRequirements.defer(1, true);
    expect((await api.incomeTransferRequirements.placementPreview("JPY")).token).toBe("fresh");
    resolveOld(preview("old")); await old;
    expect((await api.incomeTransferRequirements.placementPreview("JPY")).token).toBe("fresh");
    expect(count).toBe(2);
  });

  test("keeps currency and local-day scopes separate", async () => {
    let count = 0;
    globalThis.fetch = (async () => preview(`token-${++count}`)) as typeof fetch;
    setSystemTime(new Date(2026, 10, 2, 23, 59, 59));
    await api.incomeTransferRequirements.placementPreview("jpy");
    await api.incomeTransferRequirements.placementPreview("JPY");
    await api.incomeTransferRequirements.placementPreview("USD");
    expect(count).toBe(2);
    setSystemTime(new Date(2026, 10, 3, 0, 0, 1));
    await api.incomeTransferRequirements.placementPreview("JPY");
    expect(count).toBe(3);
  });

  test("does not cache errors and can retry successfully", async () => {
    let count = 0;
    globalThis.fetch = (async () => ++count === 1
      ? Response.json({ error: "unavailable" }, { status: 503 }) : preview("retry")) as typeof fetch;
    await expect(api.incomeTransferRequirements.placementPreview("JPY")).rejects.toThrow("unavailable");
    expect((await api.incomeTransferRequirements.placementPreview("JPY")).token).toBe("retry");
    await api.incomeTransferRequirements.placementPreview("JPY");
    expect(count).toBe(2);
  });
});
