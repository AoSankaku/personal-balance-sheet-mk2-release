import { useEffect, useState } from "react";
import type { SimpleFormDraft } from "../components/SimpleEntryForm";

const STORAGE_KEY = "balance-sheet:offline-drafts:v1";
const CHANGE_EVENT = "balance-sheet:offline-drafts-changed";

export interface OfflineDraft {
  id: string;
  createdAt: string;
  draft: SimpleFormDraft;
}

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function notifyChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

function parseDraft(value: unknown): OfflineDraft | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<OfflineDraft>;
  if (
    typeof item.id !== "string" ||
    typeof item.createdAt !== "string" ||
    !item.draft ||
    typeof item.draft !== "object"
  ) {
    return null;
  }

  const rawDate = item.draft.formValues?.date;
  const restoredDate =
    typeof rawDate === "string" || typeof rawDate === "number"
      ? new Date(rawDate)
      : rawDate;
  return {
    id: item.id,
    createdAt: item.createdAt,
    draft: {
      ...item.draft,
      formValues: {
        ...item.draft.formValues,
        ...(restoredDate instanceof Date && !Number.isNaN(restoredDate.valueOf())
          ? { date: restoredDate }
          : {}),
      },
    },
  };
}

export function getOfflineDrafts(
  storage: Storage | null = browserStorage(),
): OfflineDraft[] {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseDraft)
      .filter((item): item is OfflineDraft => item !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export function addOfflineDraft(
  draft: SimpleFormDraft,
  storage: Storage | null = browserStorage(),
  metadata: { id?: string; createdAt?: string } = {},
): OfflineDraft {
  const item: OfflineDraft = {
    id: metadata.id ?? crypto.randomUUID(),
    createdAt: metadata.createdAt ?? new Date().toISOString(),
    draft,
  };
  if (storage) {
    const next = [item, ...getOfflineDrafts(storage)];
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
    notifyChanged();
  }
  return item;
}

export function removeOfflineDraft(
  id: string,
  storage: Storage | null = browserStorage(),
) {
  if (!storage) return;
  const next = getOfflineDrafts(storage).filter((item) => item.id !== id);
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
  notifyChanged();
}

export function useOfflineDrafts(): OfflineDraft[] {
  const [drafts, setDrafts] = useState(getOfflineDrafts);

  useEffect(() => {
    const refresh = () => setDrafts(getOfflineDrafts());
    window.addEventListener(CHANGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("online", refresh);
    };
  }, []);

  return drafts;
}
