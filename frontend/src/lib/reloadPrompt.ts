export type ReloadPromptReason =
  | "cloudflare-access-session"
  | "app-version";

export interface ReloadPromptItem {
  reason: ReloadPromptReason;
  detectedAt: number;
  currentVersion?: string;
  latestVersion?: string;
}

type ReloadPromptListener = () => void;

const listeners = new Set<ReloadPromptListener>();
let current: ReloadPromptItem | null = null;

function emit() {
  for (const listener of listeners) listener();
}

function priority(reason: ReloadPromptReason) {
  return reason === "cloudflare-access-session" ? 2 : 1;
}

export function subscribeReloadPrompt(listener: ReloadPromptListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getReloadPromptSnapshot() {
  return current;
}

export function showReloadPrompt(input: Omit<ReloadPromptItem, "detectedAt">) {
  if (current && priority(current.reason) > priority(input.reason)) return;

  current = {
    ...input,
    detectedAt: Date.now(),
  };
  emit();
}

export function resetReloadPromptForTests() {
  current = null;
  emit();
}
