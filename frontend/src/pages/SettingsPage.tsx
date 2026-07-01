import {
  ActionIcon,
  Alert,
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
  useMantineColorScheme,
  rem,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconArrowDown,
  IconArrowUp,
  IconArrowsExchange,
  IconBook,
  IconBriefcase,
  IconChartPie,
  IconDatabaseImport,
  IconDeviceDesktop,
  IconFileDownload,
  IconFileSpreadsheet,
  IconHelp,
  IconKey,
  IconListCheck,
  IconSettings,
  IconStar,
  IconCurrencyDollar,
  IconLock,
  IconMoon,
  IconSun,
} from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { useDisclosure } from "@mantine/hooks";
import { useMemo, useState } from "react";
import { isLongTermLoanCategory } from "@balance-sheet/shared";
import { api } from "../api/client";
import { useLang, type Locale } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import {
  categoryIndex,
  isUserSelectableAccount,
  toAccountSelectOption,
} from "../lib/accountUtils";
import { renderAccountOption } from "../lib/accountSelect";
import { AccountTable } from "../components/AccountTable";
import { AddAccountModal } from "../components/AddAccountModal";
import { AppDataErrorAlert } from "../components/AppDataErrorAlert";
import { PwaInstallSetting } from "../components/PwaInstallSetting";
import type {
  Account,
  CreateAccountInput,
} from "@balance-sheet/shared";
import type { CreditCardSettingsInput } from "../components/AddAccountModal";
import { showFeedback } from "../lib/feedback";
import * as Flags from "country-flag-icons/react/1x1";
import { usePrivacy } from "../context/PrivacyContext";

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

const settingsSwitchClassNames = {
  root: "settings-inline-control",
};

