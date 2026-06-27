import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
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
  IconEdit,
  IconHome,
  IconLock,
  IconReceipt,
  IconScale,
  IconShoppingCart,
  IconTrash,
  IconTrendingDown,
  IconTrendingUp,
  IconHandStop,
  IconSalad,
  IconUsers,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { useState } from "react";
import type { Account, AccountCategory } from "@balance-sheet/shared";
import { api, ApiError } from "../api/client";
import { useAppData } from "../context/AppDataContext";
import { useLang, type TranslationKey } from "../i18n";
import { showFeedback } from "../lib/feedback";
import {
  isUserSelectableAccount,
  systemAccountTranslationKey,
  toAccountSelectOption,
} from "../lib/accountUtils";
import { formatCurrency } from "../lib/numberFormat";
import { usePrivacy } from "../context/PrivacyContext";

interface Props {
  title: string;
  accounts: Account[];
  onDeleteAccount?: (id: number) => void;
  onEditAccount?: (account: Account) => void;
  /** Override balance formatting (e.g. to convert/display in a non-JPY currency) */
  formatBalance?: (amount: number | null | undefined) => string;
}

// Typed as Record<AccountCategory, ...> so TypeScript errors when a new category is added
// to AccountCategory but not here. Never use Record<string, ...> for these maps.
const CATEGORY_ICON: Record<AccountCategory, React.ReactNode> = {
  cash: <IconBuildingBank size={11} />,
  investment: <IconTrendingUp size={11} />,
  property: <IconHome size={11} />,
  crypto: <IconCurrencyBitcoin size={11} />,
  lending: <IconHandStop size={11} />,
  short_term_lending: <IconHandStop size={11} />,
  long_term_lending: <IconReceipt size={11} />,
  business_advance: <IconBriefcase size={11} />,
  loan: <IconReceipt size={11} />,
  long_term_loan: <IconReceipt size={11} />,
  credit_card: <IconCreditCard size={11} />,
  short_term_loan: <IconHandStop size={11} />,
  opening_balance: <IconScale size={11} />,
  salary: <IconBriefcase size={11} />,
  business: <IconBuilding size={11} />,
  food: <IconSalad size={11} />,
  rent: <IconDoor size={11} />,
  transport: <IconCar size={11} />,
  utilities: <IconBolt size={11} />,
  entertainment: <IconDeviceGamepad2 size={11} />,
  daily_goods: <IconShoppingCart size={11} />,
  social: <IconUsers size={11} />,
  investment_loss: <IconTrendingDown size={11} />,
  other: <IconDots size={11} />,
};

