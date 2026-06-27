import {
  Anchor,
  Badge,
  Box,
  Center,
  Checkbox,
  Divider,
  Group,
  Paper,
  Progress,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  ThemeIcon,
  rem,
} from "@mantine/core";
import { LineChart } from "@mantine/charts";
import { IconArrowLeft, IconPigMoney } from "@tabler/icons-react";
import { useState, useEffect, useMemo } from "react";
import dayjs from "dayjs";
import { Link } from "react-router-dom";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import { api } from "../api/client";
import type {
  BudgetCategorySummary,
  BudgetSummary,
} from "@balance-sheet/shared";
import { AppDataErrorAlert } from "../components/AppDataErrorAlert";
import { formatCurrency } from "../lib/numberFormat";
import { shouldShowCarryoverBadge } from "../lib/budgetCategoryDisplay";
import { privacyChartAmount } from "../lib/privacy";

function formatYearMonth(ym: string, locale: string): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  if (locale === "ja") return `${y}年${m}月`;
  return dayjs(`${ym}-01`).format("MMM YYYY");
}

const CHART_COLORS = [
  "teal.6",
  "blue.5",
  "violet.5",
  "orange.5",
  "green.6",
  "pink.5",
  "cyan.6",
  "indigo.5",
];

function SavingsCategoryCard({
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
  const goal = summary.category.goal_balance ?? null;
  const showCarryover = shouldShowCarryoverBadge(
    summary.category.budget_group,
  );
  const goalPct = goal && goal > 0 ? (summary.available / goal) * 100 : null;
  const goalColor =
    goalPct === null ? "teal" : goalPct >= 100 ? "green" : "blue";

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
          <IconPigMoney size={15} color="var(--mantine-color-dimmed)" />
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
          ) : showCarryover && summary.carryover > 0 ? (
            <Badge size="xs" color="blue" variant="light" mt={4}>
              {t("carryover")} +{formatCurrency(summary.carryover, locale, currency)}
            </Badge>
          ) : null}
        </Box>
      </Group>

      {goal !== null && (
        <>
          <Progress
            value={Math.min(100, goalPct ?? 0)}
            color={goalColor}
            size="md"
            radius="xl"
            mb={6}
          />
          <Text size="xs" c="dimmed">
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

export default function SvPage() {
  const { t, locale } = useLang();
  const {
    budgetCategories,
    budgetSummary,
    currentYearMonth,
    displayCurrency,
    displayCurrencySymbol,
    loading,
    error,
  } = useAppData();

  // Historical summaries for chart (last 12 months)
  const [historicalSummaries, setHistoricalSummaries] = useState<
    BudgetSummary[]
  >([]);
  const [chartLoading, setChartLoading] = useState(true);
  const [showFuture, setShowFuture] = useState(false);
  const selectedCurrency = displayCurrency || "JPY";

  useEffect(() => {
    let cancelled = false;
    setChartLoading(true);

    const now = dayjs();
    const months: string[] = [];
    for (let i = 11; i >= 0; i--) {
      months.push(now.subtract(i, "month").format("YYYY-MM"));
    }

    api.budget.history(months[0]!, months.at(-1)!, selectedCurrency).then(
      (history) => {
        if (!cancelled) {
          setHistoricalSummaries(history.summaries);
          setChartLoading(false);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [selectedCurrency]);

  const savingsCategories = useMemo(
    () => budgetCategories.filter((c) => c.budget_group === "貯蓄"),
    [budgetCategories],
  );

  const savingsSummaries = useMemo(
    () =>
      (budgetSummary?.categories ?? []).filter(
        (s) => s.category.budget_group === "貯蓄",
      ),
    [budgetSummary],
  );

  // Build chart data: [{month: "2025-05", CategoryName: 5000, ...}, ...]
  const chartData = useMemo(() => {
    if (savingsCategories.length === 0 || historicalSummaries.length === 0)
      return [];

    return historicalSummaries.map((summary) => {
      const row: Record<string, string | number> = {
        month: formatYearMonth(summary.year_month, locale),
      };
      for (const cat of savingsCategories) {
        const catSummary = summary.categories.find(
          (s) => s.category.id === cat.id,
        );
        row[cat.name] = privacyChartAmount(catSummary?.available ?? 0);
      }
      return row;
    });
  }, [historicalSummaries, savingsCategories, locale]);

  const chartSeries = useMemo(
    () =>
      savingsCategories.map((cat, i) => ({
        name: cat.name,
        color: CHART_COLORS[i % CHART_COLORS.length]!,
      })),
    [savingsCategories],
  );

  // Build combined chart data with future prediction when enabled
  const { combinedChartData, combinedChartSeries } = useMemo(() => {
    if (
      !showFuture ||
      chartData.length === 0 ||
      savingsSummaries.length === 0
    ) {
      return { combinedChartData: chartData, combinedChartSeries: chartSeries };
    }

    const currentMonthStr = budgetSummary?.year_month ?? currentYearMonth;
    const [cy, cm] = currentMonthStr.split("-").map(Number) as [number, number];

    // Per-category prediction info derived from current budget summary
    const catInfo = savingsCategories.map((cat) => {
      const summary = savingsSummaries.find((s) => s.category.id === cat.id);
      const enoughHistory = (summary?.months_with_contributions ?? 0) >= 2;
      const mwc = summary?.months_with_contributions ?? 0;
      const avgMonthly =
        enoughHistory && mwc > 0 ? (summary?.available ?? 0) / mwc : 0;
      return {
        name: cat.name,
        avgMonthly,
        currentBalance: summary?.available ?? 0,
        goal: summary?.category.goal_balance ?? null,
      };
    });

    // Add bridge: update the last historical row (= current month) to also
    // carry the prediction series so the dashed line starts at that point
    const historicalWithBridge = chartData.map((row, idx) => {
      if (idx !== chartData.length - 1) return row;
      const bridged: Record<string, string | number | null> = { ...row };
      for (const info of catInfo) {
        bridged[`${info.name}_pred`] = privacyChartAmount(info.currentBalance);
      }
      return bridged;
    });

    // Generate future months (cap at 24; stop early if all goals are reached)
    const MAX_FUTURE = 24;
    const futureRows: Record<string, string | number | null>[] = [];

    for (let i = 1; i <= MAX_FUTURE; i++) {
      const totalMonth = cm + i;
      const futureYear = cy + Math.floor((totalMonth - 1) / 12);
      const futureMonthNorm = ((totalMonth - 1) % 12) + 1;
      const futureYM = `${futureYear}-${String(futureMonthNorm).padStart(2, "0")}`;

      const row: Record<string, string | number | null> = {
        month: formatYearMonth(futureYM, locale),
      };

      // Actual series: null for future months (no data)
      for (const cat of savingsCategories) {
        row[cat.name] = null;
      }

      let allGoalsReached = catInfo.some((c) => c.goal !== null);
      for (const info of catInfo) {
        if (info.avgMonthly <= 0) {
          row[`${info.name}_pred`] = privacyChartAmount(info.currentBalance);
          continue;
        }
        const projected = info.currentBalance + info.avgMonthly * i;
        if (info.goal !== null && projected >= info.goal) {
          row[`${info.name}_pred`] = privacyChartAmount(info.goal);
        } else {
          row[`${info.name}_pred`] = privacyChartAmount(Math.round(projected));
          allGoalsReached = false;
        }
      }

      futureRows.push(row);

      // Stop when all goal-having categories reached their goal (after ≥ 1 month)
      if (allGoalsReached) break;
    }

    const predictionSeries = savingsCategories.map((cat, i) => ({
      name: `${cat.name}_pred`,
      color: CHART_COLORS[i % CHART_COLORS.length]!,
      label: `${cat.name}${t("savingsPredictedSuffix")}`,
      strokeDasharray: "6 3",
    }));

    return {
      combinedChartData: [...historicalWithBridge, ...futureRows],
      combinedChartSeries: [...chartSeries, ...predictionSeries],
    };
  }, [
    showFuture,
    chartData,
    chartSeries,
    savingsSummaries,
    savingsCategories,
    budgetSummary,
    currentYearMonth,
    locale,
    t,
  ]);

  if (loading) {
    return (
      <Stack gap="lg">
        <Skeleton height={36} width={200} />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Skeleton height={120} radius="md" />
          <Skeleton height={120} radius="md" />
        </SimpleGrid>
        <Skeleton height={280} radius="md" />
      </Stack>
    );
  }

  if (error) {
    return <AppDataErrorAlert error={error} />;
  }

  return (
    <Stack gap="lg">
      {/* Page header */}
      <Group gap="sm">
        <Anchor component={Link} to="/fs" c="dimmed" size="sm">
          <Group gap={4}>
            <IconArrowLeft size={14} />
            {t("navFS")}
          </Group>
        </Anchor>
      </Group>

      <Group gap="sm">
        <ThemeIcon size={40} radius="md" color="teal" variant="light">
          <IconPigMoney size={22} />
        </ThemeIcon>
        <Box>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
            {t("tabSavings")}
          </Text>
          <Text size="sm" c="dimmed">
            {t("tabSavingsDesc")}
          </Text>
        </Box>
      </Group>

      {savingsCategories.length === 0 ? (
        <Paper withBorder p="xl" radius="md">
          <Center>
            <Stack align="center" gap="xs">
              <IconPigMoney size={40} color="var(--mantine-color-dimmed)" />
              <Text c="dimmed" size="sm" ta="center">
                {t("savingsNoCategories")}
              </Text>
              <Anchor component={Link} to="/settings" size="sm">
                {t("navSettings")} →
              </Anchor>
            </Stack>
          </Center>
        </Paper>
      ) : (
        <>
          {/* Current savings cards */}
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {savingsSummaries.map((s) => (
              <SavingsCategoryCard
                key={s.category.id}
                summary={s}
                locale={locale}
                yearMonth={budgetSummary?.year_month ?? currentYearMonth}
                currency={selectedCurrency}
              />
            ))}
          </SimpleGrid>

          {/* Historical chart */}
          <Paper withBorder p="lg" radius="md">
            <Group justify="space-between" align="center" mb="md">
              <Divider
                label={
                  <Text size="sm" fw={700} c="dimmed">
                    {t("savingsMonthlyContributions")}
                  </Text>
                }
                labelPosition="left"
                style={{ flex: 1 }}
              />
              <Checkbox
                label={t("savingsShowFuturePrediction")}
                size="sm"
                checked={showFuture}
                onChange={(e) => setShowFuture(e.currentTarget.checked)}
                ml="md"
              />
            </Group>
            {chartLoading ? (
              <Skeleton height={240} radius="md" />
            ) : chartData.length === 0 ? (
              <Text size="sm" c="dimmed" ta="center" py="md">
                {t("savingsNoCategories")}
              </Text>
            ) : (
              <LineChart
                h={rem(360)}
                data={combinedChartData}
                dataKey="month"
                series={combinedChartSeries}
                curveType="monotone"
                withLegend
                withDots={false}
                connectNulls={false}
                valueFormatter={(v) =>
                  formatCurrency(
                    Number(v),
                    locale,
                    selectedCurrency,
                    displayCurrencySymbol,
                  )
                }
              />
            )}
          </Paper>
        </>
      )}
    </Stack>
  );
}
