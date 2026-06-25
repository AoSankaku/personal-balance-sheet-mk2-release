export type PwaInstallOutcome = "accepted" | "dismissed";

export interface PwaInstallPromptEvent {
  preventDefault(): void;
  prompt(): Promise<void>;
  userChoice: Promise<{
    outcome: PwaInstallOutcome;
    platform: string;
  }>;
}

let installPrompt: PwaInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) listener();
}

export function captureInstallPrompt(event: PwaInstallPromptEvent): void {
  event.preventDefault();
  installPrompt = event;
  emitChange();
}

export function subscribePwaInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPwaInstallSnapshot(): boolean {
  return installPrompt !== null;
}

export async function requestPwaInstall(): Promise<PwaInstallOutcome | null> {
  const prompt = installPrompt;
  if (!prompt) return null;

  installPrompt = null;
  emitChange();
  await prompt.prompt();
  const choice = await prompt.userChoice;
  return choice.outcome;
}

export function resetPwaInstallStateForTests(): void {
  installPrompt = null;
  listeners.clear();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    captureInstallPrompt(event as unknown as PwaInstallPromptEvent);
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    emitChange();
  });
}
