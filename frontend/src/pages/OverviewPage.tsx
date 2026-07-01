import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Center,
  Divider,
  Group,
  Paper,
  Progress,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  ActionIcon,
  rem,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import {
  IconChevronLeft,
  IconChevronRight,
  IconCalendarX,
  IconWallet,
  IconPigMoney,
  IconGift,
  IconCalendarDollar,
  IconShoppingCart,
} from "@tabler/icons-react";
import { useState, useEffect, useMemo } from "react";
import dayjs from "dayjs";
import { Link } from "react-router-dom";
import {
  usagePeriodForStatementMonth,
  shiftCreditCardMonth,
  creditCardBillingOffsetMonths,
} from "@balance-sheet/shared";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import { api } from "../api/client";
import type {
  BudgetCategorySummary,
  BudgetSummary,
  CreditCardStateEntry,
  JournalEntry,
} from "@balance-sheet/shared";
import { AppDataErrorAlert } from "../components/AppDataErrorAlert";
import { BalanceDisplay } from "../components/BalanceDisplay";
import { accountDisplayNameFromName } from "../lib/accountUtils";
import { formatCurrency } from "../lib/numberFormat";

function normalizeCurrency(currency: string | null | undefined) {
  return (currency || "JPY").toUpperCase();
}

function isAmountLine(line: JournalEntry["lines"][number]) {
  return line.debit !== 0 || line.credit !== 0;
}

function lineMatchesCurrency(
  line: JournalEntry["lines"][number],
  currency: string,
) {
  return normalizeCurrency(line.currency) === normalizeCurrency(currency);
}

function entryHasCurrency(entry: JournalEntry, currency: string) {
  return entry.lines.some(
    (line) => isAmountLine(line) && lineMatchesCurrency(line, currency),
  );
}

function formatYearMonth(ym: string, locale: string): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  if (locale === "ja") return `${y}年${m}月`;
  return dayjs(`${ym}-01`).format("MMMM YYYY");
}

