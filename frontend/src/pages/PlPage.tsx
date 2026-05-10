import {
  ActionIcon,
  Anchor,
  Box,
  Button,
  Group,
  Paper,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  Tooltip,
  rem,
} from "@mantine/core";
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronLeft,
  IconChevronRight,
  IconSelector,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import { ExpenseBarChart } from "../components/ExpenseBarChart";
import { AppDataErrorAlert } from "../components/AppDataErrorAlert";
import { systemAccountTranslationKey } from "../lib/accountUtils";
import { formatCurrency } from "../lib/numberFormat";

type ViewMode = "month" | "quarter" | "half" | "year";
type SortField = "name" | "amount";
type SortDir = "asc" | "desc";

const pad = (n: number) => String(n).padStart(2, "0");

/** Number of sub-periods per year for each mode. */
function subPeriodsPerYear(mode: ViewMode): number {
  if (mode === "month") return 12;
  if (mode === "quarter") return 4;
  if (mode === "half") return 2;
  return 1;
}

/**
 * Return the first and last calendar month (1-based) for a given sub-period.
 * For year mode, sub is ignored (always 1–12).
 */
function periodMonthRange(
  mode: ViewMode,
  sub: number,
): { startMonth: number; endMonth: number } {
  if (mode === "month") return { startMonth: sub, endMonth: sub };
  if (mode === "quarter")
    return { startMonth: (sub - 1) * 3 + 1, endMonth: sub * 3 };
  if (mode === "half")
    return { startMonth: (sub - 1) * 6 + 1, endMonth: sub * 6 };
  return { startMonth: 1, endMonth: 12 };
}

/** Total days in the period (inclusive). */
function daysInPeriod(mode: ViewMode, year: number, sub: number): number {
  const { startMonth, endMonth } = periodMonthRange(mode, sub);
  let total = 0;
  for (let m = startMonth; m <= endMonth; m++) {
    total += new Date(year, m, 0).getDate();
  }
  return total;
}

/**
 * Convert a sub-period number from one mode to the equivalent sub-period in
 * another mode, keeping the same "start of period" anchor month.
 */
function convertSub(
  fromMode: ViewMode,
  fromSub: number,
  toMode: ViewMode,
): number {
  const { startMonth } = periodMonthRange(fromMode, fromSub);
  if (toMode === "month") return startMonth;
  if (toMode === "quarter") return Math.ceil(startMonth / 3);
  if (toMode === "half") return Math.ceil(startMonth / 6);
  return 1;
}

/** Human-readable period label. */
function buildPeriodLabel(
  mode: ViewMode,
  year: number,
  sub: number,
  locale: string,
): string {
  if (mode === "month") {
    return locale === "ja"
      ? `${year}年${sub}月`
      : dayjs(`${year}-${pad(sub)}-01`).format("MMMM YYYY");
  }
  if (mode === "quarter") {
    return locale === "ja" ? `${year}年 第${sub}四半期` : `Q${sub} ${year}`;
  }
  if (mode === "half") {
    if (locale === "ja") {
      return sub === 1 ? `${year}年 上半期` : `${year}年 下半期`;
    }
    return `H${sub} ${year}`;
  }
  return locale === "ja" ? `${year}年` : String(year);
}

function SortIcon({
  field,
  sortBy,
  sortDir,
}: {
  field: SortField;
  sortBy: SortField;
  sortDir: SortDir;
}) {
  if (sortBy !== field)
    return <IconSelector size={12} style={{ opacity: 0.4 }} />;
  return sortDir === "asc" ? (
    <IconArrowUp size={12} />
  ) : (
    <IconArrowDown size={12} />
  );
}

interface PlRow {
  id: number;
  name: string;
  balance: number;
}

