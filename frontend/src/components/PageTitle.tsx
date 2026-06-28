import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useLang, type TranslationKey } from "../i18n";
import {
  formatDocumentTitle,
  pageTitleKeyForPathname,
} from "../i18n/documentTitle";

interface PageTitleProps {
  overrideTitleKey?: TranslationKey | null;
}

export function PageTitle({ overrideTitleKey }: PageTitleProps) {
  const { locale, t } = useLang();
  const { pathname } = useLocation();

  useEffect(() => {
    const appTitle = t("appTitle");
    const pageTitleKey = overrideTitleKey ?? pageTitleKeyForPathname(pathname);
    document.title = formatDocumentTitle(
      appTitle,
      pageTitleKey ? t(pageTitleKey) : null,
    );
  }, [locale, overrideTitleKey, pathname, t]);

  return null;
}
