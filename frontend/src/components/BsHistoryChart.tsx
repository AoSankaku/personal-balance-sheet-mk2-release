import { useCallback, useEffect, useMemo, useState } from "react";
import { AreaChart } from "@mantine/charts";
import {
  DatePickerInput,
  MonthPickerInput,
  YearPickerInput,
} from "@mantine/dates";
import {
  ActionIcon,
  Group,
  MultiSelect,
  Paper,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import type { Account, JournalEntry } from "@balance-sheet/shared";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import { pad, toDateStr } from "../lib/dateUtils";
import { formatCurrency } from "../lib/numberFormat";
import {
  isUserSelectableAccount,
  toAccountSelectOption,
} from "../lib/accountUtils";
import { lineAmountForDisplayMode } from "../lib/displayCurrencyAmounts";
import { privacyChartAmount } from "../lib/privacy";

type Granularity = "year" | "month" | "day";

const TOTAL_ASSETS_KEY = "__total_assets__";
const TOTAL_LIABILITIES_KEY = "__total_liabilities__";

const SERIES_COLORS = [
  "teal.6",
  "red.6",
  "blue.5",
  "violet.5",
  "orange.5",
  "grape.5",
  "cyan.6",
  "green.6",
  "lime.5",
  "yellow.5",
];

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
  if (g === "month") return `${b}-31`;
  return b;
}

function formatLabel(b: string, g: Granularity) {
  if (g === "year") return b;
  if (g === "month") return b.replace("-", "/");
  return b.slice(5).replace("-", "/");
}

interface Props {
  journal: JournalEntry[];
  accounts: Account[];
  includeAllCurrencies?: boolean;
}

