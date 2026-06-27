import { VERSION } from "./version";
import { showReloadPrompt } from "./reloadPrompt";

export interface AccessResponseProbe {
  status: number;
  redirected: boolean;
  url: string;
  contentType: string;
  bodyText: string;
}

export interface VersionPayload {
  version: string;
}

export function isLikelyCloudflareAccessResponse(
  probe: AccessResponseProbe,
) {
  const url = probe.url.toLowerCase();
  const contentType = probe.contentType.toLowerCase();
  const body = probe.bodyText.slice(0, 4096).toLowerCase();

  if (url.includes("/cdn-cgi/access/")) return true;
  if (body.includes("cloudflare access")) return true;
  if (body.includes("cf-access")) return true;

  const isHtml = contentType.includes("text/html") || body.includes("<html");
  return probe.redirected && isHtml && !url.includes("/api/");
}

export function shouldPromptForNewVersion(
  currentVersion: string,
  latestVersion: string | null | undefined,
) {
  return Boolean(latestVersion && latestVersion !== currentVersion);
}

export function isVersionPayload(value: unknown): value is VersionPayload {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as { version?: unknown }).version === "string"
  );
}

export async function fetchLatestAppVersion(
  fetcher: typeof fetch = fetch,
  cacheBust: number = Date.now(),
) {
  const response = await fetcher(`/version.json?t=${cacheBust}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.toLowerCase().includes("application/json")) {
    return null;
  }

  const payload = await response.json().catch(() => null);
  return isVersionPayload(payload) ? payload.version : null;
}

export async function checkForNewAppVersion(fetcher: typeof fetch = fetch) {
  const latestVersion = await fetchLatestAppVersion(fetcher);
  if (!shouldPromptForNewVersion(VERSION, latestVersion)) return false;

  showReloadPrompt({
    reason: "app-version",
    currentVersion: VERSION,
    latestVersion: latestVersion ?? undefined,
  });
  return true;
}
