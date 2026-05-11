import {
  ActionIcon,
  Anchor,
  Group,
  Indicator,
  Popover,
  Select,
  Stack,
  Text,
  Title,
  UnstyledButton,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import {
  IconBell,
  IconBook,
  IconCurrencyDollar,
  IconLayoutDashboard,
  IconMoon,
  IconPencil,
  IconReportMoney,
  IconSettings,
  IconSun,
} from "@tabler/icons-react";
import * as Flags from "country-flag-icons/react/3x2";
import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  isShortTermBorrowingCategory,
  isShortTermLendingCategory,
} from "@balance-sheet/shared";
import { findOverdueShortTermLoanAccounts } from "../pages/dbPageUtils";
import { useAppData } from "../context/AppDataContext";
import { useLang } from "../i18n";
import { formatJPY } from "../lib/numberFormat";
import { systemAccountTranslationKey } from "../lib/accountUtils";
import { CryptoCurrencyIcon } from "./CryptoCurrencyIcon";
import { CustomCurrencyIcon } from "./CustomCurrencyIcon";
import type { CryptoIconStyle } from "../lib/cryptoCurrencyIcons";
import {
  computeCreditCardWithdrawalRiskNotifications,
  type CreditCardWithdrawalRiskNotification,
} from "../lib/creditCardWithdrawalRisk";

const CURRENCY_TO_COUNTRY: Record<string, string> = {
  JPY: "JP",
  USD: "US",
  EUR: "EU",
  GBP: "GB",
  AUD: "AU",
  CAD: "CA",
  CHF: "CH",
  CNY: "CN",
  HKD: "HK",
  KRW: "KR",
  SGD: "SG",
  THB: "TH",
  IDR: "ID",
  MYR: "MY",
  PHP: "PH",
  INR: "IN",
  SEK: "SE",
  NOK: "NO",
  DKK: "DK",
  NZD: "NZ",
  MXN: "MX",
  BRL: "BR",
  ZAR: "ZA",
  TRY: "TR",
  PLN: "PL",
  CZK: "CZ",
  HUF: "HU",
};

const CRYPTO_CODES = new Set([
  "BTC",
  "ETH",
  "SOL",
  "SKR",
  "BNB",
  "USDT",
  "USDC",
  "XRP",
  "ADA",
  "DOGE",
  "AVAX",
  "DOT",
  "LINK",
  "LTC",
  "ATOM",
]);

function CurrencyOptionIcon({
  code,
  cryptoIconStyle,
  customIcon,
}: {
  code: string;
  cryptoIconStyle: CryptoIconStyle;
  customIcon?: string | null;
}) {
  if (CRYPTO_CODES.has(code)) {
    return (
      <CryptoCurrencyIcon code={code} styleMode={cryptoIconStyle} size={20} />
    );
  }

  const country = CURRENCY_TO_COUNTRY[code];
  if (!country) return <CustomCurrencyIcon icon={customIcon} size={20} />;

  const Flag = (
    Flags as unknown as Record<
      string,
      React.ComponentType<{ style?: React.CSSProperties }>
    >
  )[country];

  if (!Flag) return <IconCurrencyDollar size={16} />;
  return <Flag style={{ width: 18, height: "auto", display: "block" }} />;
}

function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme("light");
  return (
    <ActionIcon
      variant="default"
      size="md"
      onClick={() => setColorScheme(computed === "light" ? "dark" : "light")}
      aria-label="Toggle color scheme"
    >
      {computed === "light" ? <IconMoon size={16} /> : <IconSun size={16} />}
    </ActionIcon>
  );
}

interface AppNotification {
  id: string;
  message: string;
}

function usePaydayNotifications(): AppNotification[] {
  const { accounts, journal } = useAppData();

  if (localStorage.getItem("notif:payday") === "false") return [];

  const now = new Date();
  const todayDay = now.getDate();
  const thisYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const notifications: AppNotification[] = [];

  for (const account of accounts) {
    if (account.type !== "income") continue;
    if (!account.payday) continue;
    if (todayDay < account.payday) continue;

    // Check if any journal entry this month credits this income account
    const hasEntry = journal.some(
      (entry) =>
        entry.date.startsWith(thisYM) &&
        entry.lines.some(
          (line) => line.account_id === account.id && line.credit > 0,
        ),
    );

    if (!hasEntry) {
      notifications.push({
        id: `payday-${account.id}`,
        message: account.name,
      });
    }
  }

  return notifications;
}

