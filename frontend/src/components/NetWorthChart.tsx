import { useCallback, useEffect, useMemo, useState } from "react";
import { AreaChart } from "@mantine/charts";
import {
  DatePickerInput,
  MonthPickerInput,
  YearPickerInput,
} from "@mantine/dates";
import {
  ActionIcon,
  Checkbox,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import type { NetWorthSnapshot } from "@balance-sheet/shared";
import { useLang } from "../i18n";
import { pad, toDateStr } from "../lib/dateUtils";
import { formatCurrency } from "../lib/numberFormat";

type Granularity = "year" | "month" | "day";
type ViewMode = "all" | "assets_liabilities" | "net_worth";

/** Generate every bucket key (YYYY / YYYY-MM / YYYY-MM-DD) between from and to inclusive */
function generateBuckets(from: string, to: string, g: Granularity): string[] {
  const out: string[] = [];
  if (g === "year") {
    for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++)
      out.push(String(y));
  } else if (g === "month") {
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
  } else {
    const d = new Date(from + "T00:00:00");
    const end = new Date(to + "T00:00:00");
    while (d <= end) {
      out.push(toDateStr(d));
      d.setDate(d.getDate() + 1);
    }
  }
  return out;
}

function bucketEnd(b: string, g: Granularity) {
  if (g === "year") return `${b}-12-31`;
  if (g === "month") return `${b}-31`; // always >= any real day in the month
  return b;
}

function formatLabel(b: string, g: Granularity) {
  if (g === "year") return b;
  if (g === "month") return b.replace("-", "/");
  return b.slice(5).replace("-", "/"); // MM/DD
}

interface Props {
  data: NetWorthSnapshot[];
  displayCurrency: string;
  displayCurrencySymbol: string;
  convertCurrency: (amount: number, from: string, to: string) => number;
}

