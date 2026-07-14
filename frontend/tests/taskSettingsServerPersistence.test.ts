import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("server-persisted task settings", () => {
  test("loads and updates task settings through the shared app context", () => {
    const context = source("src/context/AppDataContext.tsx");
    const client = source("src/api/client.ts");

    expect(client).toContain("taskSettings:");
    expect(client).toContain('get: () => request<TaskSettings>("/task-settings")');
    expect(context).toContain("migrateLegacyTaskSettingsIfNeeded");
    expect(context).toContain("updateTaskSettings");
  });

  test("settings and task calculation no longer use device-local task values", () => {
    const settings = source("src/pages/SettingsPage.tsx");
    const topNav = source("src/components/TopNav.tsx");

    expect(settings).not.toContain('localStorage.setItem("notif:');
    expect(settings).not.toContain('localStorage.getItem("notif:');
    expect(topNav).not.toContain('localStorage.getItem("notif:');
    expect(settings).toContain("updateTaskSettings");
    expect(topNav).toContain("taskSettings");
  });
});
