import { parse } from "yaml";
import enRaw from "./locales/en.yaml?raw";
import jaRaw from "./locales/ja.yaml?raw";
import { translationKeys, type TranslationKey } from "./translationKeys";

export type Locale = "en" | "ja" | "fr" | "es" | "zh-CN" | "zh-TW";
export type { TranslationKey } from "./translationKeys";

type BaseLocale = "en" | "ja";
type BaseTranslationMap = Record<TranslationKey, string>;
const translationKeySet = new Set<TranslationKey>(translationKeys);

function parseBaseYaml(raw: string): Partial<Record<TranslationKey, string>> {
  const parsed = parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

  const result: Partial<Record<TranslationKey, string>> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    if (!translationKeySet.has(key as TranslationKey)) continue;
    result[key as TranslationKey] = value;
  }
  return result;
}

function buildBaseMap(
  values: Partial<Record<TranslationKey, string>>,
): BaseTranslationMap {
  const result = {} as BaseTranslationMap;
  for (const key of translationKeys) {
    result[key] = values[key] ?? key;
  }
  return result;
}

const enMap = buildBaseMap(parseBaseYaml(enRaw));
const jaMap = buildBaseMap(parseBaseYaml(jaRaw));

export const translations: Record<TranslationKey, Record<BaseLocale, string>> =
  translationKeys.reduce(
    (acc, key) => {
      acc[key] = {
        en: enMap[key],
        ja: jaMap[key] ?? enMap[key],
      };
      return acc;
    },
    {} as Record<TranslationKey, Record<BaseLocale, string>>,
  );
