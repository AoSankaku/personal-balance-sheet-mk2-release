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
      "scripts/bump-version*.test.mjs",
    ]);
  });

  test("does not ignore application guide Markdown files", () => {
    expect(workflow.on.push["paths-ignore"]).not.toContain("**/*.md");
    expect(workflow.on.push["paths-ignore"]).not.toContain(
      "frontend/src/guides/**",
    );
  });

  test("fast-forwards dev after committing the main version", () => {
    const syncStep = workflow.jobs["bump-version"].steps.find(
      (step) => step.name === "Synchronize dev",
    );

    expect(syncStep.run).toContain("git fetch origin dev");
    expect(syncStep.run).toContain("git merge-base --is-ancestor origin/dev HEAD");
    expect(syncStep.run).toContain("git push origin HEAD:dev");
  });
});
