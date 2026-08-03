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
export const ACCESS_RECOVERY_QUERY_PARAM = "pwa_access_reauth";
export const VERSION_RELOAD_QUERY_PARAM = "pwa_version_reload";

function buildPwaReloadUrl(
  currentUrl: string,
  queryParam: string,
  cacheBust: number,
) {
  const url = new URL(currentUrl);
  url.searchParams.set(queryParam, String(cacheBust));
  return url.toString();
}

export function buildAccessRecoveryUrl(
  currentUrl: string,
  cacheBust: number = Date.now(),
) {
  return buildPwaReloadUrl(
    currentUrl,
    ACCESS_RECOVERY_QUERY_PARAM,
    cacheBust,
  );
}

export function buildVersionReloadUrl(
  currentUrl: string,
  cacheBust: number = Date.now(),
) {
  return buildPwaReloadUrl(currentUrl, VERSION_RELOAD_QUERY_PARAM, cacheBust);
}

export function removePwaReloadMarkers(currentUrl: string) {
  const url = new URL(currentUrl);
  url.searchParams.delete(ACCESS_RECOVERY_QUERY_PARAM);
  url.searchParams.delete(VERSION_RELOAD_QUERY_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function clearPwaReloadMarkersFromAddressBar() {
  const currentUrl = new URL(window.location.href);
  if (
    !currentUrl.searchParams.has(ACCESS_RECOVERY_QUERY_PARAM) &&
    !currentUrl.searchParams.has(VERSION_RELOAD_QUERY_PARAM)
  ) {
    return;
  }

  window.history.replaceState(
    window.history.state,
    "",
    removePwaReloadMarkers(currentUrl.toString()),
  );
}

export function reloadAppForAccessRecovery() {
  window.location.replace(buildAccessRecoveryUrl(window.location.href));
}

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
    reload: () =>
      window.location.replace(buildVersionReloadUrl(window.location.href)),
  });
}
