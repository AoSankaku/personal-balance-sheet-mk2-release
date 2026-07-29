import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const frontendSourceRoot = join(repoRoot, "frontend", "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(?:[cm]?[jt]sx?)$/.test(name) ? [path] : [];
  });
}

describe("native browser dialogs", () => {
  test("project instructions prohibit native blocking browser dialogs", () => {
    const instructions = readFileSync(join(repoRoot, "AGENTS.md"), "utf8");

    expect(instructions).toContain("window.alert");
    expect(instructions).toContain("window.confirm");
    expect(instructions).toContain("window.prompt");
    expect(instructions).toContain("ConfirmModal");
  });

  test("frontend source uses application modals instead of native dialogs", () => {
    const violations = sourceFiles(frontendSourceRoot).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const sourceWithoutMethodSignatures = source.replace(
        /\b(?:alert|confirm|prompt)\s*\([^)]*\)\s*:/g,
        "",
      );
      const matches = sourceWithoutMethodSignatures.match(
        /(?:\b(?:window|globalThis)\.(?:alert|confirm|prompt)|(?<![.\w])(?:alert|confirm|prompt))\s*\(/g,
      );
      return (matches ?? []).map(
        (match) => `${relative(repoRoot, path)}: ${match}`,
      );
    });

    expect(violations).toEqual([]);
  });
});