function BudgetCategoryCard({
  summary,
  locale,
  yearMonth,
  currency,
}: {
  summary: BudgetCategorySummary;
  locale: string;
  yearMonth: string;
  currency: string;
}) {
  const { t } = useLang();
  const pct =
    summary.total_budget > 0 ? (summary.spent / summary.total_budget) * 100 : 0;
  const color = pct >= 100 ? "red" : pct >= 80 ? "orange" : "teal";

  const isSavings = summary.category.budget_group === "貯蓄";
  const Icon = isSavings ? IconPigMoney : IconWallet;
  const goal = summary.category.goal_balance ?? null;
  const goalPct = goal && goal > 0 ? (summary.available / goal) * 100 : null;
  const goalColor =
    goalPct === null ? "teal" : goalPct >= 100 ? "green" : "blue";

  // Goal prediction: only when goal set, enough history (>2 months), and goal not yet reached
  const remaining = goal !== null ? goal - summary.available : null;
  const enoughHistory = summary.months_with_contributions >= 2;
  const avgMonthly =
    enoughHistory && summary.months_with_contributions > 0
      ? summary.available / summary.months_with_contributions
      : 0;
  let monthsToGoal: number | null = null;
  let predictedDate: string | null = null;
  let yearsMonthsLabel: string | null = null;
  if (
    goal !== null &&
    remaining !== null &&
    enoughHistory &&
    avgMonthly > 0 &&
    remaining > 0
  ) {
    monthsToGoal = Math.ceil(remaining / avgMonthly);
    const [y, m] = yearMonth.split("-").map(Number) as [number, number];
    const targetMonth = m + monthsToGoal;
    const targetYear = y + Math.floor((targetMonth - 1) / 12);
    const targetMonthNorm = ((targetMonth - 1) % 12) + 1;
    if (locale === "ja") {
      predictedDate = `${targetYear}年${targetMonthNorm}月`;
    } else {
      predictedDate = dayjs(
        `${targetYear}-${String(targetMonthNorm).padStart(2, "0")}-01`,
      ).format("MMM YYYY");
    }
    const yrs = Math.floor(monthsToGoal / 12);
    const mos = monthsToGoal % 12;
    if (yrs > 0 && mos > 0) {
      yearsMonthsLabel =
        locale === "ja" ? `${yrs}年${mos}ヶ月` : `${yrs}y ${mos}m`;
    } else if (yrs > 0) {
      yearsMonthsLabel = locale === "ja" ? `${yrs}年` : `${yrs}y`;
    }
  }

  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" align="flex-start" mb={8}>
        <Group gap={6} style={{ flex: 1 }}>
          <Icon size={15} color="var(--mantine-color-dimmed)" />
          <Text fw={600} size="sm">
            {summary.category.name}
          </Text>
        </Group>
        <Box ta="right">
          <Text
            fw={800}
            size="lg"
            c={summary.available >= 0 ? "teal" : "red"}
            lh={1}
          >
            {formatCurrency(summary.available, locale, currency)}
          </Text>
          {summary.reset_date ? (
            <Badge size="xs" color="orange" variant="light" mt={4}>
              {t("budgetResetBadge")} {summary.reset_date}
            </Badge>
          ) : summary.carryover > 0 ? (
            <Badge size="xs" color="blue" variant="light" mt={4}>
              {t("carryover")} +{formatCurrency(summary.carryover, locale, currency)}
            </Badge>
          ) : summary.carryover < 0 ? (
            <Badge size="xs" color="red" variant="light" mt={4}>
              {t("carryover")} {formatCurrency(summary.carryover, locale, currency)}
            </Badge>
          ) : null}
        </Box>
      </Group>
      <Box pos="relative" mb={6}>
        <Progress
          value={Math.min(100, pct)}
          color={color}
          size="md"
          radius="xl"
        />
        {pct > 100 && (
          <Box pos="absolute" top={0} left={0} right={0}>
            <Progress
              value={Math.min(100, pct - 100)}
              color="red.9"
              size="md"
              radius="xl"
              striped
              animated
              styles={{ root: { background: "transparent" } }}
            />
          </Box>
        )}
      </Box>
      <Text size="xs" c="dimmed">
        {formatCurrency(summary.spent, locale, currency)} /{" "}
        {formatCurrency(summary.total_budget, locale, currency)}
        {summary.total_budget > 0 && ` · ${pct.toFixed(1)}%`}
      </Text>
      {goal !== null && (
        <>
          <Progress
            value={Math.min(100, goalPct ?? 0)}
            color={goalColor}
            size="xs"
            radius="xl"
            mt={8}
          />
          <Text size="xs" c="dimmed" mt={4}>
            {t("goal")}: {formatCurrency(summary.available, locale, currency)} /{" "}
            {formatCurrency(goal, locale, currency)}
            {goalPct !== null && ` · ${goalPct.toFixed(1)}%`}
          </Text>
          {goalPct !== null && goalPct >= 100 && (
            <Text size="xs" c="green" fw={600} mt={2}>
              {t("goalAlreadyReached")}
            </Text>
          )}
          {monthsToGoal !== null && predictedDate !== null && (
            <Text size="xs" c="blue" mt={2}>
              {t("goalReachIn").replace("{months}", String(monthsToGoal))}
              {yearsMonthsLabel && ` (${yearsMonthsLabel})`}
              {" · "}
              {t("goalReachBy").replace("{date}", predictedDate)}
            </Text>
          )}
        </>
      )}
    </Paper>
  );
}

