import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import sharp from "sharp";
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
        selector === 'link[rel="manifest"]' ||
        selector === 'meta[name="apple-mobile-web-app-title"]'
          ? {
              setAttribute: (name: string, value: string) => {
                attributes.set(`${selector}:${name}`, value);
              },
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
    expect(attributes.get('link[rel="manifest"]:href')).toBe(
      "/manifest-fr.webmanifest",
    );
    expect(
      attributes.get('meta[name="apple-mobile-web-app-title"]:content'),
    ).toBe("Bilan personnel");
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
          src: "/icons/pwa-icon-192-v2.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/icons/pwa-icon-512-v2.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/icons/pwa-maskable-192-v2.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "maskable",
        },
        {
          src: "/icons/pwa-maskable-512-v2.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ]);
    }
  });

  test("provides opaque maskable icons and transparent regular icons", async () => {
    const expected = [
      { path: "public/icons/pwa-icon-192-v2.png", size: 192, opaque: false },
      { path: "public/icons/pwa-icon-512-v2.png", size: 512, opaque: false },
      {
        path: "public/icons/pwa-maskable-192-v2.png",
        size: 192,
        opaque: true,
      },
      {
        path: "public/icons/pwa-maskable-512-v2.png",
        size: 512,
        opaque: true,
      },
    ];

    for (const icon of expected) {
      const absolutePath = join(frontendRoot, icon.path);
      expect(existsSync(absolutePath), icon.path).toBe(true);
      const metadata = await sharp(absolutePath).metadata();
      const stats = await sharp(absolutePath).stats();
      expect(metadata.width, icon.path).toBe(icon.size);
      expect(metadata.height, icon.path).toBe(icon.size);
      expect(stats.isOpaque, icon.path).toBe(icon.opaque);

      if (icon.opaque) {
        const { data, info } = await sharp(absolutePath)
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const center = (icon.size - 1) / 2;
        let farthestWhitePixel = 0;

        for (let y = 0; y < info.height; y += 1) {
          for (let x = 0; x < info.width; x += 1) {
            const offset = (y * info.width + x) * info.channels;
            if (
              data[offset] > 240 &&
              data[offset + 1] > 240 &&
              data[offset + 2] > 240
            ) {
              farthestWhitePixel = Math.max(
                farthestWhitePixel,
                Math.hypot(x - center, y - center),
              );
            }
          }
        }

        expect(farthestWhitePixel, `${icon.path} safe zone`).toBeLessThanOrEqual(
          icon.size * 0.4,
        );
      }
    }
  });

  test("provides opaque Apple touch icons for iPhone and iPad", async () => {
    const icons = [
      { path: "public/icons/apple-touch-icon-152-v2.png", size: 152 },
      { path: "public/icons/apple-touch-icon-167-v2.png", size: 167 },
      { path: "public/icons/apple-touch-icon-180-v2.png", size: 180 },
      { path: "public/apple-touch-icon.png", size: 180 },
    ];

    for (const icon of icons) {
      const absolutePath = join(frontendRoot, icon.path);
      expect(existsSync(absolutePath), icon.path).toBe(true);
      const metadata = await sharp(absolutePath).metadata();
      const stats = await sharp(absolutePath).stats();
      expect(metadata.width, icon.path).toBe(icon.size);
      expect(metadata.height, icon.path).toBe(icon.size);
      expect(stats.isOpaque, icon.path).toBe(true);
    }
  });

  test("uses iOS web app metadata and the Japanese fallback title", () => {
    const html = readFileSync(join(frontendRoot, "index.html"), "utf8");
    expect(html).toContain(
      '<link rel="manifest" href="/manifest-ja.webmanifest" />',
    );
    expect(html).toContain(
      '<meta name="apple-mobile-web-app-capable" content="yes" />',
    );
    expect(html).toContain(
      '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
    );
    expect(html).toContain(
      '<meta name="apple-mobile-web-app-title" content="個人バランスシート" />',
    );
    expect(html).toContain(
      '<link rel="apple-touch-icon" sizes="152x152" href="/icons/apple-touch-icon-152-v2.png" />',
    );
    expect(html).toContain(
      '<link rel="apple-touch-icon" sizes="167x167" href="/icons/apple-touch-icon-167-v2.png" />',
    );
    expect(html).toContain(
      '<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon-180-v2.png" />',
    );
    expect(html).toContain("<title>個人バランスシート</title>");
  });
});
