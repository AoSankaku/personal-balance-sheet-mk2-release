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

function readLocale(locale: string): Record<string, unknown> {
  return parse(readText(`src/i18n/locales/${locale}.yaml`)) as Record<
    string,
    unknown
  >;
}

describe("i18n translations", () => {
  test("every supported locale defines every translation key", () => {
    for (const locale of locales) {
      const values = readLocale(locale);
      const missing = translationKeys.filter(
        (key) => typeof values[key] !== "string",
      );

      expect(missing, `${locale} missing translations`).toEqual([]);
    }
  });

  test("loads extra locale YAML values as strings", () => {
    for (const locale of ["fr", "es", "zh-CN", "zh-TW"]) {
      for (const [key, value] of Object.entries(readLocale(locale))) {
        expect(typeof value, `${locale}.${key}`).toBe("string");
      }
    }
  });

  test("loads clear date filter copy from every extra locale", () => {
    for (const locale of ["fr", "es", "zh-CN", "zh-TW"]) {
      expect(readLocale(locale).clearDateFilter, locale).not.toBe(
        "[Clear date filter]",
      );
    }
  });

  test("ledger date range placeholder is read from translation keys", () => {
    const source = readText("src/pages/LedgerPage.tsx");
    expect(source).toMatch(
      /value=\{journalRange\}[\s\S]*?placeholder=\{t\("dateRangePlaceholder"\)\}/,
    );
  });
});
