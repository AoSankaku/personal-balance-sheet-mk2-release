import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import YAML from "yaml";

const workflow = YAML.parse(
  readFileSync(".github/workflows/bump-version.yml", "utf8"),
);

describe("bump version workflow paths", () => {
  test("ignores repository docs and version automation files", () => {
    expect(workflow.on.push["paths-ignore"]).toEqual([
      "*.md",
      ".github/workflows/bump-version.yml",
      "scripts/bump-version*.mjs",
    ]);
  });

  test("does not ignore application guide Markdown files", () => {
    expect(workflow.on.push["paths-ignore"]).not.toContain("**/*.md");
    expect(workflow.on.push["paths-ignore"]).not.toContain(
      "frontend/src/guides/**",
    );
  });
});
