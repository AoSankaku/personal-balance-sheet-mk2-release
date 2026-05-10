import { extraTranslations } from "./extraTranslations";
import { financialHealthTranslations } from "./financialHealthTranslations";
import { overviewTranslations } from "./overviewTranslations";
import { settingsTranslations } from "./settingsTranslations";
import { translations, type Locale, type TranslationKey } from "./translations";

type BaseLocale = Extract<Locale, "en" | "ja">;

function isBaseLocale(locale: Locale): locale is BaseLocale {
  return locale === "en" || locale === "ja";
}

export function tForLocale(key: TranslationKey, locale: Locale): string {
  const base = translations[key];

  if (isBaseLocale(locale)) return base[locale];

  return (
    extraTranslations[locale]?.[key] ??
    financialHealthTranslations[locale]?.[key] ??
    overviewTranslations[locale]?.[key] ??
    settingsTranslations[locale]?.[key] ??
    base.en
  );
}
