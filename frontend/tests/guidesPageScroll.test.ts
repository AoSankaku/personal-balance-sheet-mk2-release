import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const guidesPageSource = readFileSync(
  join(import.meta.dir, "../src/pages/GuidesPage.tsx"),
  "utf8",
);

describe("mobile guide page navigation", () => {
  test("scrolls the viewport to the absolute page top after changing sections", () => {
    expect(guidesPageSource).toMatch(
      /window\.scrollTo\(\{\s*top:\s*0,\s*left:\s*0,\s*behavior:\s*"smooth",?\s*\}\)/,
    );
    expect(guidesPageSource).not.toContain("scrollIntoView");
  });
});