function PlTable({
  title,
  rows,
  total,
  days,
  sortBy,
  sortDir,
  onSort,
  color,
  fmt,
}: {
  title: string;
  rows: PlRow[];
  total: number;
  days: number;
  sortBy: SortField;
  sortDir: SortDir;
  onSort: (f: SortField) => void;
  color: string;
  fmt: (amount: number) => string;
}) {
  const { t } = useLang();

  function rate(amount: number, multiplier: number): string {
    if (days <= 0) return "—";
    return fmt((amount / days) * multiplier);
  }

  const thRight: React.CSSProperties = {
    textAlign: "right",
    whiteSpace: "nowrap",
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="xs">
        <Text fw={700} size="sm">
          {title}
        </Text>
        <Text fw={700} size="sm" c={color}>
          {fmt(total)}
        </Text>
      </Group>
      <ScrollArea>
        <Table
          striped
          highlightOnHover
          withTableBorder
          withColumnBorders
          style={{ minWidth: 560 }}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th
                style={{ cursor: "pointer", userSelect: "none" }}
                onClick={() => onSort("name")}
              >
                <Group gap={4} wrap="nowrap">
                  {t("thAccount")}
                  <SortIcon field="name" sortBy={sortBy} sortDir={sortDir} />
                </Group>
              </Table.Th>
              <Table.Th
                style={{ ...thRight, cursor: "pointer", userSelect: "none" }}
                onClick={() => onSort("amount")}
              >
                <Group gap={4} wrap="nowrap" justify="flex-end">
                  {t("plTotal")}
                  <SortIcon field="amount" sortBy={sortBy} sortDir={sortDir} />
                </Group>
              </Table.Th>
              <Table.Th style={thRight}>{t("plPerYear")}</Table.Th>
              <Table.Th style={thRight}>{t("plPerMonth")}</Table.Th>
              <Table.Th style={thRight}>{t("plPerDay")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={5}>
                  <Text c="dimmed" ta="center" size="sm" py="xs">
                    —
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              rows.map((row) => (
                <Table.Tr key={row.id}>
                  <Table.Td>
                    <Text size="sm">{row.name}</Text>
                  </Table.Td>
                  <Table.Td className="currency-cell">
                    <Text
                      size="sm"
                      fw={500}
                      c={row.balance > 0 ? color : undefined}
                    >
                      {fmt(row.balance)}
                    </Text>
                  </Table.Td>
                  <Table.Td className="currency-cell">
                    <Text size="sm" c="dimmed">
                      {rate(row.balance, 365)}
                    </Text>
                  </Table.Td>
                  <Table.Td className="currency-cell">
                    <Text size="sm" c="dimmed">
                      {rate(row.balance, 30.4375)}
                    </Text>
                  </Table.Td>
                  <Table.Td className="currency-cell">
                    <Text size="sm" c="dimmed">
                      {rate(row.balance, 1)}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))
            )}
            {/* Total row */}
            <Table.Tr>
              <Table.Td>
                <Text size="sm" fw={700}>
                  {t("total")}
                </Text>
              </Table.Td>
              <Table.Td className="currency-cell">
                <Text size="sm" fw={700} c={color}>
                  {fmt(total)}
                </Text>
              </Table.Td>
              <Table.Td className="currency-cell">
                <Text size="sm" fw={700}>
                  {rate(total, 365)}
                </Text>
              </Table.Td>
              <Table.Td className="currency-cell">
                <Text size="sm" fw={700}>
                  {rate(total, 30.4375)}
                </Text>
              </Table.Td>
              <Table.Td className="currency-cell">
                <Text size="sm" fw={700}>
                  {rate(total, 1)}
                </Text>
              </Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Paper>
  );
}

