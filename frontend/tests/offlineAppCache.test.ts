import { describe, expect, test } from "bun:test";

import type { BudgetSummary } from "@balance-sheet/shared";
import {
  getCachedTodayBudgetSummary,
  readOfflineAppCache,
  updateOfflineAppCache,
} from "../src/lib/offlineAppCache";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const summary: BudgetSummary = {
  year_month: "2026-07",
  currency: "JPY",
  monthly_income: 0,
  categories: [],
  total_budget: 10000,
  total_spent: 2500,
  total_available: 7500,
};

describe("offline app cache", () => {
  test("merges independently refreshed app data without dropping prior fields", () => {
    const storage = new MemoryStorage();
    updateOfflineAppCache({ enabledCurrencies: [] }, storage);
    updateOfflineAppCache(
      {
        todayBudget: {
          asOf: "2026-07-13",
          capturedAt: "2026-07-13T02:00:00.000Z",
          summary,
        },
      },
      storage,
    );

    const cache = readOfflineAppCache(storage);
    expect(cache?.enabledCurrencies).toEqual([]);
    expect(cache?.todayBudget?.summary.total_available).toBe(7500);
  });

  test("returns the snapshot only for the matching day and currency", () => {
    const storage = new MemoryStorage();
    updateOfflineAppCache(
      {
        todayBudget: {
          asOf: "2026-07-13",
          capturedAt: "2026-07-13T02:00:00.000Z",
          summary,
        },
      },
      storage,
    );

    expect(
      getCachedTodayBudgetSummary("2026-07-13", "jpy", storage)?.summary,
    ).toEqual(summary);
    expect(
      getCachedTodayBudgetSummary("2026-07-12", "JPY", storage),
    ).toBeNull();
    expect(
      getCachedTodayBudgetSummary("2026-07-13", "USD", storage),
    ).toBeNull();
  });
});
