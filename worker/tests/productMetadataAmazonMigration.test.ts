import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("Amazon product metadata", () => {
  test("does not call the retired PA-API 5 endpoint", () => {
    const source = readFileSync(
      new URL("../src/lib/productMetadata.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("/paapi5/");
    expect(source).not.toContain("ProductAdvertisingAPIv1");
  });
});
