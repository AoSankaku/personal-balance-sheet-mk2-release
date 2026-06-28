import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import { translationKeys } from "../src/i18n/translationKeys";

const root = join(import.meta.dir, "..");
const locales = ["en", "ja", "fr", "es", "zh-CN", "zh-TW"];

function readText(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("multi-line entry balance difference", () => {
  test("renders a debit/credit difference label", () => {
    const source = readText("src/components/MultiLineEntryForm.tsx");

    expect(source).toContain('t("totalDifference")');
  });

  test("defines the difference label in every supported locale", () => {
    expect(translationKeys).toContain("totalDifference");

    for (const locale of locales) {
      const values = parse(
        readText(`src/i18n/locales/${locale}.yaml`),
      ) as Record<string, unknown>;

      expect(typeof values.totalDifference, locale).toBe("string");
      expect(values.totalDifference, locale).not.toBe("");
    }
  });
});
