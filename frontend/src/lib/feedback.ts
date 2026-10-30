import {
  BOTTOM_NOTIFICATION_HISTORY_STORAGE_KEY,
  createBottomNotificationHistoryStore,
  type FeedbackHistoryColor,
} from "./bottomNotificationHistory";

type FeedbackColor = FeedbackHistoryColor;

export interface FeedbackContext {
  screen: string;
  path: string;
  action?: string;
  details?: string;
}

export interface FeedbackItem {
  id: number;
  message: string;
  color: FeedbackColor;
}

type FeedbackListener = () => void;

let current: FeedbackItem | null = null;
let timeoutId: number | null = null;
let nextId = 1;
const listeners = new Set<FeedbackListener>();
const history = createBottomNotificationHistoryStore();

export function captureFeedbackContext(input: Partial<FeedbackContext> = {}): FeedbackContext {
  const path = typeof window === "undefined"
    ? "/"
    : window.location.pathname + window.location.search;
  const tabs = typeof document === "undefined" ? [] : Array.from(
    document.querySelectorAll('[role="tab"][aria-selected="true"]'),
    tab => tab.textContent?.trim(),
  ).filter(Boolean);
  const screen = typeof document === "undefined" ? path :
    [document.title, ...tabs].filter(Boolean).join(" / ") || path;
  return { screen, path, ...input };
}

export function getFeedbackHistorySnapshot() {
  return history.getSnapshot();
}

export function subscribeFeedbackHistory(listener: FeedbackListener) {
  const unsubscribe = history.subscribe(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === BOTTOM_NOTIFICATION_HISTORY_STORAGE_KEY || event.key === null) {
      history.reload();
    }
  };
  history.reload();
  window.addEventListener("storage", onStorage);
  return () => {
    unsubscribe();
    window.removeEventListener("storage", onStorage);
  };
}

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeFeedback(listener: FeedbackListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getFeedbackSnapshot() {
  return current;
}

export function showFeedback(input: {
  message: string;
  color?: FeedbackColor;
  context?: Partial<FeedbackContext>;
}) {
  current = {
    id: nextId++,
    message: input.message,
    color: input.color ?? "blue",
  };
  const occurredAt = new Date().toISOString();
  history.append({
    id: globalThis.crypto?.randomUUID?.() ?? `${occurredAt}-${current.id}`,
    occurredAt,
    message: current.message,
    color: current.color,
    ...captureFeedbackContext(input.context),
  });
  emit();

  if (timeoutId != null) window.clearTimeout(timeoutId);
  timeoutId = window.setTimeout(() => {
    current = null;
    timeoutId = null;
    emit();
  }, 2600);
}

export function clearFeedback() {
  if (timeoutId != null) {
    window.clearTimeout(timeoutId);
    timeoutId = null;
  }
  current = null;
  emit();
}
