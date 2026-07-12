import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");

describe("offline header-title indicator", () => {
  test("shows an offline icon immediately before the header app title", () => {
    const source = readFileSync(
      join(root, "src/components/TopNav.tsx"),
      "utf8",
    );

    expect(source).toContain("IconWifiOff");
    expect(source).toContain("{!isOnline && (");
    expect(source).toContain('aria-label={t("offlineModeLabel")}');
    expect(source).toContain('title={t("offlineModeLabel")}');
    expect(source.indexOf("{!isOnline && (")).toBeLessThan(
      source.indexOf("{t(\"appTitle\")}"),
    );
  });
});
