import { describe, expect, test } from "bun:test";

import { bumpVersion, replaceVersionSource } from "./bump-version.mjs";

describe("bumpVersion", () => {
  test("increments a prerelease sequence", () => {
    expect(bumpVersion("2026.6.0-beta0")).toBe("2026.6.0-beta1");
  });

  test("increments the final numeric segment without a prerelease sequence", () => {
    expect(bumpVersion("2026.6.0")).toBe("2026.6.1");
  });

  test("rejects unsupported version formats", () => {
    expect(() => bumpVersion("development")).toThrow("Unsupported version format");
  });
});

describe("replaceVersionSource", () => {
  test("updates the exported VERSION value", () => {
    expect(replaceVersionSource('export const VERSION = "2026.6.0-beta0";\n')).toEqual({
      previousVersion: "2026.6.0-beta0",
      nextVersion: "2026.6.0-beta1",
      content: 'export const VERSION = "2026.6.0-beta1";\n',
    });
  });

  test("rejects a source file without the VERSION export", () => {
    expect(() => replaceVersionSource("export const BUILD = 1;\n")).toThrow(
      "VERSION export was not found",
    );
  });
});
