import type { D1LimitErrorBody } from "../../../shared/d1Limits";
import { tForLocale } from "../i18n/translate";
import type { Locale } from "../i18n/translations";

export type D1LimitNotice = D1LimitErrorBody;
type D1LimitNoticeListener = () => void;

const listeners = new Set<D1LimitNoticeListener>();
let current: D1LimitNotice | null = null;

const supportedLocales: readonly Locale[] = ["en", "ja", "fr", "es", "zh-CN", "zh-TW"];

function getStoredLocale(): Locale {
  try {
    if (typeof localStorage === "undefined") return "ja";
    const stored = localStorage.getItem("locale");
    return supportedLocales.includes(stored as Locale) ? (stored as Locale) : "ja";
  } catch {
    return "ja";
  }
}

export function getD1LimitErrorMessage() {
  return tForLocale("d1LimitError", getStoredLocale());
}

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeD1LimitNotice(listener: D1LimitNoticeListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getD1LimitNoticeSnapshot() {
  return current;
}

export function reportD1Limit(notice: D1LimitNotice) {
  if (
    current?.limit_type === notice.limit_type &&
    current.retry_at === notice.retry_at
  ) {
    return;
  }
  current = notice;
  emit();
}

export function clearD1LimitNotice() {
  if (!current) return;
  current = null;
  emit();
}
