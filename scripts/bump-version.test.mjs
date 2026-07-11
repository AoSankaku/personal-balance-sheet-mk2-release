import { describe, expect, test } from "bun:test";

import { bumpVersion, replaceVersionSource } from "./bump-version.mjs";

describe("bumpVersion", () => {
  test("increments a prerelease sequence within the same month", () => {
    expect(
      bumpVersion("2026.6.0-beta0", new Date("2026-06-15T00:00:00+09:00")),
    ).toBe("2026.6.0-beta1");
  });

  test("starts a new beta sequence when the month changes", () => {
    expect(
      bumpVersion("2026.6.0-beta10", new Date("2026-07-01T00:00:00+09:00")),
    ).toBe("2026.7.0-beta0");
  });

  test("uses the calendar month in Japan at the UTC month boundary", () => {
    expect(
      bumpVersion("2026.6.0-beta10", new Date("2026-06-30T15:00:00Z")),
    ).toBe("2026.7.0-beta0");
  });

  test("starts a new beta sequence when the year changes", () => {
    expect(
      bumpVersion("2026.12.0-beta4", new Date("2027-01-01T00:00:00+09:00")),
    ).toBe("2027.1.0-beta0");
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
    expect(
      replaceVersionSource(
        'export const VERSION = "2026.6.0-beta0";\n',
        new Date("2026-06-15T00:00:00+09:00"),
      ),
    ).toEqual({
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