function useBudgetNegativeNotification(): {
  show: boolean;
  allocatableToday: number;
  allocatableTotal: number;
} {
  const { allocatableToday, allocatableTotal } = useAppData();
  const enabled = localStorage.getItem("notif:budgetNegative") !== "false";
  return {
    show: enabled && (allocatableToday < 0 || allocatableTotal < 0),
    allocatableToday,
    allocatableTotal,
  };
}

interface OverdueLoanNotification extends AppNotification {
  daysDiff: number;
}

function useOverdueLoanNotifications(): OverdueLoanNotification[] {
  const { accounts, journal } = useAppData();

  if (localStorage.getItem("notif:loanOverdue") === "false") return [];

  const raw = localStorage.getItem("notif:loanOverdueDays");
  const daysThreshold = raw !== null ? parseInt(raw, 10) : 30;
  if (isNaN(daysThreshold) || daysThreshold <= 0) return [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const loanAccounts = accounts.flatMap((account) => {
    const isShortTerm =
      isShortTermLendingCategory(account.category as never) ||
      isShortTermBorrowingCategory(account.category as never);
    if (!isShortTerm) return [];

    const entries = journal
      .filter((e) => e.lines.some((l) => l.account_id === account.id))
      .map((e) => {
        let netChange = 0;
        for (const l of e.lines) {
          if (l.account_id !== account.id) continue;
          if (account.type === "asset" || account.type === "expense") {
            netChange += l.debit - l.credit;
          } else {
            netChange += l.credit - l.debit;
          }
        }
        return { entry: e, netChange };
      });

    return [{ account, entries }];
  });

  return findOverdueShortTermLoanAccounts(
    loanAccounts,
    daysThreshold,
    today,
  ).map(({ account, daysDiff }) => ({
    id: `loan-overdue-${account.id}`,
    message: account.name,
    daysDiff,
  }));
}

function useNegativeAccountNotifications(): AppNotification[] {
  const { accounts } = useAppData();
  const { t } = useLang();

  if (localStorage.getItem("notif:accountNegative") === "false") return [];

  const notifications: AppNotification[] = [];

  for (const account of accounts) {
    if (account.name === "__system:unknown_funds__") continue;
    if ((account.balance ?? 0) >= -0.001) continue;

    const label = (() => {
      if (account.is_system) {
        const k = systemAccountTranslationKey(account.name);
        if (k) return t(k);
      }
      return account.name;
    })();

    notifications.push({
      id: `account-negative-${account.id}`,
      message: label,
    });
  }

  return notifications;
}

function useCreditCardWithdrawalRiskNotifications(): CreditCardWithdrawalRiskNotification[] {
  const { accounts, creditCardSettings, creditCardState } = useAppData();

  if (localStorage.getItem("notif:creditCardWithdrawalRisk") === "false") {
    return [];
  }

  return computeCreditCardWithdrawalRiskNotifications({
    today: new Date(),
    accounts,
    creditCardSettings,
    creditCardState,
  });
}

function NotificationBell({ disabled = false }: { disabled?: boolean }) {
  const { t, locale } = useLang();
  const navigate = useNavigate();
  const [opened, setOpened] = useState(false);
  const paydayNotifications = usePaydayNotifications();
  const budgetNotif = useBudgetNegativeNotification();
  const overdueLoanNotifications = useOverdueLoanNotifications();
  const negativeAccountNotifications = useNegativeAccountNotifications();
  const creditCardWithdrawalRiskNotifications =
    useCreditCardWithdrawalRiskNotifications();
  const totalCount =
    paydayNotifications.length +
    (budgetNotif.show ? 1 : 0) +
    (overdueLoanNotifications.length > 0 ? 1 : 0) +
    (negativeAccountNotifications.length > 0 ? 1 : 0) +
    (creditCardWithdrawalRiskNotifications.length > 0 ? 1 : 0);
  const effectiveCount = disabled ? 0 : totalCount;

  useEffect(() => {
    if (disabled) setOpened(false);
  }, [disabled]);

  return (
    <>
      {opened && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 199,
          }}
          onClick={() => setOpened(false)}
        />
      )}
      <Popover
        opened={opened}
        onClose={() => setOpened(false)}
        position="bottom-end"
        withArrow
        shadow="md"
        withinPortal
        zIndex={200}
      >
        <Popover.Target>
          <Indicator
            disabled={effectiveCount === 0}
            color="red"
            size={16}
            label={effectiveCount > 0 ? String(effectiveCount) : undefined}
            offset={4}
          >
            <ActionIcon
              variant="default"
              size="md"
              disabled={disabled}
              onClick={() => {
                if (disabled) return;
                setOpened((o) => !o);
              }}
              aria-label={t("notifications")}
              title={t("notifications")}
            >
              <IconBell size={16} />
            </ActionIcon>
          </Indicator>
        </Popover.Target>

        <Popover.Dropdown
          p="xs"
          miw={240}
          maw={320}
          style={{ wordBreak: "break-word" }}
        >
          {totalCount === 0 ? (
            <Text size="sm" c="dimmed" px={4} py={2}>
              {t("noNotifications")}
            </Text>
          ) : (
            <Stack gap={8}>
              {budgetNotif.show && (
                <UnstyledButton
                  px={4}
                  py={6}
                  style={{ borderRadius: 4 }}
                  onClick={() => {
                    navigate("/");
                    setOpened(false);
                  }}
                >
                  <Stack gap={4}>
                    <Text size="sm" c="red">
                      {t("notificationBudgetNegative")}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t("assignableMoneyTodayLabel")}:{" "}
                      <Text
                        span
                        fw={600}
                        c={budgetNotif.allocatableToday >= 0 ? "teal" : "red"}
                      >
                        {formatJPY(budgetNotif.allocatableToday, locale)}
                      </Text>
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t("assignableMoneyTotalLabel")}:{" "}
                      <Text
                        span
                        fw={600}
                        c={budgetNotif.allocatableTotal >= 0 ? "teal" : "red"}
                      >
                        {formatJPY(budgetNotif.allocatableTotal, locale)}
                      </Text>
                    </Text>
                  </Stack>
                </UnstyledButton>
              )}
              {paydayNotifications.length > 0 && (
                <Stack gap={4}>
                  <Text size="xs" c="dimmed" fw={600} px={4}>
                    {t("notificationPaydayUnrecorded")}
                  </Text>
                  {paydayNotifications.map((n) => (
                    <UnstyledButton
                      key={n.id}
                      px={4}
                      py={4}
                      style={{ borderRadius: 4 }}
                      onClick={() => {
                        navigate("/input");
                        setOpened(false);
                      }}
                    >
                      <Text size="sm">{n.message}</Text>
                    </UnstyledButton>
                  ))}
                </Stack>
              )}
              {creditCardWithdrawalRiskNotifications.length > 0 && (
                <Stack gap={4}>
                  <Text size="xs" c="dimmed" fw={600} px={4}>
                    {t("notificationCreditCardWithdrawalRiskSection")}
                  </Text>
                  {creditCardWithdrawalRiskNotifications.map((n) => (
                    <UnstyledButton
                      key={n.id}
                      px={4}
                      py={4}
                      style={{ borderRadius: 4 }}
                      onClick={() => {
                        navigate("/settings");
                        setOpened(false);
                      }}
                    >
                      <Stack gap={2}>
                        <Group gap={8} wrap="nowrap">
                          <Text size="sm" style={{ flex: 1 }}>
                            {n.creditCardName}
                          </Text>
                          <Text size="xs" c="red">
                            {formatJPY(n.combinedProjectedBalance, locale)}
                          </Text>
                        </Group>
                        <Text size="xs" c="dimmed">
                          {t("notificationCreditCardWithdrawalRiskDetail")
                            .replace("{date}", n.withdrawalDate)
                            .replace("{account}", n.withdrawalAccountName)
                            .replace(
                              "{amount}",
                              formatJPY(n.combinedAmount, locale),
                            )}
                        </Text>
                      </Stack>
                    </UnstyledButton>
                  ))}
                </Stack>
              )}
              {overdueLoanNotifications.length > 0 && (
                <Stack gap={4}>
                  <Text size="xs" c="dimmed" fw={600} px={4}>
                    {t("notificationLoanOverdueSection")}
                  </Text>
                  {overdueLoanNotifications.map((n) => (
                    <UnstyledButton
                      key={n.id}
                      px={4}
                      py={4}
                      style={{ borderRadius: 4 }}
                      onClick={() => {
                        navigate("/fs/db");
                        setOpened(false);
                      }}
                    >
                      <Group gap={8} wrap="nowrap">
                        <Text size="sm" style={{ flex: 1 }}>
                          {n.message}
                        </Text>
                        <Text size="xs" c="orange">
                          {t("notificationLoanOverdueDays").replace(
                            "{days}",
                            String(n.daysDiff),
                          )}
                        </Text>
                      </Group>
                    </UnstyledButton>
                  ))}
                </Stack>
              )}
              {negativeAccountNotifications.length > 0 && (
                <Stack gap={4}>
                  <Text size="xs" c="dimmed" fw={600} px={4}>
                    {t("notificationAccountNegativeSection")}
                  </Text>
                  {negativeAccountNotifications.map((n) => (
                    <UnstyledButton
                      key={n.id}
                      px={4}
                      py={4}
                      style={{ borderRadius: 4 }}
                      onClick={() => {
                        navigate("/settings");
                        setOpened(false);
                      }}
                    >
                      <Text size="sm" c="red">
                        {n.message}
                      </Text>
                    </UnstyledButton>
                  ))}
                </Stack>
              )}
            </Stack>
          )}
        </Popover.Dropdown>
      </Popover>
    </>
  );
}

