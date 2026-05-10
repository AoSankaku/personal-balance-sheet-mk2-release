import { translations, type Locale, type TranslationKey } from "./translations";
import { yamlTranslations } from "./yamlTranslations";

type BaseLocale = Extract<Locale, "en" | "ja">;

function isBaseLocale(locale: Locale): locale is BaseLocale {
  return locale === "en" || locale === "ja";
}

export function tForLocale(key: TranslationKey, locale: Locale): string {
  const base = translations[key];

  if (isBaseLocale(locale)) return base[locale];

  return (
    yamlTranslations[locale]?.[key] ??
    base.en
  );
}