export default function PlPage() {
  const { t, locale } = useLang();
  const accountDisplayName = (name: string) => {
    const key = systemAccountTranslationKey(name);
    return key ? t(key) : name;
  };
  const {
    accounts,
    journal,
    loading,
    error,
    displayCurrency,
    displayCurrencySymbol,
    convertCurrency,
  } = useAppData();

  const fmt = (amount: number) =>
    formatCurrency(
      convertCurrency(amount, "JPY", displayCurrency),
      locale,
      displayCurrency,
      displayCurrencySymbol,
    );

  const now = new Date();
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth() + 1;

  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [currentYear, setCurrentYear] = useState(nowYear);
  // sub-period: 1–12 for month, 1–4 for quarter, 1–2 for half, 1 for year
  const [currentSub, setCurrentSub] = useState(nowMonth);

  const [sortBy, setSortBy] = useState<SortField>("amount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // ── Navigator ──────────────────────────────────────────────────────────────

  function handleModeChange(next: ViewMode) {
    // Preserve the visible period when switching modes
    const newSub = convertSub(viewMode, currentSub, next);
    setCurrentSub(newSub);
    setViewMode(next);
  }

  function prevPeriod() {
    const count = subPeriodsPerYear(viewMode);
    if (currentSub === 1) {
      setCurrentSub(count);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentSub((s) => s - 1);
    }
  }

  function nextPeriod() {
    const count = subPeriodsPerYear(viewMode);
    if (currentSub === count) {
      setCurrentSub(1);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentSub((s) => s + 1);
    }
  }

  function goToCurrent() {
    setCurrentYear(nowYear);
    setCurrentSub(convertSub("month", nowMonth, viewMode));
  }

  const isCurrentPeriod = useMemo(() => {
    if (currentYear !== nowYear) return false;
    return currentSub === convertSub("month", nowMonth, viewMode);
  }, [currentYear, currentSub, viewMode, nowYear, nowMonth]);

  const periodLabel = useMemo(
    () => buildPeriodLabel(viewMode, currentYear, currentSub, locale),
    [viewMode, currentYear, currentSub, locale],
  );

  // ── Date range ─────────────────────────────────────────────────────────────

  const { fromStr, toStr, days } = useMemo(() => {
    const { startMonth, endMonth } = periodMonthRange(viewMode, currentSub);
    const lastDay = new Date(currentYear, endMonth, 0).getDate();
    return {
      fromStr: `${currentYear}-${pad(startMonth)}-01`,
      toStr: `${currentYear}-${pad(endMonth)}-${pad(lastDay)}`,
      days: daysInPeriod(viewMode, currentYear, currentSub),
    };
  }, [viewMode, currentYear, currentSub]);

  // ── Journal filtering ──────────────────────────────────────────────────────

  const filteredJournal = useMemo(
    () => journal.filter((e) => e.date >= fromStr && e.date <= toStr),
    [journal, fromStr, toStr],
  );

  // ── Account balances ───────────────────────────────────────────────────────

  const accountBalances = useMemo(() => {
    const map = new Map<number, number>();
    const typeMap = new Map(accounts.map((a) => [a.id, a.type]));
    for (const entry of filteredJournal) {
      for (const line of entry.lines) {
        const type = typeMap.get(line.account_id);
        if (type === "income") {
          map.set(
            line.account_id,
            (map.get(line.account_id) ?? 0) + line.credit - line.debit,
          );
        } else if (type === "expense") {
          map.set(
            line.account_id,
            (map.get(line.account_id) ?? 0) + line.debit - line.credit,
          );
        }
      }
    }
    return map;
  }, [filteredJournal, accounts]);

  function sortRows(list: PlRow[]): PlRow[] {
    return [...list].sort((a, b) => {
      const cmp =
        sortBy === "name"
          ? a.name.localeCompare(b.name)
          : a.balance - b.balance;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }

  const incomeRows = useMemo(
    () =>
      sortRows(
        accounts
          .filter((a) => a.type === "income")
          .map((a) => ({
            id: a.id,
            name: accountDisplayName(a.name),
            balance: accountBalances.get(a.id) ?? 0,
          })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, accountBalances, sortBy, sortDir],
  );

  const expenseRows = useMemo(
    () =>
      sortRows(
        accounts
          .filter((a) => a.type === "expense")
          .map((a) => ({
            id: a.id,
            name: accountDisplayName(a.name),
            balance: accountBalances.get(a.id) ?? 0,
          })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, accountBalances, sortBy, sortDir],
  );

  const totalIncome = incomeRows.reduce((s, r) => s + r.balance, 0);
  const totalExpense = expenseRows.reduce((s, r) => s + r.balance, 0);
  const netIncome = totalIncome - totalExpense;

  function toggleSort(field: SortField) {
    if (sortBy === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Stack gap="lg">
        <Skeleton height={22} width={100} radius="sm" />
        <Skeleton height={52} radius="md" />
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={80} radius="md" />
          ))}
        </SimpleGrid>
        {[0, 1].map((i) => (
          <Skeleton key={i} height={160} radius="md" />
        ))}
      </Stack>
    );
  }

  if (error) {
    return <AppDataErrorAlert error={error} />;
  }

  return (
    <Stack gap="lg">
      <Anchor component={Link} to="/fs" size="sm" c="dimmed">
        ← {t("navFS")}
      </Anchor>

      {/* Period navigator */}
      <Paper withBorder p="sm" radius="md">
        <Group justify="space-between" align="center" wrap="wrap" gap="xs">
          <SegmentedControl
            size="xs"
            value={viewMode}
            onChange={(v) => handleModeChange(v as ViewMode)}
            data={[
              { label: t("granularityMonth"), value: "month" },
              { label: t("granularityQuarter"), value: "quarter" },
              { label: t("granularityHalf"), value: "half" },
              { label: t("granularityYear"), value: "year" },
            ]}
          />
          <Group gap="xs" align="center">
            <ActionIcon variant="subtle" color="gray" onClick={prevPeriod}>
              <IconChevronLeft size={16} />
            </ActionIcon>
            <Text
              fw={700}
              size="sm"
              style={{ minWidth: rem(160), textAlign: "center" }}
            >
              {periodLabel}
            </Text>
            <ActionIcon variant="subtle" color="gray" onClick={nextPeriod}>
              <IconChevronRight size={16} />
            </ActionIcon>
          </Group>
          <Tooltip
            label={
              viewMode === "month" ? t("filterThisMonth") : t("filterThisYear")
            }
            withArrow
          >
            <Button
              size="xs"
              variant={isCurrentPeriod ? "filled" : "default"}
              color="teal"
              onClick={goToCurrent}
            >
              {t("plGoToCurrent")}
            </Button>
          </Tooltip>
        </Group>
      </Paper>

      {/* Summary cards */}
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Paper
          withBorder
          p="md"
          radius="md"
          style={{ borderLeft: "4px solid var(--mantine-color-teal-6)" }}
        >
          <Text size="xs" tt="uppercase" fw={700} c="dimmed">
            {t("income")}
          </Text>
          <Text size="xl" fw={700} c="teal">
            {fmt(totalIncome)}
          </Text>
          {days > 0 && (
            <Box mt={4}>
              <Group gap="sm">
                <Box style={{ flex: 1 }}>
                  <Text size="xs" c="dimmed">
                    {t("plPerYear")}
                  </Text>
                  <Text size="xs" fw={600}>
                    {fmt((totalIncome / days) * 365)}
                  </Text>
                </Box>
                <Box style={{ flex: 1 }}>
                  <Text size="xs" c="dimmed">
                    {t("plPerMonth")}
                  </Text>
                  <Text size="xs" fw={600}>
                    {fmt((totalIncome / days) * 30.4375)}
                  </Text>
                </Box>
                <Box style={{ flex: 1 }}>
                  <Text size="xs" c="dimmed">
                    {t("plPerDay")}
                  </Text>
                  <Text size="xs" fw={600}>
                    {fmt(totalIncome / days)}
                  </Text>
                </Box>
              </Group>
            </Box>
          )}
        </Paper>
        <Paper
          withBorder
          p="md"
          radius="md"
          style={{ borderLeft: "4px solid var(--mantine-color-red-6)" }}
        >
          <Text size="xs" tt="uppercase" fw={700} c="dimmed">
            {t("expenses")}
          </Text>
          <Text size="xl" fw={700} c="red">
            {fmt(totalExpense)}
          </Text>
          {days > 0 && (
            <Box mt={4}>
              <Group gap="sm">
                <Box style={{ flex: 1 }}>
                  <Text size="xs" c="dimmed">
                    {t("plPerYear")}
                  </Text>
                  <Text size="xs" fw={600}>
                    {fmt((totalExpense / days) * 365)}
                  </Text>
                </Box>
                <Box style={{ flex: 1 }}>
                  <Text size="xs" c="dimmed">
                    {t("plPerMonth")}
                  </Text>
                  <Text size="xs" fw={600}>
                    {fmt((totalExpense / days) * 30.4375)}
                  </Text>
                </Box>
                <Box style={{ flex: 1 }}>
                  <Text size="xs" c="dimmed">
                    {t("plPerDay")}
                  </Text>
                  <Text size="xs" fw={600}>
                    {fmt(totalExpense / days)}
                  </Text>
                </Box>
              </Group>
            </Box>
          )}
        </Paper>
        <Paper
          withBorder
          p="md"
          radius="md"
          style={{
            borderLeft: `4px solid var(--mantine-color-${netIncome >= 0 ? "blue" : "red"}-6)`,
          }}
        >
          <Text size="xs" tt="uppercase" fw={700} c="dimmed">
            {t("netIncome")}
          </Text>
          <Text size="xl" fw={700} c={netIncome >= 0 ? "blue" : "red"}>
            {fmt(netIncome)}
          </Text>
          {days > 0 && (
            <Box mt={4}>
              <Group gap="sm">
                <Box style={{ flex: 1 }}>
                  <Text size="xs" c="dimmed">
                    {t("plPerYear")}
                  </Text>
                  <Text size="xs" fw={600}>
                    {fmt((netIncome / days) * 365)}
                  </Text>
                </Box>
                <Box style={{ flex: 1 }}>
                  <Text size="xs" c="dimmed">
                    {t("plPerMonth")}
                  </Text>
                  <Text size="xs" fw={600}>
                    {fmt((netIncome / days) * 30.4375)}
                  </Text>
                </Box>
                <Box style={{ flex: 1 }}>
                  <Text size="xs" c="dimmed">
                    {t("plPerDay")}
                  </Text>
                  <Text size="xs" fw={600}>
                    {fmt(netIncome / days)}
                  </Text>
                </Box>
              </Group>
            </Box>
          )}
        </Paper>
      </SimpleGrid>

      {/* Expense bar chart (same as /fs) */}
      <ExpenseBarChart journal={journal} accounts={accounts} />

      {/* Income table */}
      <PlTable
        title={t("sectionIncome")}
        rows={incomeRows}
        total={totalIncome}
        days={days}
        sortBy={sortBy}
        sortDir={sortDir}
        onSort={toggleSort}
        color="teal"
        fmt={fmt}
      />

      {/* Expense table */}
      <PlTable
        title={t("sectionExpenses")}
        rows={expenseRows}
        total={totalExpense}
        days={days}
        sortBy={sortBy}
        sortDir={sortDir}
        onSort={toggleSort}
        color="red"
        fmt={fmt}
      />

      {/* Budget consistency notice */}
      <Paper withBorder radius="md" p="md">
        <Text size="sm" c="dimmed">
          {t("budgetCheckMovedNotice")}
        </Text>
        <Anchor component={Link} to="/fs/tt" size="sm" mt={4} display="block">
          {t("budgetCheckMovedLink")}
        </Anchor>
      </Paper>
    </Stack>
  );
}
