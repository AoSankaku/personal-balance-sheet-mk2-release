import type { AccountType } from "@balance-sheet/shared";

export const PRIVACY_MODE_KEY = "privacy:mode";
export const PRIVACY_MASK_ACCOUNT_NAMES_KEY = "privacy:maskAccountNames";

export function readStoredBoolean(key: string, fallback = false): boolean {
  try {
    const value = localStorage.getItem(key);
    if (value === "true") return true;
    if (value === "false") return false;
  } catch {
    // localStorage can be unavailable in tests or private browser contexts.
  }
  return fallback;
}

export function writeStoredBoolean(key: string, value: boolean) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Keep the in-memory state even if persistence fails.
  }
}

export function isPrivacyModeEnabled(): boolean {
  return readStoredBoolean(PRIVACY_MODE_KEY, false);
}

export function isAccountNameMaskEnabled(): boolean {
  return readStoredBoolean(PRIVACY_MASK_ACCOUNT_NAMES_KEY, false);
}

export function maskFormattedAmountDigits(value: string): string {
  return value.replace(/\d/g, "*");
}

export function approximatePrivateAmount(amount: number): number {
  if (!Number.isFinite(amount) || amount === 0) return amount;
  const sign = amount < 0 ? -1 : 1;
  const abs = Math.abs(amount);
  const magnitude = Math.floor(Math.log10(abs));
  const scale = Math.pow(10, magnitude - 1);
  if (!Number.isFinite(scale) || scale === 0) return amount;
  return sign * Math.trunc(abs / scale) * scale;
}

export function privacyChartAmount(amount: number): number {
  return isPrivacyModeEnabled() ? approximatePrivateAmount(amount) : amount;
}

export type PrivateAccountNameInput = {
  id: number;
  type: AccountType;
  name?: string;
  is_system?: boolean | number;
};

export function buildPrivateAccountNameMap(
  accounts: PrivateAccountNameInput[],
  typeLabel: (type: AccountType) => string,
): Map<number, string> {
  const byType = new Map<AccountType, PrivateAccountNameInput[]>();
  for (const account of accounts) {
    if (account.is_system === true || account.is_system === 1) continue;
    const list = byType.get(account.type) ?? [];
    list.push(account);
    byType.set(account.type, list);
  }

  const out = new Map<number, string>();
  for (const [type, list] of byType) {
    const prefix = typeLabel(type);
    [...list]
      .sort((a, b) => a.id - b.id)
      .forEach((account, index) => {
        out.set(account.id, `${prefix}${String(index + 1).padStart(2, "0")}`);
      });
  }
  return out;
}

export function privateIndexedLabel(prefix: string, index: number): string {
  return `${prefix}${String(index + 1).padStart(2, "0")}`;
}

export function applyPrivateAccountNames<T extends PrivateAccountNameInput>(
  accounts: T[],
  privacyMode: boolean,
  maskAccountNames: boolean,
  typeLabel: (type: AccountType) => string,
): T[] {
  if (!privacyMode || !maskAccountNames) return accounts;
  const nameMap = buildPrivateAccountNameMap(accounts, typeLabel);
  if (nameMap.size === 0) return accounts;
  return accounts.map((account) => {
    const name = nameMap.get(account.id);
    return name ? { ...account, name } : account;
  });
}
