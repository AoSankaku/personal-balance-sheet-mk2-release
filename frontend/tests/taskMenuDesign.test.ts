import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const frontendRoot = join(import.meta.dir, "..");
const source = (path: string) =>
  readFileSync(join(frontendRoot, path), "utf8");

describe("task menu design", () => {
  test("gives the task tray and budget warning a concise hierarchy", () => {
    const nav = source("src/components/TopNav.tsx");

    expect(nav).toContain('t("taskMenuTitle")');
    expect(nav).toContain('t("taskBudgetNegativeTitle")');
    expect(nav).toContain('t("taskBudgetNegativeAction")');
    expect(nav).toContain("task-menu__budget-card");
  });

  test("exposes menu state and mobile-friendly interaction styling", () => {
    const nav = source("src/components/TopNav.tsx");
    const styles = source("src/components/TopNav.css");

    expect(nav).toContain('import "./TopNav.css"');
    expect(nav).not.toContain('import "./TopNav.module.css"');
    expect(nav).toContain("aria-expanded={opened}");
    expect(nav).toContain('role="dialog"');
    expect(nav).toContain("task-menu__item");
    expect(styles).toContain("min-height: 44px");
    expect(styles).toContain(":focus-visible");
    expect(styles).toContain("max-width: calc(100vw - 16px)");
    expect(styles).toContain("overflow-wrap: anywhere");
    expect(styles).toContain("flex-direction: column");
    expect(styles).not.toContain(":global(");
  });

  test("matches the task trigger size to the compact currency trigger", () => {
    const nav = source("src/components/TopNav.tsx");

    expect(nav).toContain('const HEADER_ACTION_ICON_SIZE = "md"');
    expect(nav.match(/size=\{HEADER_ACTION_ICON_SIZE\}/g)).toHaveLength(2);
    expect(nav).not.toContain("size={44}");
  });

  test("translates the new task hierarchy in every supported locale", () => {
    const keys = source("src/i18n/translationKeys.ts");
    const requiredKeys = [
      "taskMenuTitle",
      "taskMenuCount",
      "taskBudgetNegativeTitle",
      "taskBudgetNegativeAction",
    ];

    for (const key of requiredKeys) {
      expect(keys).toContain(`"${key}"`);
    }

    for (const locale of ["en", "ja", "fr", "es", "zh-CN", "zh-TW"]) {
      const translations = source(`src/i18n/locales/${locale}.yaml`);
      for (const key of requiredKeys) {
        expect(translations).toContain(`${key}:`);
      }
    }
  });
});