export default function SettingsPage() {
  const { t, locale, setLocale } = useLang();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const {
    privacyMode,
    maskAccountNames,
    setPrivacyMode,
    setMaskAccountNames,
  } = usePrivacy();
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

  const [taskPayday, setTaskPayday] = useState(
    () => localStorage.getItem("notif:payday") !== "false",
  );
  const [taskCreditCard, setTaskCreditCard] = useState(
    () => localStorage.getItem("notif:creditCard") !== "false",
  );
  const [taskCreditCardWithdrawalRisk, setTaskCreditCardWithdrawalRisk] =
    useState(
      () => localStorage.getItem("notif:creditCardWithdrawalRisk") !== "false",
    );
  const [taskBudgetNegative, setTaskBudgetNegative] = useState(
    () => localStorage.getItem("notif:budgetNegative") !== "false",
  );
  const [taskLoanOverdue, setTaskLoanOverdue] = useState(
    () => localStorage.getItem("notif:loanOverdue") !== "false",
  );
  const [taskLoanOverdueDays, setTaskLoanOverdueDays] = useState<number>(
    () => {
      const raw = localStorage.getItem("notif:loanOverdueDays");
      const parsed = raw !== null ? parseInt(raw, 10) : 30;
      return isNaN(parsed) || parsed <= 0 ? 30 : parsed;
    },
  );
  const [taskAccountNegative, setTaskAccountNegative] = useState(
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
    if (privacyMode) return;
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
    if (privacyMode) return;
    setEditingAccount(account);
    openAddAccount();
  }

  async function savePreferredIds(ids: number[]) {
    if (privacyMode) return;
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
    if (privacyMode) return;
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
      to: "/settings/product-api",
      Icon: IconKey,
      label: t("productApiSettingsTitle"),
      desc: t("settingsNavProductApiDesc"),
      color: "lime",
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

  const colorSchemeIcon =
    colorScheme === "auto" ? (
      <IconDeviceDesktop size={16} />
    ) : colorScheme === "dark" ? (
      <IconMoon size={16} />
    ) : (
      <IconSun size={16} />
    );

  return (
    <Stack gap="xl">
      {/* General */}
      <Stack gap="xs">
        <Group gap="xs">
          <IconSettings size={18} />
          <Title order={4}>{t("settingsSectionGeneral")}</Title>
        </Group>
        <Stack gap="sm">
          <Group gap="xs" align="center" wrap="nowrap">
            <Text
              size="sm"
              c="dimmed"
              w={120}
              style={{ flexShrink: 0, whiteSpace: "nowrap" }}
            >
              {t("colorThemeLabel")}
            </Text>
            <Select
              aria-label={t("colorThemeLabel")}
              size="xs"
              flex={1}
              maw={220}
              style={{ minWidth: 0 }}
              value={colorScheme}
              onChange={(v) => {
                if (v === "light" || v === "dark" || v === "auto") {
                  setColorScheme(v);
                }
              }}
              data={[
                { value: "auto", label: t("colorThemeAuto") },
                { value: "light", label: t("colorThemeLight") },
                { value: "dark", label: t("colorThemeDark") },
              ]}
              allowDeselect={false}
              checkIconPosition="right"
              leftSection={colorSchemeIcon}
              renderOption={({ option }) => (
                <Group gap="xs" wrap="nowrap">
                  {option.value === "auto" ? (
                    <IconDeviceDesktop size={16} />
                  ) : option.value === "dark" ? (
                    <IconMoon size={16} />
                  ) : (
                    <IconSun size={16} />
                  )}
                  <span>{option.label}</span>
                </Group>
              )}
            />
          </Group>
          <Group gap="xs" align="center" wrap="nowrap">
            <Text
              size="sm"
              c="dimmed"
              w={120}
              style={{ flexShrink: 0, whiteSpace: "nowrap" }}
            >
              {t("languageLabel")}
            </Text>
            <Select
              aria-label={t("languageLabel")}
              size="xs"
              flex={1}
              maw={220}
              style={{ minWidth: 0 }}
              value={locale}
              onChange={(v) => v && setLocale(v as Locale)}
              disabled={privacyMode}
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
        <Stack gap={4} mt="xs">
          <Switch
            classNames={settingsSwitchClassNames}
            label={t("privacyModeToggle")}
            checked={privacyMode}
            onChange={(e) => setPrivacyMode(e.currentTarget.checked)}
          />
          <Text size="xs" c="dimmed" ml={46}>
            {t("privacyModeToggleHint")}
          </Text>
        </Stack>
        <Stack gap={4}>
          <Switch
            classNames={settingsSwitchClassNames}
            label={t("privacyMaskAccountsToggle")}
            checked={privacyMode && maskAccountNames}
            disabled={!privacyMode}
            onChange={(e) => setMaskAccountNames(e.currentTarget.checked)}
          />
          <Text size="xs" c="dimmed" ml={46}>
            {t("privacyMaskAccountsToggleHint")}
          </Text>
        </Stack>
      </Stack>

      {privacyMode && (
        <>
          <Alert color="gray" variant="light" icon={<IconLock size={16} />}>
            <Stack gap="xs">
              <Text size="sm">{t("privacySettingsLockedMessage")}</Text>
              <Button
                component={Link}
                to="/settings/guides"
                variant="default"
                size="xs"
                style={{ alignSelf: "flex-start" }}
              >
                {t("settingsNavGuidesTitle")}
              </Button>
            </Stack>
          </Alert>
        </>
      )}

      {privacyMode ? null : (
        <>

      <Divider />

      {/* Tasks */}
      <Stack gap="xs">
        <Group gap="xs">
          <IconListCheck size={18} />
          <Title order={4}>{t("settingsSectionTasks")}</Title>
        </Group>
        <Stack gap="md" mt={4}>
          <Stack gap={2}>
            <Switch
              classNames={settingsSwitchClassNames}
              label={t("taskPaydayToggle")}
              checked={taskPayday}
              onChange={(e) => {
                const v = e.currentTarget.checked;
                setTaskPayday(v);
                localStorage.setItem("notif:payday", String(v));
              }}
            />
            <Text size="xs" c="dimmed" ml={46}>
              {t("taskPaydayToggleHint")}
            </Text>
          </Stack>
          <Stack gap={2}>
            <Switch
              classNames={settingsSwitchClassNames}
              label={t("taskCreditCardToggle")}
              checked={taskCreditCard}
              onChange={(e) => {
                const v = e.currentTarget.checked;
                setTaskCreditCard(v);
                localStorage.setItem("notif:creditCard", String(v));
              }}
            />
            <Text size="xs" c="dimmed" ml={46}>
              {t("taskCreditCardToggleHint")}
            </Text>
          </Stack>
          <Stack gap={2}>
            <Switch
              classNames={settingsSwitchClassNames}
              label={t("taskCreditCardWithdrawalRiskToggle")}
              checked={taskCreditCardWithdrawalRisk}
              onChange={(e) => {
                const v = e.currentTarget.checked;
                setTaskCreditCardWithdrawalRisk(v);
                localStorage.setItem(
                  "notif:creditCardWithdrawalRisk",
                  String(v),
                );
              }}
            />
            <Text size="xs" c="dimmed" ml={46}>
              {t("taskCreditCardWithdrawalRiskToggleHint")}
            </Text>
          </Stack>
          <Stack gap={2}>
            <Switch
              classNames={settingsSwitchClassNames}
              label={t("taskBudgetNegativeToggle")}
              checked={taskBudgetNegative}
              onChange={(e) => {
                const v = e.currentTarget.checked;
                setTaskBudgetNegative(v);
                localStorage.setItem("notif:budgetNegative", String(v));
              }}
            />
            <Text size="xs" c="dimmed" ml={46}>
              {t("taskBudgetNegativeToggleHint")}
            </Text>
          </Stack>
          <Stack gap={2}>
            <Switch
              classNames={settingsSwitchClassNames}
              label={t("taskLoanOverdueToggle")}
              checked={taskLoanOverdue}
              onChange={(e) => {
                const v = e.currentTarget.checked;
                setTaskLoanOverdue(v);
                localStorage.setItem("notif:loanOverdue", String(v));
              }}
            />
            <Text size="xs" c="dimmed" ml={46}>
              {t("taskLoanOverdueToggleHint")}
            </Text>
            {taskLoanOverdue && (
              <NumberInput
                label={t("taskLoanOverdueDaysLabel")}
                value={taskLoanOverdueDays}
                min={1}
                max={3650}
                ml={46}
                w={160}
                mt={4}
                onChange={(v) => {
                  const n = typeof v === "number" && v > 0 ? v : 30;
                  setTaskLoanOverdueDays(n);
                  localStorage.setItem("notif:loanOverdueDays", String(n));
                }}
              />
            )}
          </Stack>
          <Stack gap={2}>
            <Switch
              classNames={settingsSwitchClassNames}
              label={t("taskAccountNegativeToggle")}
              checked={taskAccountNegative}
              onChange={(e) => {
                const v = e.currentTarget.checked;
                setTaskAccountNegative(v);
                localStorage.setItem("notif:accountNegative", String(v));
              }}
            />
            <Text size="xs" c="dimmed" ml={46}>
              {t("taskAccountNegativeToggleHint")}
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
                    items: assets
                      .filter(isUserSelectableAccount)
                      .map((a) => toAccountSelectOption(a, t)),
                  },
                ]
              : []),
            ...(liabilities.length > 0
              ? [
                  {
                    group: t("sectionLiabilities"),
                    items: liabilities
                      .filter(isUserSelectableAccount)
                      .map((a) => toAccountSelectOption(a, t)),
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
                    renderOption={renderAccountOption as never}
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

      <PwaInstallSetting />

        </>
      )}

      <AddAccountModal
        opened={privacyMode ? false : addAccountOpened}
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
