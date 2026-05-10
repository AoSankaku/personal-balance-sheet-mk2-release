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
import { toHtmlLang } from "./localeUtils";
import { tForLocale } from "./translate";
import type { Locale, TranslationKey } from "./translations";

interface LangContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: TranslationKey) => string;
}

const LangContext = createContext<LangContextValue | null>(null);

function getInitialLocale(): Locale {
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
  return "ja"; // Japanese is the primary language
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);

  // Always-current ref so `t` can be stable without stale-closure issues.
  const localeRef = useRef<Locale>(locale);
  localeRef.current = locale;

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem("locale", l);
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
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  useEffect(() => {
    document.documentElement.lang = toHtmlLang(locale);
  }, [locale]);

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used inside LangProvider");
  return ctx;
}
