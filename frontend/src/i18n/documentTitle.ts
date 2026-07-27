import type { TranslationKey } from "./translations";

const EXACT_PAGE_TITLE_KEYS: Record<string, TranslationKey> = {
  "/": "navOverview",
  "/input": "inputPageTitle",
  "/fs": "navFS",
  "/fs/bs": "balanceSheetTitle",
  "/fs/pl": "plTitle",
  "/fs/crypto": "tabTrialBalance",
  "/fs/report": "settingsNavExportTitle",
  "/fs/tt": "tabTrialBalance",
  "/fs/db": "tabLoanMgmt",
  "/fs/sv": "tabSavings",
  "/ledger": "navLedger",
  "/settings": "navSettings",
  "/settings/budget": "budgetSettingsTitle",
  "/settings/bulk_edit": "bulkEditPageTitle",
  "/settings/initial_balance": "tabInitialBalance",
  "/settings/csv": "settingsNavCsvTitle",
  "/settings/business": "businessOwnerSettingsTitle",
  "/settings/danger": "dangerZoneTitle",
  "/settings/guides": "guidesPageTitle",
  "/settings/export": "settingsNavExportTitle",
  "/settings/currencies": "currencySettingsTitle",
  "/settings/product-api": "productApiSettingsTitle",
  "/shopping-list": "shoppingListTitle",
  "/wishlist": "wishlistTitle",
  "/scheduled-payments": "scheduledPaymentsTitle",
};

const DYNAMIC_PAGE_TITLE_KEYS: {
  prefix: string;
  titleKey: TranslationKey;
}[] = [
  { prefix: "/fs/db/long-term-loan/", titleKey: "loanDetailTitle" },
  { prefix: "/fs/db/long-term-lend/", titleKey: "loanDetailTitle" },
];

function normalizePathname(pathname: string): string {
  const pathOnly = pathname.split(/[?#]/, 1)[0] || "/";
  if (pathOnly === "/") return pathOnly;
  return pathOnly.replace(/\/+$/, "");
}

export function pageTitleKeyForPathname(
  pathname: string,
): TranslationKey | null {
  const normalized = normalizePathname(pathname);
  const exactTitleKey = EXACT_PAGE_TITLE_KEYS[normalized];
  if (exactTitleKey) return exactTitleKey;

  return (
    DYNAMIC_PAGE_TITLE_KEYS.find(({ prefix }) =>
      normalized.startsWith(prefix),
    )?.titleKey ?? null
  );
}

export function formatDocumentTitle(
  appTitle: string,
  pageTitle?: string | null,
): string {
  if (!pageTitle || pageTitle === appTitle) return appTitle;
  return `${pageTitle} | ${appTitle}`;
}
