import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parse } from "yaml";

const root = join(import.meta.dir, "..");
const locales = ["en", "ja", "fr", "es", "zh-CN", "zh-TW"];
const instructionNumerals = /[①②③]/u;

describe("depreciation budget copy", () => {
  test("does not expose internal instruction numerals in any supported locale", () => {
    for (const locale of locales) {
      const content = readFileSync(
        join(root, `src/i18n/locales/${locale}.yaml`),
        "utf8",
      );
      const translations = parse(content) as Record<string, unknown>;
      const numberedCopy = Object.entries(translations)
        .filter(([key]) => key.startsWith("depreciationBudget"))
        .filter(([, value]) => typeof value === "string" && instructionNumerals.test(value))
        .map(([key]) => key);

      expect(numberedCopy, `${locale} depreciation budget copy`).toEqual([]);
    }
  });
});
