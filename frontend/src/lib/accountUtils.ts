import type { AccountCategory, AccountType } from "@balance-sheet/shared";
import type { TranslationKey } from "../i18n";

/** Maps a system account internal name to its translation key. Returns null if not a known system key. */
export function systemAccountTranslationKey(
  name: string,
): TranslationKey | null {
  switch (name) {
    case "__system:unknown_funds__":
      return "sysUnknownFunds";
    case "__system:misc_expense__":
      return "sysMiscExpense";
    case "__system:misc_income__":
      return "sysMiscIncome";
    case "__system:securities_gain__":
      return "sysSecuritiesGain";
    case "__system:securities_loss__":
      return "sysSecuritiesLoss";
    case "__system:crypto_gain__":
      return "sysCryptoGain";
    case "__system:crypto_loss__":
      return "sysCryptoLoss";
    case "__system:property_gain__":
      return "sysPropertyGain";
    case "__system:property_loss__":
      return "sysPropertyLoss";
    case "__system:opening_balance__":
      return "sysOpeningBalance";
    case "__system:bad_debt_loss__":
      return "sysBadDebtLoss";
    // Loan system accounts use plain names (already human-readable)
    default:
      return null;
  }
}

type AccountDisplayLike = {
  id?: number | string;
  name: string;
  is_system?: boolean | number;
};

export function isSystemAccount(account: { is_system?: boolean | number }) {
  return account.is_system === true || account.is_system === 1;
}

export function isUserSelectableAccount(account: {
  is_system?: boolean | number;
}) {
  return !isSystemAccount(account);
}

export function accountDisplayName(
  account: AccountDisplayLike,
  t?: (key: TranslationKey) => string,
): string {
  if (isSystemAccount(account)) {
    const key = systemAccountTranslationKey(account.name);
    if (key) return t ? t(key) : key;
  }
  return account.name;
}

export function toAccountSelectOption(
  account: AccountDisplayLike & { id: number | string },
  t?: (key: TranslationKey) => string,
) {
  return {
    value: String(account.id),
    label: accountDisplayName(account, t),
  };
}

/**
 * Canonical category ordering per account type.
 * System accounts are always sorted last (handled by caller).
 * `lending` and `loan` are legacy aliases kept for backward compat.
 */
export const CATEGORY_ORDER: Record<AccountType, AccountCategory[]> = {
  asset: [
    "cash",
    "lending", // legacy short_term_lending
    "short_term_lending",
    "long_term_lending",
    "business_advance",
    "investment",
    "crypto",
    "property",
    "other",
  ],
  liability: [
    "credit_card",
    "short_term_loan",
    "loan", // legacy long_term_loan
    "long_term_loan",
    "business_advance",
    "other",
  ],
  equity: ["opening_balance", "other"],
  income: ["salary", "business", "investment", "other"],
  expense: [
    "entertainment",
    "food",
    "utilities",
    "daily_goods",
    "social",
    "rent",
    "investment_loss",
    "transport",
    "other",
  ],
};

/** Translation key for each account category. */
export const CATEGORY_TRANSLATION_KEY: Record<AccountCategory, TranslationKey> =
  {
    cash: "catCash",
    investment: "catInvestment",
    property: "catProperty",
    crypto: "catCrypto",
    lending: "catLending",
    short_term_lending: "catShortTermLending",
    long_term_lending: "catLongTermLending",
    business_advance: "catBusinessAdvance",
    loan: "catLoan",
    long_term_loan: "catLongTermLoan",
    credit_card: "catCreditCard",
    short_term_loan: "catShortTermLoan",
    opening_balance: "catOpeningBalance",
    salary: "catSalary",
    business: "catBusiness",
    food: "catFood",
    rent: "catRent",
    transport: "catTransport",
    utilities: "catUtilities",
    entertainment: "catEntertainment",
    daily_goods: "catDailyGoods",
    social: "catSocial",
    investment_loss: "catInvestmentLoss",
    other: "catOther",
  };

/**
 * Returns the sort index for a given category within a type (lower = earlier).
 * System accounts are always placed after non-system accounts, but among themselves
 * they follow the same category order (offset by a large constant).
 */
export function categoryIndex(
  type: AccountType,
  category: AccountCategory,
  isSystem: boolean,
): number {
  const order = CATEGORY_ORDER[type];
  const idx = order.indexOf(category);
  const catPos = idx === -1 ? order.length : idx;
  // Non-system: 0..N; system: 10000..10000+N (always after non-system, but still ordered by category)
  return isSystem ? 10000 + catPos : catPos;
}
