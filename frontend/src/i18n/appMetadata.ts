import type { Locale } from "./translations";

export interface AppMetadata {
  title: string;
  manifestHref: string;
}

export function getAppMetadata(
  locale: Locale,
  translatedTitle: string,
): AppMetadata {
  return {
    title: translatedTitle,
    manifestHref: `/manifest-${locale}.webmanifest`,
  };
}

export function applyAppMetadata(
  target: Document,
  metadata: AppMetadata,
  htmlLang: string,
): void {
  applyAppChromeMetadata(target, metadata, htmlLang);
  target.title = metadata.title;
}

export function applyAppChromeMetadata(
  target: Document,
  metadata: AppMetadata,
  htmlLang: string,
): void {
  target.documentElement.lang = htmlLang;
  target
    .querySelector<HTMLLinkElement>('link[rel="manifest"]')
    ?.setAttribute("href", metadata.manifestHref);
  target
    .querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]')
    ?.setAttribute("content", metadata.title);
}
