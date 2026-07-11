import { Group, Text } from "@mantine/core";
import {
  IconBolt,
  IconBriefcase,
  IconBuilding,
  IconBuildingBank,
  IconCar,
  IconCreditCard,
  IconCurrencyBitcoin,
  IconDeviceGamepad2,
  IconDoor,
  IconDots,
  IconHandStop,
  IconHome,
  IconLock,
  IconReceipt,
  IconSalad,
  IconScale,
  IconShoppingCart,
  IconTrendingDown,
  IconTrendingUp,
  IconUsers,
} from "@tabler/icons-react";
import type { Account } from "@balance-sheet/shared";
import type { TranslationKey } from "../i18n";
import {
  accountDisplayName,
  categoryIndex,
  CATEGORY_TRANSLATION_KEY,
} from "./accountUtils";

export type AccountOption = {
  value: string;
  label: string;
  category?: Account["category"];
  type?: Account["type"];
  is_system?: boolean;
};

export type AccountSelectData =
  | AccountOption
  | { group: string; items: AccountOption[] };

export function getAccountIcon(
  category: string | undefined,
  isSystem?: boolean,
) {
  const size = 14;
  if (isSystem) return <IconLock size={size} />;
  switch (category) {
    case "cash":
      return <IconBuildingBank size={size} />;
    case "lending":
    case "short_term_lending":
    case "short_term_loan":
      return <IconHandStop size={size} />;
    case "long_term_lending":
    case "loan":
    case "long_term_loan":
      return <IconReceipt size={size} />;
    case "business_advance":
      return <IconBriefcase size={size} />;
    case "investment":
      return <IconTrendingUp size={size} />;
    case "crypto":
      return <IconCurrencyBitcoin size={size} />;
    case "property":
      return <IconHome size={size} />;
    case "credit_card":
      return <IconCreditCard size={size} />;
    case "opening_balance":
      return <IconScale size={size} />;
    case "salary":
      return <IconBriefcase size={size} />;
    case "business":
      return <IconBuilding size={size} />;
    case "food":
      return <IconSalad size={size} />;
    case "rent":
      return <IconDoor size={size} />;
    case "transport":
      return <IconCar size={size} />;
    case "utilities":
      return <IconBolt size={size} />;
    case "entertainment":
      return <IconDeviceGamepad2 size={size} />;
    case "daily_goods":
      return <IconShoppingCart size={size} />;
    case "social":
      return <IconUsers size={size} />;
    case "investment_loss":
      return <IconTrendingDown size={size} />;
    default:
      return <IconDots size={size} />;
  }
}

export function renderAccountOption({
  option,
}: {
  option: AccountOption;
  checked?: boolean;
}) {
  return (
    <Group gap={6} wrap="nowrap">
      <Text c="dimmed" style={{ flexShrink: 0, lineHeight: 1 }}>
        {getAccountIcon(option.category, option.is_system)}
      </Text>
      <Text size="sm" truncate>
        {option.label}
      </Text>
    </Group>
  );
}

export function toAccountOption(
  account: Account,
  t?: (key: TranslationKey) => string,
): AccountOption {
  return {
    value: String(account.id),
    label: accountDisplayName(account, t),
    category: account.category,
    type: account.type,
    is_system: account.is_system ?? false,
  };
}

export function sortAccountsForSelect(
  a: Account,
  b: Account,
  t?: (key: TranslationKey) => string,
): number {
  if (a.type !== b.type) return a.type.localeCompare(b.type);
  const ai = categoryIndex(a.type, a.category, a.is_system ?? false);
  const bi = categoryIndex(b.type, b.category, b.is_system ?? false);
  if (ai !== bi) return ai - bi;
  return accountDisplayName(a, t).localeCompare(accountDisplayName(b, t), "ja");
}

export function buildAccountOptions(
  accounts: Account[],
  t?: (key: TranslationKey) => string,
): AccountOption[] {
  return [...accounts].sort((a, b) => sortAccountsForSelect(a, b, t)).map((a) =>
    toAccountOption(a, t),
  );
}

export function buildAccountOptionsByCategory(
  accounts: Account[],
  t: (key: TranslationKey) => string,
): AccountSelectData[] {
  const groups = new Map<string, { group: string; items: AccountOption[] }>();
  for (const account of [...accounts].sort((a, b) =>
    sortAccountsForSelect(a, b, t),
  )) {
    const group =
      account.is_system
        ? t("sysAccountBadge")
        : t(CATEGORY_TRANSLATION_KEY[account.category]);
    const current = groups.get(group) ?? { group, items: [] };
    current.items.push(toAccountOption(account, t));
    groups.set(group, current);
  }
  return [...groups.values()];
}