function CurrencySwitcher() {
  const {
    enabledCurrencies,
    displayCurrency,
    setDisplayCurrency,
    cryptoIconStyle,
  } = useAppData();

  if (enabledCurrencies.length <= 1) return null;

  const options = enabledCurrencies.map((c) => ({
    value: c.code,
    label: c.code,
    customIcon: c.custom_icon,
  }));
  const selectedCurrency = enabledCurrencies.find((c) => c.code === displayCurrency);

  return (
    <Select
      size="xs"
      w={112}
      value={displayCurrency}
      onChange={(v) => v && setDisplayCurrency(v)}
      data={options}
      allowDeselect={false}
      leftSection={
        <CurrencyOptionIcon
          code={displayCurrency}
          cryptoIconStyle={cryptoIconStyle}
          customIcon={selectedCurrency?.custom_icon}
        />
      }
      leftSectionPointerEvents="none"
      renderOption={({ option }) => (
        <Group gap={8} wrap="nowrap">
          <CurrencyOptionIcon
            code={option.value}
            cryptoIconStyle={cryptoIconStyle}
            customIcon={
              options.find((currency) => currency.value === option.value)
                ?.customIcon
            }
          />
          <Text size="sm">{option.label}</Text>
        </Group>
      )}
      checkIconPosition="right"
      comboboxProps={{ withinPortal: true }}
    />
  );
}