export function NetWorthChart({
  data,
  displayCurrency,
  displayCurrencySymbol,
  convertCurrency,
}: Props) {
  const { t, locale } = useLang();

  const keyAssets = t("chartAssets");
  const keyLiabilities = t("chartLiabilities");
  const keyNetWorth = t("chartNetWorth");

  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [granularity, setGranularity] = useState<Granularity>("month");
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([
    null,
    null,
  ]);
  const [includeFuture, setIncludeFuture] = useState(false);

  const today = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => toDateStr(today), [today]);

  /** Data filtered to exclude future entries when includeFuture is off */
  const filteredData = useMemo(() => {
    if (includeFuture) return data;
    return data.filter((d) => d.date <= todayStr);
  }, [data, includeFuture, todayStr]);

  /** Earliest date in the (filtered) dataset */
  const minDataDate = useMemo(() => {
    if (data.length === 0) return null;
    const sorted = data.map((d) => d.date).sort();
    return new Date(sorted[0]! + "T00:00:00");
  }, [data]);

  /** Latest date in the (filtered) dataset — used as upper bound when includeFuture=true */
  const maxDataDate = useMemo(() => {
    if (data.length === 0) return null;
    const sorted = data.map((d) => d.date).sort();
    return new Date(sorted[sorted.length - 1]! + "T00:00:00");
  }, [data]);

  /** Upper bound for the date picker */
  const maxPickerDate = includeFuture ? (maxDataDate ?? today) : today;

  // Reset date range to a sensible default whenever granularity or includeFuture changes
  useEffect(() => {
    const now = new Date();
    const todayLocal = toDateStr(now);

    if (granularity === "year") {
      const firstYear = minDataDate
        ? minDataDate.getFullYear()
        : now.getFullYear();
      const lastYear = includeFuture
        ? (maxDataDate?.getFullYear() ?? now.getFullYear())
        : now.getFullYear();
      setDateRange([new Date(firstYear, 0, 1), new Date(lastYear, 11, 31)]);
    } else if (granularity === "month") {
      // Default: current month back to 12 months ago
      const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const twelveAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
      const startDate =
        minDataDate && minDataDate > twelveAgo ? minDataDate : twelveAgo;
      setDateRange([startDate, endDate]);
    } else {
      // day: last 30 days up to today (or last data point if includeFuture)
      const endDate =
        includeFuture && maxDataDate && toDateStr(maxDataDate) > todayLocal
          ? maxDataDate
          : now;
      const thirtyAgo = new Date(endDate);
      thirtyAgo.setDate(thirtyAgo.getDate() - 29);
      const startDate =
        minDataDate && minDataDate > thirtyAgo ? minDataDate : thirtyAgo;
      setDateRange([startDate, endDate]);
    }
  }, [granularity, includeFuture, minDataDate, maxDataDate]);

  const handleReset = useCallback(() => {
    setViewMode("all");
    setGranularity("month");
    setIncludeFuture(false);
    // date range will be set by the effect above
  }, []);

  const activeSeries = useMemo(() => {
    const all = [
      { name: keyAssets, color: "teal.6" },
      { name: keyLiabilities, color: "red.6" },
      { name: keyNetWorth, color: "blue.6" },
    ];
    if (viewMode === "assets_liabilities")
      return all.filter((s) => s.name !== keyNetWorth);
    if (viewMode === "net_worth")
      return all.filter((s) => s.name === keyNetWorth);
    return all;
  }, [viewMode, keyAssets, keyLiabilities, keyNetWorth]);

  const processed = useMemo(() => {
    if (filteredData.length === 0) return [];

    const [from, to] = dateRange;
    const fromStr = from ? toDateStr(from) : null;
    const toStr = to ? toDateStr(to) : null;

    const displayFrom = fromStr ?? filteredData[0]!.date;
    const displayTo = toStr ?? filteredData[filteredData.length - 1]!.date;
    const buckets = generateBuckets(displayFrom, displayTo, granularity);

    // Walk sorted data with carry-forward: every bucket gets the last known
    // snapshot whose date falls at or before that bucket's end.
    let dataIdx = 0;
    let lastKnown: NetWorthSnapshot | null = null;
    const result: Record<string, unknown>[] = [];

    for (const b of buckets) {
      const end = bucketEnd(b, granularity);
      while (
        dataIdx < filteredData.length &&
        filteredData[dataIdx]!.date <= end
      ) {
        lastKnown = filteredData[dataIdx]!;
        dataIdx++;
      }
      if (!lastKnown) continue; // before any journal entry
      result.push({
        date: formatLabel(b, granularity),
        [keyAssets]: convertCurrency(lastKnown.assets, "JPY", displayCurrency),
        [keyLiabilities]: convertCurrency(
          lastKnown.liabilities,
          "JPY",
          displayCurrency,
        ),
        [keyNetWorth]: convertCurrency(
          lastKnown.net_worth,
          "JPY",
          displayCurrency,
        ),
      });
    }
    return result;
  }, [
    filteredData,
    granularity,
    dateRange,
    keyAssets,
    keyLiabilities,
    keyNetWorth,
    displayCurrency,
    convertCurrency,
  ]);

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="md">
        <Group justify="space-between" align="center" wrap="wrap" gap="xs">
          <Title order={5}>{t("netWorthOverTime")}</Title>
          <Group gap="xs" wrap="wrap">
            <SegmentedControl
              size="xs"
              value={viewMode}
              onChange={(v) => setViewMode(v as ViewMode)}
              data={[
                { label: t("chartViewAll"), value: "all" },
                {
                  label: t("chartViewAssetsLiabilities"),
                  value: "assets_liabilities",
                },
                { label: t("chartViewNetWorth"), value: "net_worth" },
              ]}
            />
            <SegmentedControl
              size="xs"
              value={granularity}
              onChange={(v) => setGranularity(v as Granularity)}
              data={[
                { label: t("granularityYear"), value: "year" },
                { label: t("granularityMonth"), value: "month" },
                { label: t("granularityDay"), value: "day" },
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
            {granularity === "day" && (
              <DatePickerInput
                type="range"
                size="xs"
                value={dateRange}
                onChange={setDateRange}
                clearable
                w={190}
                minDate={minDataDate ?? undefined}
                maxDate={maxPickerDate}
                valueFormat="YYYY/MM/DD"
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
        <AreaChart
          h={240}
          data={processed}
          dataKey="date"
          series={activeSeries}
          valueFormatter={(v) =>
            formatCurrency(v, locale, displayCurrency, displayCurrencySymbol)
          }
          curveType="monotone"
          withLegend
          withDots={processed.length <= 12}
          tickLine="xy"
          gridAxis="xy"
        />
      </Stack>
    </Paper>
  );
}
