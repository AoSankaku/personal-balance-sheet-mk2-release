import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  captureInstallPrompt,
  getPwaInstallSnapshot,
  requestPwaInstall,
  resetPwaInstallStateForTests,
  subscribePwaInstall,
} from "../src/lib/pwaInstall";

const frontendRoot = join(import.meta.dir, "..");

describe("PWA install prompt state", () => {
  beforeEach(() => {
    resetPwaInstallStateForTests();
  });

  test("captures beforeinstallprompt and exposes install availability", () => {
    let prevented = false;
    let notified = 0;
    const unsubscribe = subscribePwaInstall(() => {
      notified += 1;
    });

    captureInstallPrompt({
      preventDefault: () => {
        prevented = true;
      },
      prompt: async () => undefined,
      userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" }),
    });

    expect(prevented).toBe(true);
    expect(getPwaInstallSnapshot()).toBe(true);
    expect(notified).toBe(1);
    unsubscribe();
  });

  test("opens the browser install dialog and consumes the prompt", async () => {
    let prompted = 0;
    captureInstallPrompt({
      preventDefault: () => undefined,
      prompt: async () => {
        prompted += 1;
      },
      userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
    });

    const result = await requestPwaInstall();

    expect(prompted).toBe(1);
    expect(result).toBe("accepted");
    expect(getPwaInstallSnapshot()).toBe(false);
  });

  test("exposes installation only from the settings page", () => {
    const appSource = readFileSync(join(frontendRoot, "src/App.tsx"), "utf8");
    const settingsSource = readFileSync(
      join(frontendRoot, "src/pages/SettingsPage.tsx"),
      "utf8",
    );

    expect(appSource).not.toContain("<PwaInstallPrompt");
    expect(settingsSource).toContain("<PwaInstallSetting");
  });

  test("opens the native prompt only from the settings button click handler", () => {
    const componentSource = readFileSync(
      join(frontendRoot, "src/components/PwaInstallSetting.tsx"),
      "utf8",
    );
    const japaneseLocale = readFileSync(
      join(frontendRoot, "src/i18n/locales/ja.yaml"),
      "utf8",
    );

    expect(componentSource).toContain("onClick={install}");
    expect(componentSource).toMatch(
      /async function install\(\)[\s\S]*await requestPwaInstall\(\)/,
    );
    expect(japaneseLocale).toContain(
      "pwaInstallButton: PWAとしてインストール",
    );
  });

  test("places the install button below preferred payment accounts", () => {
    const settingsSource = readFileSync(
      join(frontendRoot, "src/pages/SettingsPage.tsx"),
      "utf8",
    );

    expect(settingsSource.indexOf('t("preferredPaymentMethod")')).toBeLessThan(
      settingsSource.indexOf("<PwaInstallSetting"),
    );
  });
});
