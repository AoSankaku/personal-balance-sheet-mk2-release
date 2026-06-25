import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import {
  applyAppMetadata,
  getAppMetadata,
} from "../src/i18n/appMetadata";
import type { Locale } from "../src/i18n/translations";

const frontendRoot = join(import.meta.dir, "..");
const locales: Locale[] = ["en", "ja", "fr", "es", "zh-CN", "zh-TW"];

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(frontendRoot, path), "utf8")) as Record<
    string,
    unknown
  >;
}

function readAppTitle(locale: Locale): string {
  const source = readFileSync(
    join(frontendRoot, `src/i18n/locales/${locale}.yaml`),
    "utf8",
  );
  const values = parse(source) as Record<string, unknown>;
  return String(values.appTitle);
}

describe("localized application metadata", () => {
  test("selects a language-specific manifest and translated document title", () => {
    for (const locale of locales) {
      const title = readAppTitle(locale);
      expect(getAppMetadata(locale, title)).toEqual({
        title,
        manifestHref: `/manifest-${locale}.webmanifest`,
      });
    }
  });

  test("applies localized metadata to the active document", () => {
    const attributes = new Map<string, string>();
    const target = {
      title: "",
      documentElement: { lang: "" },
      querySelector: (selector: string) =>
        selector === 'link[rel="manifest"]'
          ? {
              setAttribute: (name: string, value: string) =>
                attributes.set(name, value),
            }
          : null,
    } as unknown as Document;

    applyAppMetadata(
      target,
      getAppMetadata("fr", "Bilan personnel"),
      "fr-FR",
    );

    expect(target.title).toBe("Bilan personnel");
    expect(target.documentElement.lang).toBe("fr-FR");
    expect(attributes.get("href")).toBe("/manifest-fr.webmanifest");
  });

  test("provides a valid PWA manifest for every supported locale", () => {
    for (const locale of locales) {
      const manifestPath = `public/manifest-${locale}.webmanifest`;
      expect(existsSync(join(frontendRoot, manifestPath)), manifestPath).toBe(
        true,
      );

      const manifest = readJson(manifestPath);
      expect(manifest.name, locale).toBe(readAppTitle(locale));
      expect(manifest.short_name, locale).toBe(readAppTitle(locale));
      expect(manifest.lang, locale).toBe(locale);
      expect(manifest.icons, locale).toEqual([
        {
          src: "/icons/web-app-manifest-192x192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/icons/web-app-manifest-512x512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/icons/web-app-manifest-512x512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ]);
    }
  });

  test("uses the Japanese manifest as the initial HTML fallback", () => {
    const html = readFileSync(join(frontendRoot, "index.html"), "utf8");
    expect(html).toContain(
      '<link rel="manifest" href="/manifest-ja.webmanifest" />',
    );
    expect(html).toContain("<title>個人バランスシート</title>");
  });
});
