import {
  ActionIcon,
  Anchor,
  Group,
  Indicator,
  Popover,
  Select,
  Stack,
  Text,
  ThemeIcon,
  Title,
  UnstyledButton,
  useComputedColorScheme,
} from "@mantine/core";
import {
  IconBook,
  IconLayoutDashboard,
  IconListCheck,
  IconPencil,
  IconReportMoney,
  IconSettings,
  IconWifiOff,
} from "@tabler/icons-react";
import { useMediaQuery } from "@mantine/hooks";
import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  isShortTermBorrowingCategory,
  isShortTermLendingCategory,
  resolveMonthlyPayday,
} from "@balance-sheet/shared";
import { VERSION } from "../lib/version";
import { findOverdueShortTermLoanAccounts } from "../pages/dbPageUtils";
import { useAppData } from "../context/AppDataContext";
import { useLang } from "../i18n";
import { formatJPY } from "../lib/numberFormat";
import { accountDisplayNameFromName } from "../lib/accountUtils";
import type { CryptoIconStyle } from "../lib/cryptoCurrencyIcons";
import { getEffectiveSymbol } from "../lib/currencyUtils";
import { CurrencyOptionIcon } from "./CurrencyOptionIcon";
import {
  computeCreditCardWithdrawalRiskTasks,
  type CreditCardWithdrawalRiskTask,
} from "../lib/creditCardWithdrawalRisk";
import {
  computeCreditCardImportTasks,
  type CreditCardImportTask,
} from "../lib/creditCardImportTasks";
import { useOfflineDrafts } from "../lib/offlineDrafts";
import { useOnlineStatus } from "../hooks/useOnlineStatus";

interface AppTask {
  id: string;
  message: string;
}

function usePaydayTasks(): AppTask[] {
  const { accounts, journal } = useAppData();
  const { t } = useLang();

  if (localStorage.getItem("notif:payday") === "false") return [];

  const now = new Date();
  const todayDay = now.getDate();
  const thisYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const tasks: AppTask[] = [];

  for (const account of accounts) {
    if (account.type !== "income") continue;
    if (account.payday === null || account.payday === undefined) continue;
    const payday = resolveMonthlyPayday(thisYM, account.payday);
    if (todayDay < payday) continue;

    // Check if any journal entry this month credits this income account
    const hasEntry = journal.some(
      (entry) =>
        entry.date.startsWith(thisYM) &&
        entry.lines.some(
          (line) => line.account_id === account.id && line.credit > 0,
        ),
    );

    if (!hasEntry) {
      tasks.push({
        id: `payday-${account.id}`,
        message: accountDisplayNameFromName(account.name, t),
      });
    }
  }

  return tasks;
}

function useBudgetNegativeTask(): {
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

interface OverdueLoanTask extends AppTask {
  daysDiff: number;
}

function useOverdueLoanTasks(): OverdueLoanTask[] {
  const { accounts, journal } = useAppData();
  const { t } = useLang();

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
    message: accountDisplayNameFromName(account.name, t),
    daysDiff,
  }));
}

function useNegativeAccountTasks(): AppTask[] {
  const { accounts } = useAppData();
  const { t } = useLang();

  if (localStorage.getItem("notif:accountNegative") === "false") return [];

  const tasks: AppTask[] = [];

  for (const account of accounts) {
    if (account.name === "__system:unknown_funds__") continue;
    if ((account.balance ?? 0) >= -0.001) continue;

    const label = accountDisplayNameFromName(account.name, t);

    tasks.push({
      id: `account-negative-${account.id}`,
      message: label,
    });
  }

  return tasks;
}

function useCreditCardWithdrawalRiskTasks(): CreditCardWithdrawalRiskTask[] {
  const { accounts, creditCardSettings, creditCardState } = useAppData();

  if (localStorage.getItem("notif:creditCardWithdrawalRisk") === "false") {
    return [];
  }

  return computeCreditCardWithdrawalRiskTasks({
    today: new Date(),
    accounts,
    creditCardSettings,
    creditCardState,
  });
}