export function BsHistoryChart({
  journal,
  accounts,
  includeAllCurrencies = false,
}: Props) {
  const { t, locale } = useLang();
  const { displayCurrency, displayCurrencySymbol, convertCurrency } =
    useAppData();

  const totalAssetsLabel = t("bsChartTotalAssets");
  const totalLiabilitiesLabel = t("bsChartTotalLiabilities");

  const [selectedKeys, setSelectedKeys] = useState<string[]>([
    TOTAL_ASSETS_KEY,
    TOTAL_LIABILITIES_KEY,
  ]);
  const [stacked, setStacked] = useState(false);
  const [granularity, setGranularity] = useState<Granularity>("month");
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([
    null,
    null,
  ]);

  // Build per-account balance history from journal lines.
  // Exclude future-dated entries so charts never extend beyond today.
  const rawHistory = useMemo(() => {
    if (journal.length === 0) return [];

    const todayStr = toDateStr(new Date());
    const pastJournal = journal.filter((e) => e.date.slice(0, 10) <= todayStr);
    if (pastJournal.length === 0) return [];

    const accountTypeMap = new Map<number, string>();
    for (const a of accounts) accountTypeMap.set(a.id, a.type);

    const dateSet = new Set<string>();
    for (const entry of pastJournal) dateSet.add(entry.date.slice(0, 10));
    const dates = Array.from(dateSet).sort();
    if (dates.length < 2) return [];

    const sorted = [...pastJournal].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    const balances = new Map<number, number>();
    let idx = 0;

    return dates.map((date) => {
      while (idx < sorted.length && sorted[idx]!.date.slice(0, 10) <= date) {
        for (const line of sorted[idx]!.lines) {
          const type = accountTypeMap.get(line.account_id);
          const cur = balances.get(line.account_id) ?? 0;
          if (type === "asset") {
            balances.set(
              line.account_id,
              cur +
                lineAmountForDisplayMode(
                  line.debit - line.credit,
                  line.currency,
                  displayCurrency,
                  convertCurrency,
                  includeAllCurrencies,
                ),
            );
          } else if (type === "liability") {
            balances.set(
              line.account_id,
              cur +
                lineAmountForDisplayMode(
                  line.credit - line.debit,
                  line.currency,
                  displayCurrency,
                  convertCurrency,
                  includeAllCurrencies,
                ),
            );
          }
        }
        idx++;
      }

      const point: Record<string, number | string> = { date };
      let totalAssets = 0;
      let totalLiabilities = 0;

      for (const [id, bal] of balances) {
        const type = accountTypeMap.get(id);
        if (type === "asset") {
          totalAssets += Math.max(0, bal);
          point[String(id)] = Math.max(0, bal);
        } else if (type === "liability") {
          totalLiabilities += Math.max(0, bal);
          point[String(id)] = Math.max(0, bal);
        }
      }

      point[TOTAL_ASSETS_KEY] = totalAssets;
      point[TOTAL_LIABILITIES_KEY] = totalLiabilities;

      return point;
    });
  }, [
    journal,
    accounts,
    convertCurrency,
    displayCurrency,
    includeAllCurrencies,
  ]);

  const minDataDate = useMemo(() => {
    if (rawHistory.length === 0) return null;
    return new Date(String(rawHistory[0]!.date) + "T00:00:00");
  }, [rawHistory]);

  const today = useMemo(() => new Date(), []);

  useEffect(() => {
    const now = new Date();
    if (granularity === "year") {
      const firstYear = minDataDate
        ? minDataDate.getFullYear()
        : now.getFullYear();
      setDateRange([
        new Date(firstYear, 0, 1),
        new Date(now.getFullYear(), 11, 31),
      ]);
    } else if (granularity === "month") {
      const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const twelveAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
      const startDate =
        minDataDate && minDataDate > twelveAgo ? minDataDate : twelveAgo;
      setDateRange([startDate, endDate]);
    } else {
      const thirtyAgo = new Date(now);
      thirtyAgo.setDate(thirtyAgo.getDate() - 29);
      const startDate =
        minDataDate && minDataDate > thirtyAgo ? minDataDate : thirtyAgo;
      setDateRange([startDate, now]);
    }
  }, [granularity, minDataDate]);

  const handleReset = useCallback(() => {
    setSelectedKeys([TOTAL_ASSETS_KEY, TOTAL_LIABILITIES_KEY]);
    setStacked(false);
    setGranularity("month");
  }, []);

  // Grouped options for MultiSelect
  const selectData = useMemo(() => {
    const assetAccounts = accounts.filter(
      (a) => a.type === "asset" && isUserSelectableAccount(a),
    );
    const liabilityAccounts = accounts.filter(
      (a) => a.type === "liability" && isUserSelectableAccount(a),
    );

    return [
      {
        group: t("bsChartTotals"),
        items: [
          { value: TOTAL_ASSETS_KEY, label: totalAssetsLabel },
          { value: TOTAL_LIABILITIES_KEY, label: totalLiabilitiesLabel },
        ],
      },
      {
        group: t("sectionAssets"),
        items: assetAccounts.map((a) => toAccountSelectOption(a, t)),
      },
      {
        group: t("sectionLiabilities"),
        items: liabilityAccounts.map((a) => toAccountSelectOption(a, t)),
      },
    ];
  }, [accounts, totalAssetsLabel, totalLiabilitiesLabel, t]);

  // Build series config with display names
  const series = useMemo(() => {
    return selectedKeys.map((key, i) => {
      let name: string;
      if (key === TOTAL_ASSETS_KEY) name = totalAssetsLabel;
      else if (key === TOTAL_LIABILITIES_KEY) name = totalLiabilitiesLabel;
      else {
        const acc = accounts.find((a) => String(a.id) === key);
        name = acc?.name ?? key;
      }
      return {
        dataKey: key,
        name,
        color: SERIES_COLORS[i % SERIES_COLORS.length]!,
      };
    });
  }, [selectedKeys, accounts, totalAssetsLabel, totalLiabilitiesLabel]);

  // Bucket + carry-forward processing
  const processed = useMemo(() => {
    if (rawHistory.length === 0 || series.length === 0) return [];

    const [from, to] = dateRange;
    const fromStr = from ? toDateStr(from) : null;
    const toStr = to ? toDateStr(to) : null;
    const displayFrom = fromStr ?? String(rawHistory[0]!.date);
    const displayTo = toStr ?? String(rawHistory[rawHistory.length - 1]!.date);
    const buckets = generateBuckets(displayFrom, displayTo, granularity);

    let dataIdx = 0;
    let lastKnown: Record<string, number | string> | null = null;
    const result: Record<string, unknown>[] = [];

    for (const b of buckets) {
      const end = bucketEnd(b, granularity);
      while (
        dataIdx < rawHistory.length &&
        String(rawHistory[dataIdx]!.date) <= end
      ) {
        lastKnown = rawHistory[dataIdx] as Record<string, number | string>;
        dataIdx++;
      }
      if (!lastKnown) continue;

      const point: Record<string, unknown> = {
        date: formatLabel(b, granularity),
      };
      for (const s of series) {
        point[s.name] = privacyChartAmount((lastKnown[s.dataKey] as number) ?? 0);
      }
      result.push(point);
    }
    return result;
  }, [rawHistory, dateRange, granularity, series]);

  if (rawHistory.length < 2) return null;

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="xs">
          <Title order={5}>{t("bsTrendTitle")}</Title>
          <Group gap="xs" wrap="wrap" align="flex-end">
            <MultiSelect
              size="xs"
              data={selectData}
              value={selectedKeys}
              onChange={setSelectedKeys}
              maxValues={8}
              w={220}
              placeholder={t("bsChartSelectLabel")}
              searchable
              clearable
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
                maxDate={today}
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
                maxDate={today}
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
                maxDate={today}
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
        <Switch
          size="xs"
          label={t("bsChartStacked")}
          checked={stacked}
          onChange={(e) => setStacked(e.currentTarget.checked)}
        />
        {processed.length > 0 ? (
          <AreaChart
            h={240}
            data={processed}
            dataKey="date"
            series={series.map((s) => ({ name: s.name, color: s.color }))}
            type={stacked ? "stacked" : "default"}
            valueFormatter={(v) =>
              formatCurrency(
                v,
                locale,
                displayCurrency,
                displayCurrencySymbol,
              )
            }
            curveType="monotone"
            withLegend
            withDots={processed.length <= 12}
            tickLine="xy"
            gridAxis="xy"
          />
        ) : (
          <Text size="sm" c="dimmed" ta="center" py="xl">
            {t("bsChartSelectLabel")}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