interface NavLinkItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  end?: boolean;
}

interface TopNavProps {
  disableNavigation?: boolean;
  disableNotifications?: boolean;
}

export function TopNav({
  disableNavigation = false,
  disableNotifications = false,
}: TopNavProps) {
  const { t } = useLang();
  const computed = useComputedColorScheme("light");

  const navItems: NavLinkItem[] = [
    {
      to: "/",
      icon: <IconLayoutDashboard size={14} />,
      label: t("navOverview"),
      end: true,
    },
    { to: "/input", icon: <IconPencil size={14} />, label: t("navInput") },
    { to: "/fs", icon: <IconReportMoney size={14} />, label: t("navFS") },
    { to: "/ledger", icon: <IconBook size={14} />, label: t("navLedger") },
    {
      to: "/settings",
      icon: <IconSettings size={14} />,
      label: t("navSettings"),
    },
  ];

  return (
    <Group h="100%" px="md" justify="space-between">
      <Group gap="xl">
        <Title order={4}>{t("appTitle")}</Title>
        {/* Desktop nav links */}
        <Group gap="md" visibleFrom="sm">
          {navItems.map((item) =>
            disableNavigation ? (
              <Anchor
                key={item.to}
                component="span"
                size="sm"
                fw={400}
                c={computed === "dark" ? "gray.3" : "dimmed"}
                style={{ opacity: 0.6, cursor: "not-allowed" }}
              >
                <Group gap={4} align="center" wrap="nowrap">
                  {item.icon}
                  {item.label}
                </Group>
              </Anchor>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                style={{ textDecoration: "none" }}
              >
                {({ isActive }) => (
                  <Anchor
                    component="span"
                    size="sm"
                    fw={isActive ? 700 : 400}
                    c={
                      isActive
                        ? computed === "dark"
                          ? "blue.4"
                          : "blue"
                        : computed === "dark"
                          ? "gray.3"
                          : "dimmed"
                    }
                  >
                    <Group gap={4} align="center" wrap="nowrap">
                      {item.icon}
                      {item.label}
                    </Group>
                  </Anchor>
                )}
              </NavLink>
            ),
          )}
        </Group>
      </Group>
      <Group gap="xs">
        <CurrencySwitcher />
        <NotificationBell disabled={disableNotifications} />
        <ColorSchemeToggle />
      </Group>
    </Group>
  );
}
