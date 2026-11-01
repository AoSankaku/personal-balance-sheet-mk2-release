import { describe, expect, test } from "bun:test";
import { createExpiringRequestCache } from "../src/api/expiringRequestCache";

describe("bounded fresh request sharing", () => {
  test("reuses fresh results and expires them at the deadline", async () => {
    let now = 0, requests = 0;
    const cache = createExpiringRequestCache<number>({ ttlMs: 100, now: () => now });
    const load = async () => ++requests;
    expect(cache.peek("JPY")).toBeNull();
    expect(await cache.get("JPY", load)).toBe(1);
    now = 99; expect(await cache.get("JPY", load)).toBe(1);
    now = 100; expect(cache.peek("JPY")).toBeNull();
    expect(await cache.get("JPY", load)).toBe(2);
  });

  test("shares pending refreshes, including concurrent force requests", async () => {
    const cache = createExpiringRequestCache<number>({ ttlMs: 100 });
    let resolve!: (value: number) => void;
    let count = 0;
    const load = () => { count++; return new Promise<number>(done => { resolve = done; }); };
    const first = cache.get("JPY", load, true);
    expect(cache.get("JPY", load, true)).toBe(first);
    resolve(42); await first; expect(count).toBe(1);
    expect(cache.peek("JPY")).toBe(42);
  });

  test("discards late results across invalidation without dropping a newer request", async () => {
    const cache = createExpiringRequestCache<number>({ ttlMs: 100 });
    let resolve!: (value: number) => void;
    const old = cache.get("JPY", () => new Promise<number>(done => { resolve = done; }));
    cache.invalidate();
    expect(await cache.get("JPY", async () => 2)).toBe(2);
    resolve(1); await old;
    expect(cache.peek("JPY")).toBe(2);
  });

  test("a failed request leaves no reusable failure or value", async () => {
    const cache = createExpiringRequestCache<number>({ ttlMs: 100 });
    await expect(cache.get("JPY", async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    expect(cache.peek("JPY")).toBeNull();
    expect(await cache.get("JPY", async () => 2)).toBe(2);
  });
});
