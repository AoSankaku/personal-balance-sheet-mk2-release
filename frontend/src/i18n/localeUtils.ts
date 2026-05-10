import type { Locale } from "./translations";

export function toIntlLocale(locale: Locale | string): string {
  switch (locale) {
    case "ja":
      return "ja-JP";
    case "en":
      return "en-US";
    case "fr":
      return "fr-FR";
    case "es":
      return "es-ES";
    case "zh-CN":
      return "zh-CN";
    case "zh-TW":
      return "zh-TW";
    default:
      return typeof locale === "string" && locale.length > 0 ? locale : "en-US";
  }
}

export function toHtmlLang(locale: Locale | string): string {
  return toIntlLocale(locale);
}
