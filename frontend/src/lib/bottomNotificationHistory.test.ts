import { describe, expect, test } from "bun:test";
import {
  BOTTOM_NOTIFICATION_HISTORY_LIMIT,
  BOTTOM_NOTIFICATION_HISTORY_STORAGE_KEY,
  createBottomNotificationHistoryStore,
} from "./bottomNotificationHistory";

function memoryStorage(initial: string | null = null) {
  let value = initial;
  let failWrites = false;
  let failReads = false;
  return {
    get value() { return value; },
    setFailWrites(fail: boolean) { failWrites = fail; },
    setFailReads(fail: boolean) { failReads = fail; },
    getItem: (_key: string) => {
      if (failReads) throw new Error("storage is unavailable");
      return value;
    },
    setItem: (_key: string, next: string) => {
      if (failWrites) throw new Error("storage quota exceeded");
      value = next;
    },
  };
}

function notification(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `notification-${index}`,
    occurredAt: new Date(Date.UTC(2026, 7, 1, 0, index)).toISOString(),
    message: `Notice ${index}`,
    color: "red" as const,
    screen: "Ledger | Balance Sheet",
    path: "/ledger",
    ...overrides,
  };
}

describe("bottom notification history", () => {
  test("retains and persists only the newest 50 notices", () => {
    const storage = memoryStorage();
    const store = createBottomNotificationHistoryStore(storage);
    for (let index = 0; index < 75; index += 1) store.append(notification(index));

    const history = store.getSnapshot();
    expect(history).toHaveLength(BOTTOM_NOTIFICATION_HISTORY_LIMIT);
    expect(history[0]?.id).toBe("notification-74");
    expect(history.at(-1)?.id).toBe("notification-25");
    expect(JSON.parse(storage.value ?? "null")).toEqual(history);

    store.reload();
    expect(store.getSnapshot()).toHaveLength(50);
    expect(store.getSnapshot().at(-1)?.id).toBe("notification-25");
  });

  test("restores the latest notices after reload while preserving screen and action details", () => {
    const storage = memoryStorage();
    const first = createBottomNotificationHistoryStore(storage);
    const item = notification(1, {
      message: "The entry was saved but the card statement could not be completed.",
      color: "yellow",
      screen: "Bulk entry / CSV import",
      path: "/input?tab=bulk",
      action: "Visa • 2026-08 statement completion after CSV import",
      details: "The statement completion request failed.",
    });
    first.append(item);

    const second = createBottomNotificationHistoryStore(storage);
    expect(second.getSnapshot()).toEqual([item]);
  });

  test("returns a stable read-only snapshot until its contents change", () => {
    const store = createBottomNotificationHistoryStore(null);
    const initial = store.getSnapshot();
    expect(store.getSnapshot()).toBe(initial);
    store.append(notification(1));

    const updated = store.getSnapshot();
    expect(updated).not.toBe(initial);
    expect(initial).toEqual([]);
    expect(() => (updated as unknown as unknown[]).push(notification(2))).toThrow();
    expect(store.getSnapshot()).toBe(updated);
  });

  test("notifies only after a changed history and supports subscription cleanup", () => {
    const store = createBottomNotificationHistoryStore(null);
    let changes = 0;
    const unsubscribe = store.subscribe(() => { changes += 1; });
    store.append(notification(1));
    expect(changes).toBe(1);
    store.reload();
    expect(changes).toBe(1);
    unsubscribe();
    store.append(notification(2));
    expect(changes).toBe(1);
  });

  test("ignores corrupt storage and rejects unsafe or malformed notices", () => {
    const corrupt = createBottomNotificationHistoryStore(memoryStorage("{invalid"));
    expect(corrupt.getSnapshot()).toEqual([]);

    const storage = memoryStorage();
    const store = createBottomNotificationHistoryStore(storage);
    store.append(notification(1, { path: "//outside.example" }));
    store.append(notification(2, { path: "javascript:alert(1)" }));
    store.append(notification(3, { message: "" }));
    store.append(notification(4, { color: "purple" }));
    store.append(notification(5, { occurredAt: "not a date" }));
    store.append(notification(6, { screen: "" }));
    expect(store.getSnapshot()).toEqual([]);
  });

  test("prunes malformed rows and restores only the newest 50 saved rows", () => {
    const saved = [
      ...Array.from({ length: 60 }, (_, index) => notification(index)),
      { message: "missing id" },
    ];
    const storage = memoryStorage(JSON.stringify(saved));
    const store = createBottomNotificationHistoryStore(storage);

    expect(store.getSnapshot()).toHaveLength(50);
    expect(store.getSnapshot()[0]?.id).toBe("notification-59");
    expect(JSON.parse(storage.value ?? "null")).toHaveLength(50);
  });

  test("preserves live notices when browser storage reads or writes fail", () => {
    const storage = memoryStorage();
    const store = createBottomNotificationHistoryStore(storage);
    storage.setFailWrites(true);
    store.append(notification(1));
    expect(store.getSnapshot()).toEqual([notification(1)]);

    storage.setFailWrites(false);
    storage.setFailReads(true);
    store.append(notification(2));
    expect(store.getSnapshot().map(item => item.id)).toEqual([
      "notification-2", "notification-1",
    ]);
  });

  test("keeps notices created during a write failure when history reloads", () => {
    const storage = memoryStorage();
    const store = createBottomNotificationHistoryStore(storage);
    store.append(notification(1));

    storage.setFailWrites(true);
    const warning = notification(2, {
      message: "The entry was saved but statement completion failed.",
      details: "Complete the statement later.",
    });
    store.append(warning);
    store.reload();

    expect(store.getSnapshot()).toEqual([warning, notification(1)]);
    expect(store.getSnapshot()).toHaveLength(2);
    expect(store.getSnapshot().length).toBeLessThanOrEqual(50);
  });

  test("merges interleaved writes from multiple tabs by id and time", () => {
    const storage = memoryStorage();
    const first = createBottomNotificationHistoryStore(storage);
    const second = createBottomNotificationHistoryStore(storage);
    first.append(notification(1));
    second.append(notification(2));
    first.append(notification(3));

    expect(first.getSnapshot().map(item => item.id)).toEqual([
      "notification-3", "notification-2", "notification-1",
    ]);
    expect(JSON.parse(storage.value ?? "null").map((item: { id: string }) => item.id)).toEqual([
      "notification-3", "notification-2", "notification-1",
    ]);
  });

  test("deduplicates ids and lets the newest append replace earlier details", () => {
    const store = createBottomNotificationHistoryStore(null);
    store.append(notification(1, { id: "same-id", message: "Earlier copy" }));
    store.append(notification(2, { id: "same-id", message: "Latest copy" }));

    expect(store.getSnapshot()).toEqual([
      notification(2, { id: "same-id", message: "Latest copy" }),
    ]);
  });

  test("exports a versioned browser-local storage key", () => {
    expect(BOTTOM_NOTIFICATION_HISTORY_STORAGE_KEY).toBe(
      "balance-sheet:bottom-notification-history:v1",
    );
  });
});
