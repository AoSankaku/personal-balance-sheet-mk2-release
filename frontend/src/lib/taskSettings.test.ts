import { describe, expect, test } from "bun:test";
import type { TaskSettings } from "@balance-sheet/shared";
import {
  DEFAULT_TASK_SETTINGS,
  migrateLegacyTaskSettingsIfNeeded,
  readLegacyTaskSettings,
} from "./taskSettings";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("task settings server migration", () => {
  test("converts every legacy device setting while preserving defaults", () => {
    const storage = new MemoryStorage();
    storage.setItem("notif:payday", "false");
    storage.setItem("notif:trialBalance", "true");
    storage.setItem("notif:trialBalanceDay", "18");
    storage.setItem("notif:loanOverdueDays", "45");

    expect(readLegacyTaskSettings(storage)).toEqual({
      ...DEFAULT_TASK_SETTINGS,
      payday_enabled: false,
      trial_balance_enabled: true,
      trial_balance_day: 18,
      loan_overdue_days: 45,
    });
  });

  test("normalizes invalid legacy numeric values", () => {
    const storage = new MemoryStorage();
    storage.setItem("notif:trialBalanceDay", "99");
    storage.setItem("notif:loanOverdueDays", "0");

    expect(readLegacyTaskSettings(storage)).toMatchObject({
      trial_balance_day: 1,
      loan_overdue_days: 30,
    });
  });

  test("uploads and removes legacy keys only when the server is unconfigured", async () => {
    const storage = new MemoryStorage();
    storage.setItem("notif:trialBalance", "true");
    const serverSettings: TaskSettings = {
      ...DEFAULT_TASK_SETTINGS,
      configured: false,
      updated_at: null,
    };
    const saved: unknown[] = [];

    const migrated = await migrateLegacyTaskSettingsIfNeeded(
      serverSettings,
      storage,
      async (input) => {
        saved.push(input);
        return {
          ...serverSettings,
          ...input,
          configured: true,
          updated_at: "2026-07-15 12:00:00",
        };
      },
    );

    expect(saved).toHaveLength(1);
    expect(migrated.configured).toBe(true);
    expect(migrated.trial_balance_enabled).toBe(true);
    expect(storage.getItem("notif:trialBalance")).toBeNull();
  });

  test("keeps configured server settings authoritative", async () => {
    const storage = new MemoryStorage();
    storage.setItem("notif:trialBalance", "true");
    const serverSettings: TaskSettings = {
      ...DEFAULT_TASK_SETTINGS,
      configured: true,
      updated_at: "2026-07-15 12:00:00",
    };
    let saveCount = 0;

    const resolved = await migrateLegacyTaskSettingsIfNeeded(
      serverSettings,
      storage,
      async () => {
        saveCount += 1;
        return serverSettings;
      },
    );

    expect(resolved).toBe(serverSettings);
    expect(saveCount).toBe(0);
  });
});