function RecentTransactionRow({
  entry,
  accountTypeMap,
  budgetCategoryMap,
  locale,
  displayCurrency,
}: {
  entry: JournalEntry;
  accountTypeMap: Map<number, string>;
  budgetCategoryMap: Map<number, string>;
  locale: string;
  displayCurrency: string;
}) {
  const { t } = useLang();
  const debitLines = entry.lines.filter(
    (l) => l.debit > 0 && lineMatchesCurrency(l, displayCurrency),
  );
  const creditLines = entry.lines.filter(
    (l) => l.credit > 0 && lineMatchesCurrency(l, displayCurrency),
  );
  const selectedLines = [...debitLines, ...creditLines];
  const isIncome = creditLines.some((l) => {
    const type = accountTypeMap.get(l.account_id);
    return type === "income" || type === "equity";
  });
  const isTransfer =
    !isIncome &&
    debitLines.every((l) => {
      const type = accountTypeMap.get(l.account_id);
      return type === "asset" || type === "liability";
    }) &&
    creditLines.every((l) => {
      const type = accountTypeMap.get(l.account_id);
      return type === "asset" || type === "liability";
    });
  const debitAmount = debitLines.reduce((s, l) => s + l.debit, 0);
  const creditAmount = creditLines.reduce((s, l) => s + l.credit, 0);
  const amount = debitAmount > 0 ? debitAmount : creditAmount;
  const amountColor = isIncome ? "green" : isTransfer ? "blue" : "red";
  const amountSign = isIncome ? "+" : isTransfer ? "" : "-";
  const formattedAmount = formatCurrency(amount, locale, displayCurrency);

  const allAccountNames = [
    ...new Set(
      selectedLines.map((l) => accountDisplayNameFromName(l.account_name, t)),
    ),
  ].join(" · ");

  const allocations = [
    ...(entry.budget_allocations ?? []),
    ...(entry.income_budget_allocations ?? []),
  ].filter((allocation) => normalizeCurrency(allocation.currency) === displayCurrency);

  const badgeNodes = allocations.map((a) => {
    const catName =
      budgetCategoryMap.get(a.budget_category_id) ?? `#${a.budget_category_id}`;
    const catAmt = formatCurrency(a.amount, locale, displayCurrency);
    return (
      <Badge
        key={a.budget_category_id}
        size="xs"
        color="teal"
        variant="light"
        style={{ maxWidth: "100%" }}
        styles={{ label: { display: "flex", gap: 0, overflow: "hidden" } }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {catName}
        </span>
        <span style={{ whiteSpace: "nowrap", flexShrink: 0 }}>: {catAmt}</span>
      </Badge>
    );
  });

  return (
    <Box
      py="sm"
      px="md"
      style={{
        borderBottom: "1px solid var(--mantine-color-default-border)",
      }}
    >
      <Group justify="space-between" align="stretch" wrap="nowrap" gap="xs">
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm" fw={500} lineClamp={1}>
            {entry.description}
          </Text>
          <Text size="xs" c="dimmed" lineClamp={1}>
            {entry.date} · {allAccountNames}
          </Text>
        </Box>
        <Stack
          gap={4}
          align="flex-end"
          justify="space-between"
          style={{ flexShrink: 0, maxWidth: "50%" }}
        >
          <Text
            size="sm"
            fw={700}
            c={amountColor}
            style={{ whiteSpace: "nowrap" }}
          >
            {amountSign}
            {formattedAmount}
          </Text>
          {badgeNodes.length > 0 && (
            <Group gap={4} wrap="wrap" justify="flex-end">
              {badgeNodes}
            </Group>
          )}
        </Stack>
      </Group>
    </Box>
  );
}

export default function OverviewPage() {
  const { t, locale } = useLang();
  const {
    budgetCategories,
    budgetSummary,
    currentYearMonth,
    setCurrentYearMonth,
    creditCardSettings,
    accounts,
    journal,
    displayCurrency,
    loading,
    error,
  } = useAppData();
  const selectedCurrency = normalizeCurrency(displayCurrency);

  const [importReminders, setImportReminders] = useState<string[]>([]);
  const [ccState, setCcState] = useState<CreditCardStateEntry[]>([]);
  const [ccStateLoading, setCcStateLoading] = useState(true);

  // Fetch trial-balance credit card state for warning check
  useEffect(() => {
    api.trialBalance
      .getCreditCardState()
      .then(setCcState)
      .catch(() => {})
      .finally(() => setCcStateLoading(false));
  }, []);

  // Compute credit card import reminders.
  // Show when: today >= confirmation_day AND the current payment month has not been
  // recorded in the trial balance (credit_card_state) with a positive amount.
  // Only warn if the user actually has CC usage entries in that billing period.
  useEffect(() => {
    if (localStorage.getItem("notif:creditCard") === "false") {
      setImportReminders([]);
      return;
    }
    if (creditCardSettings.length === 0) return;

    const today = new Date();
    const todayDay = today.getDate();
    // The payment month the user should have recorded in the trial balance is the
    // current calendar month (confirmation_day falls in the same month as payment day
    // for most Japanese credit cards).
    const currentPaymentMonth = dayjs(today).format("YYYY-MM");

    const reminders: string[] = [];
    for (const cc of creditCardSettings) {
      if (todayDay < cc.confirmation_day) continue;

      // Derive the statement (usage) period that corresponds to the current payment month.
      const billingOffset = creditCardBillingOffsetMonths(cc);
      const statementMonth = shiftCreditCardMonth(
        currentPaymentMonth,
        -billingOffset,
      );
      const period = usagePeriodForStatementMonth(
        statementMonth,
        cc.closing_day,
      );

      // Only warn if the user recorded expenses for this CC in that period.
      const hasStatementEntries = journal.some(
        (entry) =>
          entry.date >= period.start &&
          entry.date <= period.end &&
          entry.lines.some(
            (l) => l.account_id === cc.account_id && l.credit > 0,
          ),
      );
      if (!hasStatementEntries) continue;

      // Suppress warning when the trial balance has ANY saved entry for this payment month
      // (amount=0 is also valid — the user may have intentionally recorded 0 or the balance
      // may genuinely be zero; what matters is that an entry exists, not the amount).
      const hasTrialBalanceEntry = ccState.some(
        (e) =>
          e.account_id === cc.account_id &&
          e.payment_month === currentPaymentMonth,
      );
      if (hasTrialBalanceEntry) continue;

      const acct = accounts.find((a) => a.id === cc.account_id);
      if (acct) reminders.push(accountDisplayNameFromName(acct.name, t));
    }
    setImportReminders(reminders);
  }, [creditCardSettings, ccState, journal, accounts, t]);

  // Single date state drives both month context and as-of filter
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [filteredSummary, setFilteredSummary] = useState<BudgetSummary | null>(
    null,
  );

  useEffect(() => {
    if (!selectedDate) {
      setFilteredSummary(null);
      return;
    }
    const ym = dayjs(selectedDate).format("YYYY-MM");
    const asOfStr = dayjs(selectedDate).format("YYYY-MM-DD");
    setCurrentYearMonth(ym);
    let cancelled = false;
    void api.budget.summary(ym, asOfStr, selectedCurrency).then((s) => {
      if (!cancelled) setFilteredSummary(s);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedDate, selectedCurrency, setCurrentYearMonth]);

  const displaySummary = selectedDate ? filteredSummary : budgetSummary;

  const handlePrevMonth = () => {
    if (selectedDate) {
      setSelectedDate(dayjs(selectedDate).subtract(1, "month").toDate());
    } else {
      const [y, m] = currentYearMonth.split("-").map(Number) as [
        number,
        number,
      ];
      const prev =
        m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
      setCurrentYearMonth(prev);
    }
  };

  const handleNextMonth = () => {
    if (selectedDate) {
      setSelectedDate(dayjs(selectedDate).add(1, "month").toDate());
    } else {
      const [y, m] = currentYearMonth.split("-").map(Number) as [
        number,
        number,
      ];
      const next =
        m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
      setCurrentYearMonth(next);
    }
  };

  // Exclude savings group from top-level totals
  const expenseCategories =
    displaySummary?.categories.filter(
      (c) => c.category.budget_group !== "貯蓄",
    ) ?? [];
  const expenseTotalBudget = expenseCategories.reduce(
    (s, c) => s + c.total_budget,
    0,
  );
  const expenseTotalSpent = expenseCategories.reduce((s, c) => s + c.spent, 0);
  const expenseTotalAvailable = expenseCategories.reduce(
    (s, c) => s + c.available,
    0,
  );

  const totalPct =
    expenseTotalBudget > 0 ? (expenseTotalSpent / expenseTotalBudget) * 100 : 0;

  // Recent transactions
  const [txShowCount, setTxShowCount] = useState(5);
  const accountTypeMap = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.type])),
    [accounts],
  );
  const budgetCategoryMap = useMemo(
    () => new Map(budgetCategories.map((c) => [c.id, c.name])),
    [budgetCategories],
  );
  const asOfDateStr = selectedDate
    ? dayjs(selectedDate).format("YYYY-MM-DD")
    : null;
  const recentEntries = useMemo(
    () =>
      [...journal]
        .filter(
          (e) =>
            (!asOfDateStr || e.date <= asOfDateStr) &&
            entryHasCurrency(e, selectedCurrency),
        )
        .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
        .slice(0, 20),
    [journal, asOfDateStr, selectedCurrency],
  );
  const visibleEntries = recentEntries.slice(0, txShowCount);

  useEffect(() => {
    setTxShowCount(5);
  }, [asOfDateStr, selectedCurrency]);

  if (loading || ccStateLoading) {
    return (
      <Stack gap="lg">
        <Group justify="center">
          <Skeleton height={36} width={260} radius="sm" />
        </Group>
        <Skeleton height={160} radius="md" />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={110} radius="md" />
          ))}
        </SimpleGrid>
        <Skeleton height={48} radius="md" />
        <Skeleton height={240} radius="md" />
      </Stack>
    );
  }

  if (error) {
    return <AppDataErrorAlert error={error} />;
  }

  return (
    <Stack gap="lg">
      {/* Credit card import reminders */}
      {importReminders.map((cardName) => (
        <Alert
          key={cardName}
          color="yellow"
          withCloseButton
          onClose={() =>
            setImportReminders((prev) => prev.filter((n) => n !== cardName))
          }
        >
          {t("creditCardImportReminder")}: {cardName}{" "}
          <Anchor component={Link} to="/input" size="sm">
            → {t("importPageTitle")}
          </Anchor>
        </Alert>
      ))}

      {/* Date navigator — picker IS the label */}
      <Group justify="center" gap="xs" wrap="nowrap">
        <ActionIcon
          variant="subtle"
          size="lg"
          radius="xl"
          onClick={handlePrevMonth}
        >
          <IconChevronLeft size={18} />
        </ActionIcon>
        <DatePickerInput
          value={selectedDate}
          onChange={setSelectedDate}
          valueFormat={locale === "ja" ? "YYYY年M月D日" : "MMMM D, YYYY"}
          placeholder={formatYearMonth(currentYearMonth, locale)}
          variant="unstyled"
          rightSection={
            selectedDate && !dayjs(selectedDate).isSame(dayjs(), "day") ? (
              <ActionIcon
                variant="subtle"
                color="dimmed"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedDate(new Date());
                }}
              >
                <IconCalendarX size={15} />
              </ActionIcon>
            ) : null
          }
          rightSectionPointerEvents="all"
          styles={{
            input: {
              fontWeight: 700,
              fontSize: rem(18),
              textAlign: "center",
              cursor: "pointer",
              minWidth: rem(160),
              padding: `0 ${rem(28)}`,
              height: "auto",
            },
          }}
        />
        <ActionIcon
          variant="subtle"
          size="lg"
          radius="xl"
          onClick={handleNextMonth}
        >
          <IconChevronRight size={18} />
        </ActionIcon>
      </Group>

      {/* Total available balance */}
      {displaySummary && (
        <Paper withBorder p="xl" radius="md">
          <Box mb={expenseTotalBudget > 0 ? "md" : 0}>
            <Text size="xs" tt="uppercase" fw={700} c="dimmed" mb={4}>
              {t("availableBalance")}
              {selectedDate && !dayjs(selectedDate).isSame(dayjs(), "day") && (
                <Text span fw={500} tt="none" c="blue" ml={6}>
                  ·{" "}
                  {dayjs(selectedDate).format(
                    locale === "ja" ? "M月D日[時点]" : "[as of] MMM D",
                  )}
                </Text>
              )}
            </Text>
            <BalanceDisplay
              amount={expenseTotalAvailable}
              currency={selectedCurrency}
              fw={900}
              c={expenseTotalAvailable >= 0 ? "teal" : "red"}
            />
            {expenseTotalBudget > 0 && (
              <Text size="xs" c="dimmed" mt={6}>
                {formatCurrency(expenseTotalSpent, locale, selectedCurrency)} /{" "}
                {formatCurrency(expenseTotalBudget, locale, selectedCurrency)}
              </Text>
            )}
          </Box>

          {expenseTotalBudget > 0 && (
            <>
              <Group justify="space-between" mb={6}>
                <Text size="xs" c="dimmed">
                  {totalPct.toFixed(1)}% {t("used")}
                </Text>
                <Text size="xs" c="dimmed">
                  {formatCurrency(expenseTotalBudget, locale, selectedCurrency)}{" "}
                  {t("budget")}
                </Text>
              </Group>
              <Box pos="relative">
                <Progress
                  value={Math.min(100, totalPct)}
                  color={expenseTotalAvailable >= 0 ? "teal" : "red"}
                  size="md"
                  radius="xl"
                />
                {totalPct > 100 && (
                  <Box pos="absolute" top={0} left={0} right={0}>
                    <Progress
                      value={Math.min(100, totalPct - 100)}
                      color="red.9"
                      size="md"
                      radius="xl"
                      striped
                      animated
                      styles={{ root: { background: "transparent" } }}
                    />
                  </Box>
                )}
              </Box>
            </>
          )}
        </Paper>
      )}

      {/* Budget category cards (non-savings) */}
      {budgetCategories.length === 0 ? (
        <Center py="xl">
          <Stack align="center" gap="xs">
            <Text c="dimmed" size="sm">
              {t("noBudgetCategories")}
            </Text>
            <Anchor component={Link} to="/settings" size="sm">
              {t("navSettings")} →
            </Anchor>
          </Stack>
        </Center>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {(displaySummary?.categories ?? [])
            .filter((s) => s.category.budget_group !== "貯蓄")
            .map((s) => (
              <BudgetCategoryCard
                key={s.category.id}
                summary={s}
                locale={locale}
                yearMonth={displaySummary?.year_month ?? currentYearMonth}
                currency={selectedCurrency}
              />
            ))}
        </SimpleGrid>
      )}

      {/* Budget including savings summary + link to savings page */}
      {displaySummary && displaySummary.total_budget > 0 && (
        <>
        <Paper withBorder px="md" py="sm" radius="md">
          <Group justify="space-between" align="center">
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              {t("budgetIncludingSavings")}
            </Text>
            <Group gap="xs">
              <Text size="sm" c="dimmed">
                {formatCurrency(displaySummary.total_spent, locale, selectedCurrency)}{" "}
                / {formatCurrency(displaySummary.total_budget, locale, selectedCurrency)}
              </Text>
              <Text
                size="sm"
                fw={700}
                c={displaySummary.total_available >= 0 ? "teal" : "red"}
              >
                {formatCurrency(
                  displaySummary.total_available,
                  locale,
                  selectedCurrency,
                )}
              </Text>
            </Group>
          </Group>
          {(displaySummary.categories ?? []).some(
            (s) => s.category.budget_group === "貯蓄",
          ) && (
            <Group justify="flex-end" mt="xs">
              <Button
                component={Link}
                to="/fs/sv"
                variant="subtle"
                size="xs"
                color="teal"
                leftSection={<IconPigMoney size={13} />}
              >
                {t("svViewDetails")}
              </Button>
            </Group>
          )}
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              {t("plannedMoneyTitle")}
            </Text>
            <SimpleGrid cols={{ base: 1, xs: 3 }}>
              <Button
                component={Link}
                to="/shopping-list"
                variant="light"
                color="green"
                leftSection={<IconShoppingCart size={18} />}
                justify="flex-start"
                styles={{ root: { minHeight: rem(52) } }}
              >
                {t("shoppingListTitle")}
              </Button>
              <Button
                component={Link}
                to="/wishlist"
                variant="light"
                color="pink"
                leftSection={<IconGift size={18} />}
                justify="flex-start"
                styles={{ root: { minHeight: rem(52) } }}
              >
                {t("wishlistTitle")}
              </Button>
              <Button
                component={Link}
                to="/scheduled-payments"
                variant="light"
                color="blue"
                leftSection={<IconCalendarDollar size={18} />}
                justify="flex-start"
                styles={{ root: { minHeight: rem(52) } }}
              >
                {t("scheduledPaymentsTitle")}
              </Button>
            </SimpleGrid>
          </Stack>
        </Paper>
        </>
      )}

      {/* Recent transactions */}
      <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
        <Group justify="space-between" align="center" px="md" py="sm">
          <Text fw={700} size="sm">
            {t("recentTransactions")}
          </Text>
          <Anchor component={Link} to="/ledger" size="xs">
            {t("showAllTransactions")} →
          </Anchor>
        </Group>
        <Divider />
        {recentEntries.length === 0 ? (
          <Text c="dimmed" size="sm" ta="center" py="md">
            {t("noTransactionsYet")}
          </Text>
        ) : (
          <>
            {visibleEntries.map((entry) => (
              <RecentTransactionRow
                key={entry.id}
                entry={entry}
                accountTypeMap={accountTypeMap}
                budgetCategoryMap={budgetCategoryMap}
                locale={locale}
                displayCurrency={selectedCurrency}
              />
            ))}
            {recentEntries.length > txShowCount ? (
              <Center py="sm">
                <Button
                  variant="subtle"
                  size="xs"
                  onClick={() => setTxShowCount(20)}
                >
                  {t("showMore")} ({recentEntries.length - txShowCount})
                </Button>
              </Center>
            ) : (
              <Center py="sm">
                <Anchor component={Link} to="/ledger" size="xs">
                  {t("showAllTransactions")} →
                </Anchor>
              </Center>
            )}
          </>
        )}
      </Paper>
    </Stack>
  );
}
