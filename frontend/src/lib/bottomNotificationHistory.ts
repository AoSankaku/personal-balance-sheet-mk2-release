export type FeedbackHistoryColor = "teal" | "red" | "orange" | "yellow" | "blue" | "gray";

export interface BottomNotificationHistoryItem {
  readonly id: string;
  readonly occurredAt: string;
  readonly message: string;
  readonly color: FeedbackHistoryColor;
  readonly screen: string;
  readonly path: string;
  readonly action?: string;
  readonly details?: string;
}

export const BOTTOM_NOTIFICATION_HISTORY_LIMIT = 50;
export const BOTTOM_NOTIFICATION_HISTORY_STORAGE_KEY =
  "balance-sheet:bottom-notification-history:v1";

type HistoryStorage = Pick<Storage, "getItem" | "setItem">;
type Listener = () => void;

const feedbackHistoryColors = new Set<FeedbackHistoryColor>([
  "teal",
  "red",
  "orange",
  "yellow",
  "blue",
  "gray",
]);

function normalizeItem(value: unknown): BottomNotificationHistoryItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const candidate = value as Record<string, unknown>;
  const { id, occurredAt, message, color, screen, path, action, details } = candidate;
  if (
    typeof id !== "string" || id.trim().length === 0 ||
    typeof occurredAt !== "string" || !isIsoTimestamp(occurredAt) ||
    typeof message !== "string" || message.trim().length === 0 ||
    typeof color !== "string" || !feedbackHistoryColors.has(color as FeedbackHistoryColor) ||
    typeof screen !== "string" || screen.trim().length === 0 ||
    typeof path !== "string" || !isSafeInternalPath(path) ||
    (action !== undefined && typeof action !== "string") ||
    (details !== undefined && typeof details !== "string")
  ) {
    return null;
  }

  const item: BottomNotificationHistoryItem = {
    id,
    occurredAt: new Date(occurredAt).toISOString(),
    message,
    color: color as FeedbackHistoryColor,
    screen,
    path,
    ...(action === undefined ? {} : { action }),
    ...(details === undefined ? {} : { details }),
  };
  return Object.freeze(item);
}

function isIsoTimestamp(value: string): boolean {
  // Notifications are created with toISOString(), but accept other ISO 8601
  // timezone offsets and normalize them to UTC when stored.
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/,
  );
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const daysInMonth = month === 2
    ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28)
    : ([4, 6, 9, 11].includes(month) ? 30 : 31);
  if (
    month < 1 || month > 12 || day < 1 || day > daysInMonth ||
    hour > 23 || minute > 59 || second > 59 ||
    (offsetHourText !== undefined && Number(offsetHourText) > 23) ||
    (offsetMinuteText !== undefined && Number(offsetMinuteText) > 59)
  ) return false;
  return Number.isFinite(Date.parse(value));
}

function isSafeInternalPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(path);
}

function makeSnapshot(items: readonly BottomNotificationHistoryItem[]) {
  return Object.freeze([...items]);
}

function mergeItems(
  candidates: readonly (BottomNotificationHistoryItem | null)[],
): BottomNotificationHistoryItem[] {
  const byId = new Map<string, BottomNotificationHistoryItem>();
  for (const candidate of candidates) {
    if (candidate && !byId.has(candidate.id)) byId.set(candidate.id, candidate);
  }

  return [...byId.values()]
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
    .slice(0, BOTTOM_NOTIFICATION_HISTORY_LIMIT);
}

function sameItems(
  left: readonly BottomNotificationHistoryItem[],
  right: readonly BottomNotificationHistoryItem[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const other = right[index];
    return !!other && item.id === other.id && item.occurredAt === other.occurredAt &&
      item.message === other.message && item.color === other.color &&
      item.screen === other.screen && item.path === other.path &&
      item.action === other.action && item.details === other.details;
  });
}

export function createBottomNotificationHistoryStore(
  storage?: HistoryStorage | null,
) {
  let snapshot: readonly BottomNotificationHistoryItem[] | undefined;
  const pendingUnsaved = new Map<string, BottomNotificationHistoryItem>();
  const listeners = new Set<Listener>();

  function resolveStorage(): HistoryStorage | null {
    if (storage !== undefined) return storage;
    try {
      return typeof window === "undefined" ? null : window.localStorage;
    } catch {
      return null;
    }
  }

  function readPersisted(): {
    readable: boolean;
    raw: string | null;
    items: BottomNotificationHistoryItem[];
  } {
    const resolved = resolveStorage();
    if (!resolved) return { readable: false, raw: null, items: [] };

    try {
      const raw = resolved.getItem(BOTTOM_NOTIFICATION_HISTORY_STORAGE_KEY);
      if (raw === null) return { readable: true, raw, items: [] };

      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        return { readable: true, raw, items: [] };
      }
      if (!Array.isArray(value)) return { readable: true, raw, items: [] };

      return {
        readable: true,
        raw,
        items: mergeItems(value.map(normalizeItem)),
      };
    } catch {
      return { readable: false, raw: null, items: [] };
    }
  }

  function persist(items: readonly BottomNotificationHistoryItem[]): boolean {
    const resolved = resolveStorage();
    if (!resolved) return false;
    try {
      resolved.setItem(BOTTOM_NOTIFICATION_HISTORY_STORAGE_KEY, JSON.stringify(items));
      return true;
    } catch {
      // Keep the in-memory history usable when storage is disabled or full.
      return false;
    }
  }

  function persistIfChanged(
    items: readonly BottomNotificationHistoryItem[],
    raw: string | null,
  ): boolean {
    if (raw === JSON.stringify(items)) return true;
    return persist(items);
  }

  function rememberPending(items: readonly BottomNotificationHistoryItem[]): void {
    pendingUnsaved.clear();
    for (const item of items) pendingUnsaved.set(item.id, item);
  }

  function notify(): void {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // One subscriber must not prevent other subscribers from observing updates.
      }
    }
  }

  function install(items: readonly BottomNotificationHistoryItem[]): boolean {
    if (snapshot && sameItems(snapshot, items)) return false;
    snapshot = makeSnapshot(items);
    notify();
    return true;
  }

  function ensureLoaded(): readonly BottomNotificationHistoryItem[] {
    if (snapshot) return snapshot;
    const persisted = readPersisted();
    const initial = persisted.readable ? persisted.items : [];
    snapshot = makeSnapshot(initial);
    if (persisted.readable) persistIfChanged(snapshot, persisted.raw);
    return snapshot;
  }

  return {
    getSnapshot(): readonly BottomNotificationHistoryItem[] {
      return ensureLoaded();
    },

    append(value: BottomNotificationHistoryItem): void {
      const newest = normalizeItem(value);
      if (!newest) return;

      const current = ensureLoaded();
      const persisted = readPersisted();
      const merged = mergeItems([
        newest,
        ...current,
        ...(persisted.readable ? persisted.items : []),
      ]);
      install(merged);
      // If reads fail, avoid replacing storage with a partial in-memory merge.
      // Keep the visible snapshot pending until a later write succeeds.
      const saved = persisted.readable && persistIfChanged(merged, persisted.raw);
      if (saved) pendingUnsaved.clear();
      else rememberPending(merged);
    },

    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    reload(): void {
      const persisted = readPersisted();
      if (!persisted.readable) return;
      const merged = mergeItems([
        ...pendingUnsaved.values(),
        ...persisted.items,
      ]);
      install(merged);
      const saved = persistIfChanged(merged, persisted.raw);
      if (saved) pendingUnsaved.clear();
      else rememberPending(merged);
    },
  };
}