const CATEGORY_KEY: Record<AccountCategory, TranslationKey> = {
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

const TYPE_KEY: Record<Account["type"], TranslationKey> = {
  asset: "typeAsset",
  liability: "typeLiability",
  equity: "typeEquity",
  income: "typeIncome",
  expense: "typeExpense",
};

function balanceInCurrency(account: Account, currency: string) {
  if (account.balances) return account.balances[currency] ?? 0;
  return currency === "JPY" ? (account.balance ?? 0) : 0;
}

function hasAnyBalance(account: Account) {
  if (account.balances) {
    return Object.values(account.balances).some(
      (balance) => Math.abs(balance) > 0.000001,
    );
  }
  return (
    account.balance !== null &&
    account.balance !== undefined &&
    account.balance !== 0
  );
}

export function AccountTable({
  title,
  accounts,
  onDeleteAccount,
  onEditAccount,
  formatBalance,
}: Props) {
  const { t, locale } = useLang();
  const { privacyMode, maskAccountNames } = usePrivacy();
  const { displayCurrency, displayCurrencySymbol } = useAppData();
  const accountBalance = (account: Account) =>
    formatBalance
      ? (account.balance ?? 0)
      : balanceInCurrency(account, displayCurrency);
  const total = accounts.reduce(
    (sum, account) => sum + accountBalance(account),
    0,
  );
  const fmtBal = (amount: number | null | undefined) =>
    formatBalance
      ? formatBalance(amount)
      : formatCurrency(
          amount ?? 0,
          locale,
          displayCurrency,
          displayCurrencySymbol,
        );

  const [deletingAccount, setDeletingAccount] = useState<Account | null>(null);
  const [replaceWithId, setReplaceWithId] = useState<string | null>(null);
  const [confirmOpened, { open: openConfirm, close: closeConfirm }] =
    useDisclosure(false);

  const hasActions = Boolean(onDeleteAccount || onEditAccount);

  async function handleDeleteClick(account: Account) {
    if (!onDeleteAccount) return;
    try {
      await api.accounts.delete(account.id);
      onDeleteAccount(account.id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setDeletingAccount(account);
        setReplaceWithId(null);
        openConfirm();
      } else {
        showFeedback({
          message: e instanceof Error ? e.message : String(e),
          color: "red",
        });
      }
    }
  }

  async function handleReplaceAndDelete() {
    if (!deletingAccount || !replaceWithId || !onDeleteAccount) return;
    try {
      await api.accounts.replaceAccount(
        deletingAccount.id,
        Number(replaceWithId),
      );
      onDeleteAccount(deletingAccount.id);
      closeConfirm();
      setDeletingAccount(null);
      setReplaceWithId(null);
    } catch (e) {
      showFeedback({
        message: e instanceof Error ? e.message : String(e),
        color: "red",
      });
    }
  }

  const replacementOptions = accounts
    .filter(
      (a) => a.id !== deletingAccount?.id && isUserSelectableAccount(a),
    )
    .map((a) => toAccountSelectOption(a, t));

  return (
    <>
      <Stack gap="xs">
        <Group justify="space-between">
          <Title order={5}>{title}</Title>
          <Text fw={600} size="sm">
            {t("total")} {fmtBal(total)}
          </Text>
        </Group>
        <ScrollArea>
          <Table
            striped
            highlightOnHover
            withTableBorder
            withColumnBorders
            style={{ minWidth: 420 }}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("thAccount")}</Table.Th>
                <Table.Th style={{ minWidth: 110 }}>{t("thCategory")}</Table.Th>
                <Table.Th className="currency-cell" style={{ width: 120 }}>
                  {t("thBalance")}
                </Table.Th>
                {hasActions && <Table.Th style={{ width: 70 }} />}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {accounts.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={hasActions ? 4 : 3}>
                    <Text c="dimmed" ta="center" size="sm" py="xs">
                      {t("noAccountsYet")}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ) : (
                accounts.map((account) => {
                  const catKey = CATEGORY_KEY[account.category];
                  const isSystem = account.is_system === true;
                  const sysKey = isSystem
                    ? systemAccountTranslationKey(account.name)
                    : null;
                  const displayName = sysKey ? t(sysKey) : account.name;
                  const categoryLabel =
                    privacyMode && maskAccountNames
                      ? t(TYPE_KEY[account.type])
                      : catKey
                        ? t(catKey)
                        : account.category;
                  const displayBalance = accountBalance(account);
                  return (
                    <Table.Tr key={account.id}>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <Text size="sm" fw={500}>
                            {displayName}
                          </Text>
                          {isSystem && (
                            <Tooltip
                              label={t("sysAccountTooltip")}
                              withArrow
                              position="right"
                              events={{ hover: true, focus: true, touch: true }}
                              multiline
                              w={200}
                            >
                              <IconLock
                                size={14}
                                color="var(--mantine-color-gray-5)"
                                style={{ flexShrink: 0 }}
                              />
                            </Tooltip>
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          size="sm"
                          variant="light"
                          leftSection={CATEGORY_ICON[account.category]}
                        >
                          {categoryLabel}
                        </Badge>
                      </Table.Td>
                      <Table.Td className="currency-cell">
                        <Group gap={4} justify="flex-end" wrap="nowrap">
                          {displayBalance < 0 && (
                            <Tooltip label={t("negativeBalanceWarning")}>
                              <IconAlertTriangle
                                size={14}
                                color="var(--mantine-color-orange-6)"
                              />
                            </Tooltip>
                          )}
                          <Text size="sm" fw={500}>
                            {fmtBal(displayBalance)}
                          </Text>
                        </Group>
                      </Table.Td>
                      {hasActions && (
                        <Table.Td>
                          <Group gap={4} justify="center">
                            {!isSystem && onEditAccount && (
                              <Tooltip label={t("editAccount")}>
                                <ActionIcon
                                  variant="subtle"
                                  size="sm"
                                  onClick={() => onEditAccount(account)}
                                >
                                  <IconEdit size={14} />
                                </ActionIcon>
                              </Tooltip>
                            )}
                            {!isSystem &&
                              onDeleteAccount &&
                              (() => {
                                const hasBalance = hasAnyBalance(account);
                                return (
                                  <Tooltip
                                    label={
                                      hasBalance
                                        ? t("deleteNonZeroBalanceTooltip")
                                        : t("deleteAccount")
                                    }
                                  >
                                    <ActionIcon
                                      variant="subtle"
                                      color={hasBalance ? "gray" : "red"}
                                      size="sm"
                                      disabled={hasBalance}
                                      onClick={() =>
                                        void handleDeleteClick(account)
                                      }
                                    >
                                      <IconTrash size={14} />
                                    </ActionIcon>
                                  </Tooltip>
                                );
                              })()}
                          </Group>
                        </Table.Td>
                      )}
                    </Table.Tr>
                  );
                })
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Stack>

      {/* In-use replacement dialog */}
      <Modal
        opened={confirmOpened}
        onClose={closeConfirm}
        title={t("accountInUse")}
        centered
      >
        <Stack>
          <Text size="sm">{t("accountInUseMsg")}</Text>
          <Select
            label={t("replaceWith")}
            placeholder={t("selectAccount")}
            data={replacementOptions}
            value={replaceWithId}
            onChange={setReplaceWithId}
            searchable
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={closeConfirm}>
              {t("cancel")}
            </Button>
            <Button
              color="red"
              disabled={!replaceWithId}
              onClick={() => void handleReplaceAndDelete()}
            >
              {t("replaceAndDelete")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
