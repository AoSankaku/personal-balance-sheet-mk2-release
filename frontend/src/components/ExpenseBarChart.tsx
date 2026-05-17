import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BarChart, ChartTooltip } from "@mantine/charts";
import { MonthPickerInput, YearPickerInput } from "@mantine/dates";
import {
  ActionIcon,
  Checkbox,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import type { Account, JournalEntry } from "@balance-sheet/shared";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import { pad, toDateStr } from "../lib/dateUtils";
import {
  buildExpenseHistorySnapshot,
  saveExpenseHistorySnapshot,
} from "../lib/expenseHistoryStorage";
import { formatCurrency } from "../lib/numberFormat";
import { balanceMapAmountForDisplayMode } from "../lib/displayCurrencyAmounts";

type Granularity = "year" | "month";

function generateBuckets(from: string, to: string, g: Granularity): string[] {
  const out: string[] = [];
  if (g === "year") {
    for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++)
      out.push(String(y));
  } else {
    let y = +from.slice(0, 4),
      m = +from.slice(5, 7);
    const ey = +to.slice(0, 4),
      em = +to.slice(5, 7);
    while (y < ey || (y === ey && m <= em)) {
      out.push(`${y}-${pad(m)}`);
      if (++m > 12) {
        m = 1;
        y++;
      }
    }
  }
  return out;
}

function bucketFor(date: string, g: Granularity): string {
  return g === "year" ? date.slice(0, 4) : date.slice(0, 7);
}

function formatLabel(b: string, g: Granularity) {
  if (g === "year") return b;
  return b.replace("-", "/");
}

const CHART_COLORS = [
  "red.5",
  "orange.5",
  "yellow.5",
  "green.6",
  "teal.6",
  "cyan.5",
  "blue.5",
  "indigo.5",
  "violet.5",
  "grape.5",
  "pink.5",
  "lime.6",
];

interface Props {
  journal: JournalEntry[];
  accounts: Account[];
  includeAllCurrencies?: boolean;
}

type PortalTooltipState = {
  label: string;
  payload: Array<{ name: string; value: unknown; color: string }>;
  left: number;
  top: number;
};

const TOOLTIP_W = 240;
const TOOLTIP_OFFSET = 16;

