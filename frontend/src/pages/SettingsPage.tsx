import {
  ActionIcon,
  Anchor,
  Button,
  Collapse,
  Divider,
  Group,
  NumberInput,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Switch,
  Text,
  ThemeIcon,
  Title,
  rem,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconArrowDown,
  IconArrowUp,
  IconArrowsExchange,
  IconBell,
  IconBook,
  IconBriefcase,
  IconChartPie,
  IconDatabaseImport,
  IconFileDownload,
  IconFileSpreadsheet,
  IconHelp,
  IconSettings,
  IconStar,
  IconCurrencyDollar,
} from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { useDisclosure } from "@mantine/hooks";
import { useMemo, useState } from "react";
import { isLongTermLoanCategory } from "@balance-sheet/shared";
import { api } from "../api/client";
import { useLang, type Locale } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import { categoryIndex } from "../lib/accountUtils";
import { AccountTable } from "../components/AccountTable";
import { AddAccountModal } from "../components/AddAccountModal";
import { AppDataErrorAlert } from "../components/AppDataErrorAlert";
import type { Account, CreateAccountInput } from "@balance-sheet/shared";
import type { CreditCardSettingsInput } from "../components/AddAccountModal";
import { showFeedback } from "../lib/feedback";
import * as Flags from "country-flag-icons/react/1x1";

const localeToCountry: Record<Locale, string> = {
  en: "US",
  ja: "JP",
  fr: "FR",
  es: "ES",
  "zh-CN": "CN",
  "zh-TW": "TW",
};

function Flag({ locale }: { locale: Locale }) {
  const code = localeToCountry[locale];
  const Svg = (
    Flags as unknown as Record<
      string,
      (props: { style?: unknown }) => JSX.Element
    >
  )[code];
  if (!Svg) return null;
  return <Svg style={{ width: 18, height: 18, display: "block" }} />;
}

