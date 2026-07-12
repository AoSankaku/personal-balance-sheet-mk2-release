import { beforeEach, describe, expect, test } from "bun:test";

import type { SimpleFormDraft } from "../src/components/SimpleEntryForm";
import {
  addOfflineDraft,
  getOfflineDrafts,
  removeOfflineDraft,
} from "../src/lib/offlineDrafts";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("offline input drafts", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  test("persists a validated simple-entry draft and restores its date", () => {
    const draft: SimpleFormDraft = {
      formValues: {
        date: new Date(2026, 6, 13),
        entryType: "expense",
        description: "Offline groceries",
        amount: 4200,
        expenseCategoryId: 12,
        expensePaidFromId: 3,
      },
      budgetDist: [],
      showZeroCategories: false,
    };

    const saved = addOfflineDraft(draft, storage, {
      id: "draft-1",
      createdAt: "2026-07-13T03:00:00.000Z",
    });
    const restored = getOfflineDrafts(storage);

    expect(saved.id).toBe("draft-1");
    expect(restored).toHaveLength(1);
    expect(restored[0]?.draft.formValues.date).toBeInstanceOf(Date);
    expect(restored[0]?.draft.formValues.description).toBe(
      "Offline groceries",
    );
  });

  test("keeps multiple drafts newest-first and removes only the selected one", () => {
    const baseDraft: SimpleFormDraft = {
      formValues: { entryType: "expense", amount: 100 },
      budgetDist: [],
      showZeroCategories: false,
    };
    addOfflineDraft(baseDraft, storage, {
      id: "older",
      createdAt: "2026-07-13T01:00:00.000Z",
    });
    addOfflineDraft(baseDraft, storage, {
      id: "newer",
      createdAt: "2026-07-13T02:00:00.000Z",
    });

    expect(getOfflineDrafts(storage).map((item) => item.id)).toEqual([
      "newer",
      "older",
    ]);

    removeOfflineDraft("newer", storage);
    expect(getOfflineDrafts(storage).map((item) => item.id)).toEqual([
      "older",
    ]);
  });

  test("ignores malformed local data instead of blocking the app", () => {
    storage.setItem("balance-sheet:offline-drafts:v1", "not-json");
    expect(getOfflineDrafts(storage)).toEqual([]);
  });
});