function useCreditCardImportTasks(): CreditCardImportTask[] {
  const { accounts, creditCardSettings, creditCardStatementCompletions } =
    useAppData();

  if (localStorage.getItem("notif:creditCard") === "false") return [];

  return computeCreditCardImportTasks({
    today: new Date(),
    accounts,
    creditCardSettings,
    completions: creditCardStatementCompletions,
  });
}

function formatTaskMonth(yearMonth: string, locale: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
  }).format(new Date(year, month - 1, 1));
}

function TaskMenu({ disabled = false }: { disabled?: boolean }) {
  const { t, locale } = useLang();
  const navigate = useNavigate();
  const [opened, setOpened] = useState(false);
  const paydayTasks = usePaydayTasks();
  const budgetTask = useBudgetNegativeTask();
  const overdueLoanTasks = useOverdueLoanTasks();
  const negativeAccountTasks = useNegativeAccountTasks();
  const creditCardImportTasks = useCreditCardImportTasks();
  const creditCardWithdrawalRiskTasks = useCreditCardWithdrawalRiskTasks();
  const isOnline = useOnlineStatus();
  const offlineDrafts = useOfflineDrafts();
  const pendingOfflineDrafts = isOnline ? offlineDrafts : [];
  const totalCount =
    pendingOfflineDrafts.length +
    paydayTasks.length +
    creditCardImportTasks.length +
    (budgetTask.show ? 1 : 0) +
    (overdueLoanTasks.length > 0 ? 1 : 0) +
    (negativeAccountTasks.length > 0 ? 1 : 0) +
    (creditCardWithdrawalRiskTasks.length > 0 ? 1 : 0);
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
            styles={{ indicator: { pointerEvents: "none" } }}
          >
            <ActionIcon
              variant="default"
              size="md"
              disabled={disabled}
              onClick={() => {
                if (disabled) return;
                setOpened((o) => !o);
              }}
              aria-label={t("tasks")}
              title={t("tasks")}
            >
              <IconListCheck size={16} />
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
              {t("noTasks")}
            </Text>
          ) : (
            <Stack gap={8}>
              {pendingOfflineDrafts.length > 0 && (
                <Stack gap={4}>
                  <Text size="xs" c="dimmed" fw={600} px={4}>
                    {t("taskOfflineDraftsSection")}
                  </Text>
                  {pendingOfflineDrafts.map((draft) => (
                    <UnstyledButton
                      key={draft.id}
                      px={4}
                      py={4}
                      style={{ borderRadius: 4 }}
                      onClick={() => {
                        navigate("/input", {
                          state: { offlineDraftId: draft.id, tab: "simple" },
                        });
                        setOpened(false);
                      }}
                    >
                      <Stack gap={2}>
                        <Text size="sm">
                          {draft.draft.formValues.description ||
                            t("offlineDraftUntitled")}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {t("taskOfflineDraftDetail")
                            .replace(
                              "{amount}",
                              String(draft.draft.formValues.amount ?? "-"),
                            )
                            .replace(
                              "{time}",
                              new Intl.DateTimeFormat(locale, {
                                dateStyle: "short",
                                timeStyle: "short",
                              }).format(new Date(draft.createdAt)),
                            )}
                        </Text>
                      </Stack>
                    </UnstyledButton>
                  ))}
                </Stack>
              )}
              {budgetTask.show && (
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
                      {t("taskBudgetNegative")}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t("assignableMoneyTodayLabel")}:{" "}
                      <Text
                        span
                        fw={600}
                        c={budgetTask.allocatableToday >= 0 ? "teal" : "red"}
                      >
                        {formatJPY(budgetTask.allocatableToday, locale)}
                      </Text>
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t("assignableMoneyTotalLabel")}:{" "}
                      <Text
                        span
                        fw={600}
                        c={budgetTask.allocatableTotal >= 0 ? "teal" : "red"}
                      >
                        {formatJPY(budgetTask.allocatableTotal, locale)}
                      </Text>
                    </Text>
                  </Stack>
                </UnstyledButton>
              )}
              {paydayTasks.length > 0 && (
                <Stack gap={4}>
                  <Text size="xs" c="dimmed" fw={600} px={4}>
                    {t("taskPaydayUnrecorded")}
                  </Text>
                  {paydayTasks.map((n) => (
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
              {creditCardImportTasks.length > 0 && (
                <Stack gap={4}>
                  <Text size="xs" c="dimmed" fw={600} px={4}>
                    {t("taskCreditCardImportSection")}
                  </Text>
                  {creditCardImportTasks.map((task) => (
                    <UnstyledButton
                      key={task.id}
                      px={4}
                      py={4}
                      style={{ borderRadius: 4 }}
                      onClick={() => {
                        navigate("/input", { state: { tab: "csv" } });
                        setOpened(false);
                      }}
                    >
                      <Stack gap={2}>
                        <Text size="sm">
                          {accountDisplayNameFromName(task.creditCardName, t)}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {t("taskCreditCardImportDetail").replace(
                            "{month}",
                            formatTaskMonth(task.statementMonth, locale),
                          )}
                        </Text>
                      </Stack>
                    </UnstyledButton>
                  ))}
                </Stack>
              )}
              {creditCardWithdrawalRiskTasks.length > 0 && (
                <Stack gap={4}>
                  <Text size="xs" c="dimmed" fw={600} px={4}>
                    {t("taskCreditCardWithdrawalRiskSection")}
                  </Text>
                  {creditCardWithdrawalRiskTasks.map((n) => (
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
                            {accountDisplayNameFromName(n.creditCardName, t)}
                          </Text>
                          <Text size="xs" c="red">
                            {formatJPY(n.combinedProjectedBalance, locale)}
                          </Text>
                        </Group>
                        <Text size="xs" c="dimmed">
                          {t("taskCreditCardWithdrawalRiskDetail")
                            .replace("{date}", n.withdrawalDate)
                            .replace(
                              "{account}",
                              accountDisplayNameFromName(
                                n.withdrawalAccountName,
                                t,
                              ),
                            )
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
              {overdueLoanTasks.length > 0 && (
                <Stack gap={4}>
                  <Text size="xs" c="dimmed" fw={600} px={4}>
                    {t("taskLoanOverdueSection")}
                  </Text>
                  {overdueLoanTasks.map((n) => (
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
                          {t("taskLoanOverdueDays").replace(
                            "{days}",
                            String(n.daysDiff),
                          )}
                        </Text>
                      </Group>
                    </UnstyledButton>
                  ))}
                </Stack>
              )}
              {negativeAccountTasks.length > 0 && (
                <Stack gap={4}>
                  <Text size="xs" c="dimmed" fw={600} px={4}>
                    {t("taskAccountNegativeSection")}
                  </Text>
                  {negativeAccountTasks.map((n) => (
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

function CompactCurrencyMenu({
  options,
  displayCurrency,
  cryptoIconStyle,
  onSelect,
}: {
  options: {
    value: string;
    backgroundColor?: string | null;
    customIcon?: string | null;
    symbol?: string;
  }[];
  displayCurrency: string;
  cryptoIconStyle: CryptoIconStyle;
  onSelect: (value: string) => void;
}) {
  const { t } = useLang();
  const [opened, setOpened] = useState(false);
  const selectedOption = options.find((c) => c.value === displayCurrency);

  return (
    <>
      {opened && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 199 }}
          onClick={() => setOpened(false)}
        />
      )}
      <style>{`
        .compact-currency-option {
          cursor: pointer;
          border-radius: 4px;
        }
        .compact-currency-option:hover {
          background: light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-5));
        }
      `}</style>
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
          <ActionIcon
            variant="default"
            size="md"
            aria-label={t("displayCurrencyLabel")}
            title={t("displayCurrencyLabel")}
            onClick={() => setOpened((o) => !o)}
          >
            <CurrencyOptionIcon
              backgroundColor={selectedOption?.backgroundColor}
              code={displayCurrency}
              cryptoIconStyle={cryptoIconStyle}
              size={20}
              symbol={selectedOption?.symbol}
              customIcon={selectedOption?.customIcon}
            />
          </ActionIcon>
        </Popover.Target>
        <Popover.Dropdown p="xs" miw={120}>
          <Stack gap={2}>
            {options.map((opt) => (
              <UnstyledButton
                key={opt.value}
                px={6}
                py={6}
                className="compact-currency-option"
                onClick={() => {
                  onSelect(opt.value);
                  setOpened(false);
                }}
              >
                <Group gap={8} wrap="nowrap">
                  <CurrencyOptionIcon
                    backgroundColor={opt.backgroundColor}
                    code={opt.value}
                    cryptoIconStyle={cryptoIconStyle}
                    size={20}
                    symbol={opt.symbol}
                    customIcon={opt.customIcon}
                  />
                  <Text size="sm">{opt.value}</Text>
                </Group>
              </UnstyledButton>
            ))}
          </Stack>
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
  const isCompact = useMediaQuery("(max-width: 500px)");

  if (enabledCurrencies.length <= 1) return null;

  const options = enabledCurrencies.map((c) => ({
    value: c.code,
    label: c.code,
    backgroundColor: c.background_color,
    customIcon: c.custom_icon,
    symbol: getEffectiveSymbol(c.code, enabledCurrencies),
  }));
  const selectedOption = options.find((c) => c.value === displayCurrency);

  if (isCompact) {
    return (
      <CompactCurrencyMenu
        options={options}
        displayCurrency={displayCurrency}
        cryptoIconStyle={cryptoIconStyle}
        onSelect={(v) => setDisplayCurrency(v)}
      />
    );
  }

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
          backgroundColor={selectedOption?.backgroundColor}
          code={displayCurrency}
          cryptoIconStyle={cryptoIconStyle}
          symbol={selectedOption?.symbol}
          customIcon={selectedOption?.customIcon}
        />
      }
      leftSectionPointerEvents="none"
      renderOption={({ option }) => (
        <Group gap={8} wrap="nowrap">
          <CurrencyOptionIcon
            backgroundColor={
              options.find((currency) => currency.value === option.value)
                ?.backgroundColor
            }
            code={option.value}
            cryptoIconStyle={cryptoIconStyle}
            symbol={
              options.find((currency) => currency.value === option.value)
                ?.symbol
            }
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
  disableTasks?: boolean;
}

export function TopNav({
  disableNavigation = false,
  disableTasks = false,
}: TopNavProps) {
  const { t } = useLang();
  const computed = useComputedColorScheme("light");
  const isOnline = useOnlineStatus();

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
    <Group h="100%" px="sm" justify="space-between">
      <Group gap="sm">
        <style>{`
          .title-version-row {
            display: flex;
            flex-direction: row;
            align-items: flex-end;
            gap: 10px;
          }
          @media (max-width: 1100px) {
            .title-version-row {
              flex-direction: column;
              align-items: flex-start;
              gap: 0;
            }
          }
        `}</style>
        <div className="title-version-row">
          <Group gap={5} wrap="nowrap">
            {!isOnline && (
              <ThemeIcon
                color="yellow"
                variant="light"
                radius="xl"
                size="sm"
                aria-label={t("offlineModeLabel")}
                title={t("offlineModeLabel")}
              >
                <IconWifiOff size={14} aria-hidden="true" />
              </ThemeIcon>
            )}
            <Title
              order={4}
              style={{
                fontSize: "clamp(0.7rem, 4vw, var(--mantine-h4-font-size))",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {t("appTitle")}
            </Title>
          </Group>
          <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
            v{VERSION}
          </Text>
        </div>
        {/* Desktop nav links */}
        <Group gap="md" visibleFrom="md">
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
        <TaskMenu disabled={disableTasks} />
      </Group>
    </Group>
  );
}