export function ExpenseBarChart({
  journal,
  accounts,
  includeAllCurrencies = false,
}: Props) {
  const { t, locale } = useLang();
  const { displayCurrency, displayCurrencySymbol, convertCurrency } =
    useAppData();

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const tooltipDivRef = useRef<HTMLDivElement>(null);
  const isMobilePinnedRef = useRef(false);
  const isTouchInteractingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const tooltipRenderRafRef = useRef<number | null>(null);
  const touchFallbackTimeoutRef = useRef<number | null>(null);

  const [tooltipState, setTooltipState] = useState<PortalTooltipState | null>(
    null,
  );

  const [granularity, setGranularity] = useState<Granularity>("month");
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([
    null,
    null,
  ]);
  const [includeFuture, setIncludeFuture] = useState(false);

  const today = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => toDateStr(today), [today]);

  const expenseAccounts = useMemo(
    () => accounts.filter((a) => a.type === "expense" && !a.is_system),
    [accounts],
  );

  const expenseHistorySnapshot = useMemo(
    () => buildExpenseHistorySnapshot(journal, accounts),
    [journal, accounts],
  );

  useEffect(() => {
    saveExpenseHistorySnapshot(expenseHistorySnapshot);
  }, [expenseHistorySnapshot]);

  const filteredJournal = useMemo(() => {
    if (includeFuture) return journal;
    return journal.filter((e) => e.date <= todayStr);
  }, [journal, includeFuture, todayStr]);

  const minDataDate = useMemo(() => {
    if (filteredJournal.length === 0) return null;
    const sorted = filteredJournal.map((e) => e.date).sort();
    return new Date(sorted[0]! + "T00:00:00");
  }, [filteredJournal]);

  const maxDataDate = useMemo(() => {
    if (journal.length === 0) return null;
    const sorted = journal.map((e) => e.date).sort();
    return new Date(sorted[sorted.length - 1]! + "T00:00:00");
  }, [journal]);

  const maxPickerDate = includeFuture ? (maxDataDate ?? today) : today;

  useEffect(() => {
    const now = new Date();
    if (granularity === "year") {
      const firstYear = minDataDate
        ? minDataDate.getFullYear()
        : now.getFullYear();
      const lastYear = includeFuture
        ? (maxDataDate?.getFullYear() ?? now.getFullYear())
        : now.getFullYear();
      setDateRange([new Date(firstYear, 0, 1), new Date(lastYear, 11, 31)]);
    } else {
      const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const twelveAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
      const startDate =
        minDataDate && minDataDate > twelveAgo ? minDataDate : twelveAgo;
      setDateRange([startDate, endDate]);
    }
  }, [granularity, includeFuture, minDataDate, maxDataDate]);

  const handleReset = useCallback(() => {
    setGranularity("month");
    setIncludeFuture(false);
  }, []);

  const computeTooltipPos = useCallback(
    (coordX: number, coordY: number): { left: number; top: number } => {
      const rect = chartContainerRef.current!.getBoundingClientRect();
      const tooltipMaxH = Math.floor(window.innerHeight * 0.55);
      const rawLeft = rect.left + coordX + TOOLTIP_OFFSET;
      const left =
        rawLeft + TOOLTIP_W > window.innerWidth - 8
          ? Math.max(8, rect.left + coordX - TOOLTIP_W - TOOLTIP_OFFSET)
          : Math.max(8, rawLeft);
      const rawTop = rect.top + coordY - 40;
      const top = Math.max(
        8,
        Math.min(rawTop, window.innerHeight - tooltipMaxH - 8),
      );
      return { left, top };
    },
    [],
  );

  const updateTooltipStateAfterRender = useCallback(
    (next: PortalTooltipState | null) => {
      if (tooltipRenderRafRef.current != null) {
        window.cancelAnimationFrame(tooltipRenderRafRef.current);
      }
      tooltipRenderRafRef.current = window.requestAnimationFrame(() => {
        tooltipRenderRafRef.current = null;
        setTooltipState(next);
      });
    },
    [],
  );

  // Recharts reports active:false after touchend, so mobile taps keep a
  // separate pinned state. Inactive chart hits still clear stale data.
  const barDataRef = useRef<PortalTooltipState | null>(null);
  const isHoverActiveRef = useRef(false);

  const handleChartTouchStart = useCallback(() => {
    if (touchFallbackTimeoutRef.current != null) {
      window.clearTimeout(touchFallbackTimeoutRef.current);
    }
    barDataRef.current = null;
    isHoverActiveRef.current = false;
    isTouchInteractingRef.current = true;
    touchFallbackTimeoutRef.current = window.setTimeout(() => {
      touchFallbackTimeoutRef.current = null;
      isTouchInteractingRef.current = false;
      if (!barDataRef.current) {
        isMobilePinnedRef.current = false;
        setTooltipState(null);
      }
    }, 160);
  }, []);

  const handleChartMouseMove = useCallback(() => {
    if (isMobilePinnedRef.current) return;
    if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      if (isMobilePinnedRef.current) return;
      if (isHoverActiveRef.current && barDataRef.current) {
        setTooltipState(barDataRef.current);
      } else {
        setTooltipState(null);
      }
    });
  }, []);

  const handleChartMouseLeave = useCallback(() => {
    if (!isMobilePinnedRef.current) setTooltipState(null);
  }, []);

  useEffect(() => {
    const handleOutsidePointer = (e: PointerEvent) => {
      if (!isMobilePinnedRef.current) return;
      const target = e.target as Node;
      if (
        tooltipDivRef.current?.contains(target) ||
        chartContainerRef.current?.contains(target)
      )
        return;
      isMobilePinnedRef.current = false;
      setTooltipState(null);
    };
    document.addEventListener("pointerdown", handleOutsidePointer, {
      capture: true,
      passive: true,
    });
    return () =>
      document.removeEventListener("pointerdown", handleOutsidePointer, {
        capture: true,
      });
  }, []);

  useEffect(
    () => () => {
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
      if (tooltipRenderRafRef.current != null) {
        window.cancelAnimationFrame(tooltipRenderRafRef.current);
      }
      if (touchFallbackTimeoutRef.current != null) {
        window.clearTimeout(touchFallbackTimeoutRef.current);
      }
    },
    [],
  );

  const formatDisplayAmount = useCallback(
    (amount: number) =>
      formatCurrency(amount, locale, displayCurrency, displayCurrencySymbol),
    [locale, displayCurrency, displayCurrencySymbol],
  );

  const convertTotalsToDisplay = useCallback(
    (totals: Record<string, number>) =>
      balanceMapAmountForDisplayMode(
        totals,
        displayCurrency,
        convertCurrency,
        includeAllCurrencies,
      ),
    [convertCurrency, displayCurrency, includeAllCurrencies],
  );

  const { chartData, series } = useMemo(() => {
    if (filteredJournal.length === 0 || expenseAccounts.length === 0) {
      return { chartData: [], series: [] };
    }

    const [from, to] = dateRange;
    const fromStr = from
      ? `${from.getFullYear()}-${pad(from.getMonth() + 1)}-01`
      : null;
    const toStr = to ? toDateStr(to) : null;

    const allDates = filteredJournal.map((e) => e.date).sort();
    const displayFrom = fromStr ?? allDates[0]!;
    const displayTo = toStr ?? allDates[allDates.length - 1]!;
    const buckets = generateBuckets(displayFrom, displayTo, granularity);

    const storedBuckets = expenseHistorySnapshot.buckets[granularity];
    const todayBucket = bucketFor(todayStr, granularity);
    const accountTotals = new Map<string, number>();
    const bucketData = new Map<string, Record<string, number>>();

    for (const b of buckets) {
      const row: Record<string, number> = {};
      bucketData.set(b, row);
      if (!includeFuture && b > todayBucket) continue;

      const bucket = storedBuckets[b];
      if (!bucket) continue;

      for (const accountBucket of Object.values(bucket.accounts)) {
        const value = convertTotalsToDisplay(accountBucket.total_by_currency);
        if (value <= 0) continue;

        const name = accountBucket.account_name;
        row[name] = (row[name] ?? 0) + value;
        accountTotals.set(name, (accountTotals.get(name) ?? 0) + value);
      }
    }

    const activeAccounts = Array.from(accountTotals.entries())
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);

    if (activeAccounts.length === 0) {
      return { chartData: [], series: [] };
    }

    const data = buckets.map((b) => {
      const row = bucketData.get(b) ?? {};
      const point: Record<string, unknown> = {
        date: formatLabel(b, granularity),
      };
      for (const name of activeAccounts) {
        point[name] = row[name] ?? 0;
      }
      return point;
    });

    const seriesList = activeAccounts.map((name, i) => ({
      name,
      color: CHART_COLORS[i % CHART_COLORS.length]!,
    }));

    return { chartData: data, series: seriesList };
  }, [
    filteredJournal,
    expenseAccounts,
    granularity,
    dateRange,
    expenseHistorySnapshot,
    todayStr,
    includeFuture,
    convertTotalsToDisplay,
  ]);

  if (expenseAccounts.length === 0) return null;

  const tooltipMaxH = Math.floor(window.innerHeight * 0.55);

  return (
    <>
      {tooltipState &&
        createPortal(
          <div
            ref={tooltipDivRef}
            style={{
              position: "fixed",
              left: tooltipState.left,
              top: tooltipState.top,
              zIndex: 9999,
              maxWidth: TOOLTIP_W,
              maxHeight: tooltipMaxH,
              overflowY: "auto",
            }}
          >
            <ChartTooltip
              label={
                <Group justify="space-between" gap="xl" wrap="nowrap">
                  <span>{tooltipState.label}</span>
                  <span>
                    {formatDisplayAmount(
                      tooltipState.payload.reduce(
                        (sum, p) => sum + Number(p.value ?? 0),
                        0,
                      ),
                    )}
                  </span>
                </Group>
              }
              payload={[...tooltipState.payload].reverse()}
              valueFormatter={(v) => formatDisplayAmount(Number(v))}
            />
          </div>,
          document.body,
        )}
      <Paper withBorder p="md" radius="md">
        <Stack gap="md">
          <Group justify="space-between" align="center" wrap="wrap" gap="xs">
            <Title order={5}>{t("expenseChartTitle")}</Title>
            <Group gap="xs" wrap="wrap">
              <SegmentedControl
                size="xs"
                value={granularity}
                onChange={(v) => setGranularity(v as Granularity)}
                data={[
                  { label: t("granularityYear"), value: "year" },
                  { label: t("granularityMonth"), value: "month" },
                ]}
              />
              {granularity === "month" && (
                <MonthPickerInput
                  type="range"
                  size="xs"
                  value={dateRange}
                  onChange={setDateRange}
                  clearable
                  w={170}
                  minDate={minDataDate ?? undefined}
                  maxDate={maxPickerDate}
                  valueFormat="YYYY/MM"
                />
              )}
              {granularity === "year" && (
                <YearPickerInput
                  type="range"
                  size="xs"
                  value={dateRange}
                  onChange={setDateRange}
                  clearable
                  w={130}
                  minDate={minDataDate ?? undefined}
                  maxDate={maxPickerDate}
                  valueFormat="YYYY"
                />
              )}
              <Tooltip label={t("reset")} withArrow>
                <ActionIcon variant="subtle" color="gray" onClick={handleReset}>
                  <IconRefresh size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
          <Checkbox
            size="xs"
            label={t("includeFutureData")}
            checked={includeFuture}
            onChange={(e) => setIncludeFuture(e.currentTarget.checked)}
          />
          {chartData.length > 0 ? (
            <div
              ref={chartContainerRef}
              onTouchStartCapture={handleChartTouchStart}
              onTouchMoveCapture={handleChartTouchStart}
              onMouseMove={handleChartMouseMove}
              onMouseLeave={handleChartMouseLeave}
            >
              <BarChart
                h={390}
                data={chartData}
                dataKey="date"
                type="stacked"
                series={series}
                valueFormatter={(v) => formatDisplayAmount(v)}
                withLegend
                legendProps={{ verticalAlign: "bottom" }}
                tickLine="xy"
                gridAxis="xy"
                tooltipProps={{
                  wrapperStyle: { display: "none" },
                  content: ({ label, payload, active, coordinate }) => {
                    if (
                      active &&
                      coordinate?.x != null &&
                      coordinate?.y != null &&
                      chartContainerRef.current
                    ) {
                      const { left, top } = computeTooltipPos(
                        coordinate.x,
                        coordinate.y,
                      );
                      const nextTooltipState = {
                        label: label ?? "",
                        payload: (payload ??
                          []) as PortalTooltipState["payload"],
                        left,
                        top,
                      };
                      barDataRef.current = nextTooltipState;
                      isHoverActiveRef.current = true;
                      if (
                        isTouchInteractingRef.current ||
                        isMobilePinnedRef.current
                      ) {
                        if (touchFallbackTimeoutRef.current != null) {
                          window.clearTimeout(touchFallbackTimeoutRef.current);
                          touchFallbackTimeoutRef.current = null;
                        }
                        isTouchInteractingRef.current = false;
                        isMobilePinnedRef.current = true;
                        updateTooltipStateAfterRender(nextTooltipState);
                      }
                    } else {
                      barDataRef.current = null;
                      isHoverActiveRef.current = false;
                      if (!isMobilePinnedRef.current) {
                        updateTooltipStateAfterRender(null);
                      }
                    }
                    return null;
                  },
                }}
              />
            </div>
          ) : (
            <Text c="dimmed" size="sm" ta="center" py="xl">
              {t("noExpenseDataYet")}
            </Text>
          )}
        </Stack>
      </Paper>
    </>
  );
}
