import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { applyAppChromeMetadata, getAppMetadata } from "./appMetadata";
import { toHtmlLang } from "./localeUtils";
import { tForLocale } from "./translate";
import type { Locale, TranslationKey } from "./translations";

interface LangContextValue {
  locale: Locale;
  hasExplicitLocale: boolean;
  setLocale: (l: Locale) => void;
  resetLocaleSelection: () => void;
  t: (key: TranslationKey) => string;
}

const LangContext = createContext<LangContextValue | null>(null);

function getStoredLocale(): Locale | null {
  const stored = localStorage.getItem("locale");
  if (
    stored === "en" ||
    stored === "ja" ||
    stored === "fr" ||
    stored === "es" ||
    stored === "zh-CN" ||
    stored === "zh-TW"
  )
    return stored;
  return null;
}

function getInitialLocale(): Locale {
  const stored = getStoredLocale();
  if (stored) return stored;
  return "ja"; // Japanese is the primary language
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);
  const [hasExplicitLocale, setHasExplicitLocale] = useState<boolean>(
    () => getStoredLocale() !== null,
  );

  // Always-current ref so `t` can be stable without stale-closure issues.
  const localeRef = useRef<Locale>(locale);
  localeRef.current = locale;

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    setHasExplicitLocale(true);
    localStorage.setItem("locale", l);
  }, []);

  const resetLocaleSelection = useCallback(() => {
    setLocaleState("ja");
    setHasExplicitLocale(false);
    localStorage.removeItem("locale");
  }, []);

  // Stable `t` — never changes reference, reads locale via ref.
  // This means useCallbacks that depend on `t` won't recreate (no re-fetch on language swap).
  // Components still re-render for language changes because `locale` in the context value changes.
  const t = useCallback(
    (key: TranslationKey): string => tForLocale(key, localeRef.current),
    [],
  );

  // Memoize context value so only locale changes cause consumer re-renders.
  const value = useMemo(
    () => ({ locale, hasExplicitLocale, setLocale, resetLocaleSelection, t }),
    [locale, hasExplicitLocale, setLocale, resetLocaleSelection, t],
  );

  useEffect(() => {
    const metadata = getAppMetadata(locale, tForLocale("appTitle", locale));
    applyAppChromeMetadata(document, metadata, toHtmlLang(locale));
  }, [locale]);

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used inside LangProvider");
  return ctx;
}