export default function SettingsPage() {
  const { t, locale, setLocale } = useLang();
  const {
    accounts,
    budgetCategories,
    budgetSettings,
    creditCardSettings,
    loading,
    error,
    refresh,
    refreshCreditCardSettings,
    refreshBudgetSettings,
  } = useAppData();

  const [completedAccountsOpen, setCompletedAccountsOpen] = useState(false);

  const [notifPayday, setNotifPayday] = useState(
    () => localStorage.getItem("notif:payday") !== "false",
  );
  const [notifCreditCard, setNotifCreditCard] = useState(
    () => localStorage.getItem("notif:creditCard") !== "false",
  );
  const [notifCreditCardWithdrawalRisk, setNotifCreditCardWithdrawalRisk] =
    useState(
      () => localStorage.getItem("notif:creditCardWithdrawalRisk") !== "false",
    );
  const [notifBudgetNegative, setNotifBudgetNegative] = useState(
    () => localStorage.getItem("notif:budgetNegative") !== "false",
  );
  const [notifLoanOverdue, setNotifLoanOverdue] = useState(
    () => localStorage.getItem("notif:loanOverdue") !== "false",
  );
  const [notifLoanOverdueDays, setNotifLoanOverdueDays] = useState<number>(
    () => {
      const raw = localStorage.getItem("notif:loanOverdueDays");
      const parsed = raw !== null ? parseInt(raw, 10) : 30;
      return isNaN(parsed) || parsed <= 0 ? 30 : parsed;
    },
  );
  const [notifAccountNegative, setNotifAccountNegative] = useState(
    () => localStorage.getItem("notif:accountNegative") !== "false",
  );

  const [addAccountOpened, { open: openAddAccount, close: closeAddAccount }] =
    useDisclosure(false);

  const [editingAccount, setEditingAccount] = useState<Account | undefined>(
    undefined,
  );

  function sortByCategory<
    T extends {
      type: Account["type"];
      category: Account["category"];
      is_system?: boolean;
      name: string;
    },
  >(list: T[]): T[] {
    return [...list].sort((a, b) => {
      const ai = categoryIndex(a.type, a.category, a.is_system ?? false);
      const bi = categoryIndex(b.type, b.category, b.is_system ?? false);
      if (ai !== bi) return ai - bi;
      return a.name.localeCompare(b.name, "ja");
    });
  }

  const assets = useMemo(
    () => sortByCategory(accounts.filter((a) => a.type === "asset")),
    [accounts],
  );
  const liabilities = useMemo(
    () => sortByCategory(accounts.filter((a) => a.type === "liability")),
    [accounts],
  );
  const equity = useMemo(
    () => sortByCategory(accounts.filter((a) => a.type === "equity")),
    [accounts],
  );
  const incomeAccounts = useMemo(
    () => sortByCategory(accounts.filter((a) => a.type === "income")),
    [accounts],
  );
  const expenseAccounts = useMemo(
    () => sortByCategory(accounts.filter((a) => a.type === "expense")),
    [accounts],
  );
  const completedAccounts = useMemo(
    () =>
      accounts.filter(
        (a) => a.is_completed && isLongTermLoanCategory(a.category),
      ),
    [accounts],
  );

  async function handleAddAccount(
    values: CreateAccountInput,
    ccSettings?: CreditCardSettingsInput,
  ) {
    let accountId: number;
    if (editingAccount) {
      const updated = await api.accounts.update(editingAccount.id, {
        name: values.name,
        category: values.category,
        payday: values.payday,
        is_depreciable: values.is_depreciable,
        include_in_allocatable: values.include_in_allocatable,
        budget_ratios: values.budget_ratios,
      });
      accountId = updated.id;
      showFeedback({ message: t("accountUpdated"), color: "teal" });
    } else {
      const created = await api.accounts.create(values);
      accountId = created.id;
      showFeedback({ message: t("accountAdded"), color: "teal" });
    }
    if (ccSettings) {
      await api.creditCardSettings.upsert({
        account_id: accountId,
        ...ccSettings,
      });
      void refreshCreditCardSettings();
    }
    closeAddAccount();
    setEditingAccount(undefined);
    refresh();
  }

  function handleEditAccount(account: Account) {
    setEditingAccount(account);
    openAddAccount();
  }

  async function savePreferredIds(ids: number[]) {
    await api.budget.updateSettings({ preferred_payment_account_ids: ids });
    void refreshBudgetSettings();
  }

  async function handlePreferredPaymentChange(
    index: number,
    value: string | null,
  ) {
    const current = budgetSettings?.preferred_payment_account_ids ?? [];
    const updated = [...current];
    if (value) {
      updated[index] = Number(value);
    } else {
      updated.splice(index, 1);
    }
    const deduped = updated.filter(
      (id, i) => id != null && updated.indexOf(id) === i,
    );
    await savePreferredIds(deduped);
  }

  async function handleMovePreferredPayment(
    index: number,
    direction: "up" | "down",
  ) {
    const current = budgetSettings?.preferred_payment_account_ids ?? [];
    const updated = [...current];
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= updated.length) return;
    [updated[index], updated[swapWith]] = [updated[swapWith]!, updated[index]!];
    await savePreferredIds(updated);
  }

  function handleDeleteAccount(_id: number) {
    showFeedback({ message: t("accountDeleted"), color: "orange" });
    refresh();
  }

  if (loading) {
    return (
      <Stack gap="lg">
        <Skeleton height={36} width={160} radius="sm" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Stack key={i} gap={6}>
            <Skeleton height={18} width={100} radius="sm" />
            <Skeleton height={34} radius="sm" />
            {Array.from({ length: 2 }).map((_, j) => (
              <Skeleton key={j} height={34} radius="sm" />
            ))}
          </Stack>
        ))}
      </Stack>
    );
  }

  if (error) {
    return <AppDataErrorAlert error={error} />;
  }

  const settingsNavItems = [
    {
      to: "/settings/initial_balance",
      Icon: IconDatabaseImport,
      label: t("tabInitialBalance"),
      desc: t("settingsNavInitialBalanceDesc"),
      color: "blue",
    },
    {
      to: "/settings/budget",
      Icon: IconChartPie,
      label: t("budgetTitle"),
      desc: t("settingsNavBudgetDesc"),
      color: "teal",
    },
    {
      to: "/settings/csv",
      Icon: IconFileSpreadsheet,
      label: t("settingsNavCsvTitle"),
      desc: t("settingsNavCsvDesc"),
      color: "cyan",
    },
    {
      to: "/settings/export",
      Icon: IconFileDownload,
      label: t("settingsNavExportTitle"),
      desc: t("settingsNavExportDesc"),
      color: "orange",
    },
    {
      to: "/settings/currencies",
      Icon: IconCurrencyDollar,
      label: t("settingsNavCurrencyTitle"),
      desc: t("settingsNavCurrencyDesc"),
      color: "yellow",
    },
    {
      to: "/settings/business",
      Icon: IconBriefcase,
      label: t("businessOwnerSettingsTitle"),
      desc: t("settingsNavBusinessDesc"),
      color: "violet",
    },
    {
      to: "/settings/guides",
      Icon: IconHelp,
      label: t("settingsNavGuidesTitle"),
      desc: t("settingsNavGuidesDesc"),
      color: "indigo",
    },
    {
      to: "/settings/bulk_edit",
      Icon: IconArrowsExchange,
      label: t("bulkEditSectionTitle"),
      desc: t("settingsNavBulkEditDesc"),
      color: "grape",
    },
    {
      to: "/settings/danger",
      Icon: IconAlertTriangle,
      label: t("dangerZoneTitle"),
      desc: t("settingsNavDangerDesc"),
      color: "red",
    },
  ] as const;

  return (
    <Stack gap="xl">
      {/* General */}
      <Stack gap="sm">
        <Group gap="xs">
          <IconSettings size={18} />
          <Title order={4}>{t("settingsSectionGeneral")}</Title>
        </Group>
        <Group>
          <Text size="sm" c="dimmed">
            {t("languageLabel")}
          </Text>
          <Select
            size="xs"
            w={140}
            value={locale}
            onChange={(v) => v && setLocale(v as Locale)}
            data={[
              { value: "ja", label: "日本語" },
              { value: "en", label: "English" },
              { value: "fr", label: "Français" },
              { value: "es", label: "Español" },
              { value: "zh-CN", label: "简体中文" },
              { value: "zh-TW", label: "繁體中文" },
            ]}
            allowDeselect={false}
            checkIconPosition="right"
            leftSection={<Flag locale={locale} />}
            renderOption={({ option }) => (
              <Group gap="xs" wrap="nowrap">
                <Flag locale={option.value as Locale} />
                <span>{option.label}</span>
              </Group>
            )}
          />
        </Group>
      </Stack>

      <Divider />

      {/* Notifications */}
      <Stack gap="xs">
        <Group gap="xs">
          <IconBell size={18} />
          <Title order={4}>{t("settingsSectionNotifications")}</Title>
        </Group>
        <Stack gap="md" mt={4}>
          <Stack gap={2}>
            <Switch
              label={t("notifPaydayToggle")}
              checked={notifPayday}
              onChange={(e) => {
                const v = e.currentTarget.checked;
                setNotifPayday(v);
                localStorage.setItem("notif:payday", String(v));
              }}
            />
            <Text size="xs" c="dimmed" ml={46}>
              {t("notifPaydayToggleHint")}
            </Text>
          </Stack>
          <Stack gap={2}>
            <Switch
              label={t("notifCreditCardToggle")}
              checked={notifCreditCard}
              onChange={(e) => {
                const v = e.currentTarget.checked;
                setNotifCreditCard(v);
                localStorage.setItem("notif:creditCard", String(v));
              }}
            />
            <Text size="xs" c="dimmed" ml={46}>
              {t("notifCreditCardToggleHint")}
            </Text>
          </Stack>
          <Stack gap={2}>
            <Switch
              label={t("notifCreditCardWithdrawalRiskToggle")}
              checked={notifCreditCardWithdrawalRisk}
              onChange={(e) => {
                const v = e.currentTarget.checked;
                setNotifCreditCardWithdrawalRisk(v);
                localStorage.setItem(
                  "notif:creditCardWithdrawalRisk",
                  String(v),
                );
              }}
            />
            <Text size="xs" c="dimmed" ml={46}>
              {t("notifCreditCardWithdrawalRiskToggleHint")}
            </Text>
          </Stack>
          <Stack gap={2}>
            <Switch
              label={t("notifBudgetNegativeToggle")}
              checked={notifBudgetNegative}
              onChange={(e) => {
                const v = e.currentTarget.checked;
                setNotifBudgetNegative(v);
                localStorage.setItem("notif:budgetNegative", String(v));
              }}
            />
            <Text size="xs" c="dimmed" ml={46}>
              {t("notifBudgetNegativeToggleHint")}
            </Text>
          </Stack>
          <Stack gap={2}>
            <Switch
              label={t("notifLoanOverdueToggle")}
              checked={notifLoanOverdue}
              onChange={(e) => {
                const v = e.currentTarget.checked;
                setNotifLoanOverdue(v);
                localStorage.setItem("notif:loanOverdue", String(v));
              }}
            />
            <Text size="xs" c="dimmed" ml={46}>
              {t("notifLoanOverdueToggleHint")}
            </Text>
            {notifLoanOverdue && (
              <NumberInput
                label={t("notifLoanOverdueDaysLabel")}
                value={notifLoanOverdueDays}
                min={1}
                max={3650}
                ml={46}
                w={160}
                mt={4}
                onChange={(v) => {
                  const n = typeof v === "number" && v > 0 ? v : 30;
                  setNotifLoanOverdueDays(n);
                  localStorage.setItem("notif:loanOverdueDays", String(n));
                }}
              />
            )}
          </Stack>
          <Stack gap={2}>
            <Switch
              label={t("notifAccountNegativeToggle")}
              checked={notifAccountNegative}
              onChange={(e) => {
                const v = e.currentTarget.checked;
                setNotifAccountNegative(v);
                localStorage.setItem("notif:accountNegative", String(v));
              }}
            />
            <Text size="xs" c="dimmed" ml={46}>
              {t("notifAccountNegativeToggleHint")}
            </Text>
          </Stack>
        </Stack>
      </Stack>

      <Divider />

      {/* Accounts */}
      <Stack gap="md">
        <Group justify="space-between">
          <Group gap="xs">
            <IconBook size={18} />
            <Title order={4}>{t("settingsSectionAccounts")}</Title>
          </Group>
          <Button variant="default" onClick={openAddAccount}>
            {t("addAccountBtn")}
          </Button>
        </Group>
        <AccountTable
          title={t("sectionAssets")}
          accounts={assets}
          onDeleteAccount={handleDeleteAccount}
          onEditAccount={handleEditAccount}
        />
        <AccountTable
          title={t("sectionLiabilities")}
          accounts={liabilities}
          onDeleteAccount={handleDeleteAccount}
          onEditAccount={handleEditAccount}
        />
        <AccountTable
          title={t("sectionEquity")}
          accounts={equity}
          onDeleteAccount={handleDeleteAccount}
          onEditAccount={handleEditAccount}
        />
        <AccountTable
          title={t("sectionIncome")}
          accounts={incomeAccounts}
          onDeleteAccount={handleDeleteAccount}
          onEditAccount={handleEditAccount}
        />
        <AccountTable
          title={t("sectionExpenses")}
          accounts={expenseAccounts}
          onDeleteAccount={handleDeleteAccount}
          onEditAccount={handleEditAccount}
        />
        {completedAccounts.length > 0 && (
          <Stack gap={4}>
            <Anchor
              size="sm"
              onClick={() => setCompletedAccountsOpen((v) => !v)}
            >
              {completedAccountsOpen ? "▼" : "▶"}{" "}
              {t("completedAccountsSection")} ({completedAccounts.length})
            </Anchor>
            <Collapse in={completedAccountsOpen}>
              <AccountTable
                title=""
                accounts={completedAccounts}
                onDeleteAccount={handleDeleteAccount}
                onEditAccount={handleEditAccount}
              />
            </Collapse>
          </Stack>
        )}
      </Stack>

      {/* Settings sub-page navigation */}
      <SimpleGrid cols={{ base: 2, sm: 3 }} mt="sm">
        {settingsNavItems.map(({ to, Icon, label, desc, color }) => (
          <Button
            key={to}
            component={Link}
            to={to}
            variant="default"
            w="100%"
            styles={{
              root: { height: "auto", padding: rem(16) },
              inner: { flexDirection: "column" },
              label: {
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: rem(4),
              },
            }}
          >
            <ThemeIcon size={48} radius="md" color={color} variant="light">
              <Icon size={26} />
            </ThemeIcon>
            <Text
              size="sm"
              fw={600}
              ta="center"
              style={{ whiteSpace: "normal" }}
            >
              {label}
            </Text>
            <Text
              size="xs"
              c="dimmed"
              ta="center"
              style={{ whiteSpace: "normal" }}
            >
              {desc}
            </Text>
          </Button>
        ))}
      </SimpleGrid>

      <Divider />

      {/* Preferred payment */}
      <Stack gap="xs">
        <Group gap="xs">
          <IconStar size={18} />
          <Title order={4}>{t("preferredPaymentMethod")}</Title>
        </Group>
        <Text size="sm" c="dimmed">
          {t("preferredPaymentMethodHint")}
        </Text>
        {(() => {
          const ids = budgetSettings?.preferred_payment_account_ids ?? [];
          const slots = [
            ...ids,
            ...(ids.length < 5 ? [null as number | null] : []),
          ];
          const accountOptions = [
            ...(assets.length > 0
              ? [
                  {
                    group: t("sectionAssets"),
                    items: assets.map((a) => ({
                      value: String(a.id),
                      label: a.name,
                    })),
                  },
                ]
              : []),
            ...(liabilities.length > 0
              ? [
                  {
                    group: t("sectionLiabilities"),
                    items: liabilities.map((a) => ({
                      value: String(a.id),
                      label: a.name,
                    })),
                  },
                ]
              : []),
          ];
          return (
            <Stack gap={6}>
              {slots.map((id, i) => (
                <Group key={i} gap="xs" align="center">
                  <Text size="xs" c="dimmed" w={16} ta="right">
                    {i + 1}.
                  </Text>
                  <Select
                    size="sm"
                    w={240}
                    placeholder={t("preferredPaymentMethodNone")}
                    clearable
                    value={id != null ? String(id) : null}
                    onChange={(v) => handlePreferredPaymentChange(i, v)}
                    data={accountOptions}
                  />
                  {id != null && (
                    <Group gap={2}>
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        disabled={i === 0}
                        onClick={() => handleMovePreferredPayment(i, "up")}
                      >
                        <IconArrowUp size={14} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        disabled={i >= ids.length - 1}
                        onClick={() => handleMovePreferredPayment(i, "down")}
                      >
                        <IconArrowDown size={14} />
                      </ActionIcon>
                    </Group>
                  )}
                </Group>
              ))}
            </Stack>
          );
        })()}
      </Stack>

      <AddAccountModal
        opened={addAccountOpened}
        onClose={() => {
          closeAddAccount();
          setEditingAccount(undefined);
        }}
        onSubmit={handleAddAccount}
        editAccount={editingAccount}
        budgetCategories={budgetCategories}
        isBusinessOwner={budgetSettings?.is_business_owner ?? false}
        existingCreditCardSettings={
          editingAccount
            ? (() => {
                const s = creditCardSettings.find(
                  (s) => s.account_id === editingAccount.id,
                );
                return s
                  ? {
                      closing_day: s.closing_day,
                      confirmation_day: s.confirmation_day,
                      withdrawal_day: s.withdrawal_day,
                      billing_offset_months: s.billing_offset_months,
                      withdrawal_account_id: s.withdrawal_account_id ?? null,
                    }
                  : undefined;
              })()
            : undefined
        }
        withdrawalAccountOptions={assets.filter((account) => !account.is_system)}
      />
    </Stack>
  );
}
