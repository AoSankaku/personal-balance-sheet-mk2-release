import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { api, ApiError } from "../src/api/client";
import {
  getReloadPromptSnapshot,
  resetReloadPromptForTests,
} from "../src/lib/reloadPrompt";
import {
  isLikelyCloudflareAccessResponse,
  shouldPromptForNewVersion,
} from "../src/lib/appVersion";

const frontendRoot = join(import.meta.dir, "..");

describe("hard reload prompt detection", () => {
  beforeEach(() => {
    resetReloadPromptForTests();
  });

  test("detects Cloudflare Access login HTML returned for an API request", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        "<!doctype html><title>Cloudflare Access</title><body>Sign in</body>",
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      );

    try {
      await expect(api.accounts.list()).rejects.toThrow(ApiError);
      expect(getReloadPromptSnapshot()?.reason).toBe(
        "cloudflare-access-session",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not treat ordinary JSON API errors as Cloudflare Access expiry", () => {
    expect(
      isLikelyCloudflareAccessResponse({
        status: 403,
        redirected: false,
        url: "https://example.com/api/admin/erase",
        contentType: "application/json",
        bodyText: '{"error":"admin_api_disabled"}',
      }),
    ).toBe(false);
  });

  test("detects a newer deployed app version", () => {
    expect(shouldPromptForNewVersion("2026.6.0-beta0", "2026.6.0-beta1")).toBe(
      true,
    );
    expect(shouldPromptForNewVersion("2026.6.0-beta0", "2026.6.0-beta0")).toBe(
      false,
    );
    expect(shouldPromptForNewVersion("2026.6.0-beta0", "")).toBe(false);
  });

  test("emits version.json from the Vite build using version.ts", () => {
    const configSource = readFileSync(
      join(frontendRoot, "vite.config.ts"),
      "utf8",
    );

    expect(configSource).toContain("versionAssetPlugin()");
    expect(configSource).toContain("version.json");
    expect(configSource).toContain("src/lib/version.ts");
  });
});
