import { parse } from "yaml";
import type { Locale } from "./translations";
import { translationKeys, type TranslationKey } from "./translationKeys";
import frRaw from "./locales/fr.yaml?raw";
import esRaw from "./locales/es.yaml?raw";
import zhCnRaw from "./locales/zh-CN.yaml?raw";
import zhTwRaw from "./locales/zh-TW.yaml?raw";

type ExtraLocale = Exclude<Locale, "en" | "ja">;
type LocaleTranslations = Partial<Record<TranslationKey, string>>;

const validKeys = new Set<TranslationKey>(
  translationKeys,
);

function parseLocaleYaml(raw: string): LocaleTranslations {
  const parsed = parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

  const result: LocaleTranslations = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!validKeys.has(key as TranslationKey)) {
      continue;
    }
    if (typeof value !== "string") {
      continue;
    }
    result[key as TranslationKey] = value;
  }
  return result;
}

function loadYamlTranslations() {
  return {
    fr: parseLocaleYaml(frRaw),
    es: parseLocaleYaml(esRaw),
    "zh-CN": parseLocaleYaml(zhCnRaw),
    "zh-TW": parseLocaleYaml(zhTwRaw),
  } satisfies Record<ExtraLocale, LocaleTranslations>;
}

export const yamlTranslations = loadYamlTranslations();
