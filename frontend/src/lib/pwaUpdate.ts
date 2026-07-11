interface ServiceWorkerRegistrationLike {
  installing: unknown | null;
  waiting: unknown | null;
  update(): Promise<unknown>;
}

interface ServiceWorkerContainerLike {
  getRegistration(): Promise<ServiceWorkerRegistrationLike | undefined>;
  addEventListener(type: "controllerchange", listener: () => void): void;
  removeEventListener(type: "controllerchange", listener: () => void): void;
}

interface ReloadWithLatestServiceWorkerOptions {
  serviceWorker: ServiceWorkerContainerLike;
  reload: () => void;
  timeoutMs?: number;
}

const DEFAULT_ACTIVATION_TIMEOUT_MS = 8_000;

/**
 * Ask the browser to check for a new service worker and, when one is found,
 * wait until it controls this page before reloading. A normal reload remains
 * the fallback because browsers do not expose a cross-browser hard-reload API.
 */
export async function reloadWithLatestServiceWorker({
  serviceWorker,
  reload,
  timeoutMs = DEFAULT_ACTIVATION_TIMEOUT_MS,
}: ReloadWithLatestServiceWorkerOptions) {
  let controllerChanged = false;
  let resolveControllerChange: (() => void) | undefined;
  const controllerChange = new Promise<void>((resolve) => {
    resolveControllerChange = resolve;
  });
  const onControllerChange = () => {
    controllerChanged = true;
    resolveControllerChange?.();
  };

  serviceWorker.addEventListener("controllerchange", onControllerChange);

  try {
    const registration = await serviceWorker.getRegistration();
    if (!registration) return;

    await registration.update();

    if (
      !controllerChanged &&
      (registration.installing || registration.waiting)
    ) {
      await Promise.race([
        controllerChange,
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    }
  } catch {
    // Reloading is still the safest recovery if the update check itself fails.
  } finally {
    serviceWorker.removeEventListener("controllerchange", onControllerChange);
    reload();
  }
}

export function reloadAppWithLatestServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    window.location.reload();
    return Promise.resolve();
  }

  return reloadWithLatestServiceWorker({
    serviceWorker: navigator.serviceWorker,
    reload: () => window.location.reload(),
  });
}
