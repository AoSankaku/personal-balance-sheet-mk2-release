import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { api, ApiError } from "../src/api/client";
import { isD1LimitErrorBody } from "../../shared/d1Limits";
import {
  clearD1LimitNotice, getD1LimitErrorMessage, getD1LimitNoticeSnapshot, reportD1Limit, subscribeD1LimitNotice,
} from "../src/lib/d1LimitNotice";
import { tForLocale } from "../src/i18n/translate";
import { getReloadPromptSnapshot, resetReloadPromptForTests, showReloadPrompt } from "../src/lib/reloadPrompt";

const readLimit = { error: "d1_limit_exceeded", limit_type: "daily_read", retry_at: "2026-11-11T00:00:00.000Z" } as const;
const originalFetch = globalThis.fetch;
const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

beforeEach(() => {
  api.__testing.clearSessionCache();
  clearD1LimitNotice();
  resetReloadPromptForTests();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  api.__testing.clearSessionCache();
  if (originalLocalStorageDescriptor) Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
  else Reflect.deleteProperty(globalThis, "localStorage");
  clearD1LimitNotice();
  resetReloadPromptForTests();
});

describe("D1 limit contract and notice", () => {
  test("validates supported limits without accepting arbitrary 503 bodies", () => {
    expect(isD1LimitErrorBody(readLimit)).toBe(true);
    expect(isD1LimitErrorBody({ ...readLimit, limit_type: "daily_write" })).toBe(true);
    expect(isD1LimitErrorBody({ ...readLimit, limit_type: "requests_per_invocation", retry_at: null })).toBe(true);
    for (const body of [null, {}, { error: "internal_server_error" }, { ...readLimit, limit_type: "other" }, { ...readLimit, retry_at: "tomorrow" }]) {
      expect(isD1LimitErrorBody(body)).toBe(false);
    }
  });

  test("deduplicates simultaneous failures and supports dismissal and unsubscribe", () => {
    let events = 0;
    const unsubscribe = subscribeD1LimitNotice(() => { events++; });
    reportD1Limit(readLimit);
    reportD1Limit({ ...readLimit });
    expect(events).toBe(1);
    expect(getD1LimitNoticeSnapshot()).toMatchObject(readLimit);
    reportD1Limit({ ...readLimit, limit_type: "daily_write" });
    expect(events).toBe(2);
    clearD1LimitNotice();
    expect(getD1LimitNoticeSnapshot()).toBeNull();
    expect(events).toBe(3);
    unsubscribe();
    reportD1Limit(readLimit);
    expect(events).toBe(3);
  });
});

describe("API D1 limit detection", () => {
  test("raises a typed error, notifies once, and never automatically replays a write", async () => {
    let requests = 0;
    globalThis.fetch = (async () => { requests++; return Response.json(readLimit, { status: 503 }); }) as typeof fetch;
    await expect(api.accounts.create({ name: "Test", type: "asset", category: "cash" } as never)).rejects.toMatchObject({
      name: "ApiError", message: tForLocale("d1LimitError", "ja"), status: 503, body: readLimit,
    });
    expect(getD1LimitNoticeSnapshot()).toMatchObject(readLimit);
    expect(requests).toBe(1);
  });

  test("uses the stored locale and safely falls back to Japanese when storage is unavailable", async () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { getItem: () => "en" },
    });
    expect(getD1LimitErrorMessage()).toBe(tForLocale("d1LimitError", "en"));

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() { throw new Error("storage unavailable"); },
    });
    expect(getD1LimitErrorMessage()).toBe(tForLocale("d1LimitError", "ja"));
  });

  test("handles a quota JSON response on a normally binary download", async () => {
    globalThis.fetch = (async () => Response.json(readLimit, { status: 503 })) as typeof fetch;
    await expect(api.admin.exportDb()).rejects.toBeInstanceOf(ApiError);
    expect(getD1LimitNoticeSnapshot()).toMatchObject(readLimit);
  });

  test("preserves ordinary API errors and successful download bodies", async () => {
    globalThis.fetch = (async () => Response.json({ error: "maintenance" }, { status: 503 })) as typeof fetch;
    await expect(api.accounts.list()).rejects.toMatchObject({ message: "maintenance", status: 503 });
    expect(getD1LimitNoticeSnapshot()).toBeNull();
    globalThis.fetch = (async () => new Response("SQLite fixture bytes", { headers: { "Content-Type": "application/x-sqlite3" } })) as typeof fetch;
    expect(await (await api.admin.exportDb()).text()).toBe("SQLite fixture bytes");
  });

  test("does not misclassify a successful JSON payload or network failure", async () => {
    globalThis.fetch = (async () => Response.json(readLimit)) as typeof fetch;
    await api.accounts.list();
    expect(getD1LimitNoticeSnapshot()).toBeNull();
    globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
    await expect(api.admin.exportDb()).rejects.toMatchObject({ message: "network_offline" });
    expect(getD1LimitNoticeSnapshot()).toBeNull();
  });

  test("keeps Access recovery separate and does not force reload for a D1 limit", async () => {
    showReloadPrompt({ reason: "cloudflare-access-session" });
    globalThis.fetch = (async () => Response.json(readLimit, { status: 503 })) as typeof fetch;
    await expect(api.admin.exportDb()).rejects.toBeInstanceOf(ApiError);
    expect(getReloadPromptSnapshot()?.reason).toBe("cloudflare-access-session");
    expect(getD1LimitNoticeSnapshot()).toMatchObject(readLimit);
  });
});

test("all supported locales supply D1 guidance without an English fallback", () => {
  const keys = ["d1LimitTitle", "d1DailyReadLimitMessage", "d1DailyWriteLimitMessage", "d1RequestLimitMessage", "d1LimitRetryAt", "d1LimitSaveWarning", "d1LimitError"];
  const english = parse(readFileSync(new URL("../src/i18n/locales/en.yaml", import.meta.url), "utf8"));
  for (const locale of ["en", "ja", "fr", "es", "zh-CN", "zh-TW"]) {
    const values = parse(readFileSync(new URL(`../src/i18n/locales/${locale}.yaml`, import.meta.url), "utf8"));
    for (const key of keys) {
      expect(typeof values[key]).toBe("string");
      expect(values[key].length).toBeGreaterThan(0);
      if (locale !== "en") expect(values[key]).not.toBe(english[key]);
    }
  }
});
