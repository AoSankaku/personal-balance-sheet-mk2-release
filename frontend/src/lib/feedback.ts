type FeedbackColor = "teal" | "red" | "orange" | "yellow" | "blue" | "gray";

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
}) {
  current = {
    id: nextId++,
    message: input.message,
    color: input.color ?? "blue",
  };
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
