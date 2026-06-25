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
  target.documentElement.lang = htmlLang;
  target.title = metadata.title;
  target
    .querySelector<HTMLLinkElement>('link[rel="manifest"]')
    ?.setAttribute("href", metadata.manifestHref);
}
