import {
  Badge,
  Button,
  Group,
  Pagination,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { IconAlertTriangle, IconCircleCheck } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { useLang } from "../../i18n";
import { useAppData } from "../../context/AppDataContext";
import { formatJPY } from "../../lib/numberFormat";
import { BudgetPlacementTable } from "../BudgetPlacementTable";
import {
  getBudgetCheckTotals,
  getSuspiciousReasons,
  toDateStr,
  getPageSize,
} from "./ttUtils";

export function BudgetCheckSection() {
  const { t, locale } = useLang();
  const {
    accounts,
    journal,
    budgetCategories,
    budgetSettings,
    budgetSummary,
    displayCurrency,
  } = useAppData();
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([
    null,
    null,
  ]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() =>
    getPageSize("tt:budgetCheckPageSize", 25),
  );

  const filteredJournal = useMemo(() => {
    const [from, to] = dateRange;
    if (!from && !to) return journal;
    return journal.filter((e) => {
      if (from && e.date < toDateStr(from)) return false;
      if (to && e.date > toDateStr(to)) return false;
      return true;
    });
  }, [journal, dateRange]);

  const accountMap = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts],
  );

  const categoryMap = useMemo(
    () => new Map(budgetCategories.map((c) => [c.id, c.name])),
    [budgetCategories],
  );

  const excludedExpenseAllocationCategoryId =
    budgetSettings?.business_advance_budget_category_id ?? null;

  const suspiciousEntries = useMemo(() => {
    return filteredJournal.flatMap((entry) => {
      const reasons = getSuspiciousReasons(
        entry,
        accountMap,
        locale,
        excludedExpenseAllocationCategoryId,
      );
      if (reasons.length === 0) return [];
      return [{ entry, reasons }];
    });
  }, [
    filteredJournal,
    accountMap,
    locale,
    excludedExpenseAllocationCategoryId,
  ]);

  const pageCount = Math.max(1, Math.ceil(suspiciousEntries.length / pageSize));
  const pagedEntries = useMemo(
    () => suspiciousEntries.slice((page - 1) * pageSize, page * pageSize),
    [suspiciousEntries, page, pageSize],
  );

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  // Reset to page 1 when filter changes
  useEffect(() => {
    setPage(1);
  }, [dateRange]);

  const now = new Date();

  return (
    <Stack gap="md">
      <Group align="flex-end" gap="xs" wrap="wrap">
        <DatePickerInput
          type="range"
          value={dateRange}
          onChange={setDateRange}
          clearable
          placeholder={
            locale === "ja"
              ? "Date range (blank = all)"
              : "Date range (blank = all)"
          }
          valueFormat="YYYY/MM/DD"
          w={240}
          size="sm"
        />
        <Button
          size="sm"
          variant="default"
          onClick={() =>
            setDateRange([new Date(now.getFullYear(), now.getMonth(), 1), now])
          }
        >
          {t("filterThisMonth")}
        </Button>
        <Button
          size="sm"
          variant="default"
          onClick={() =>
            setDateRange([
              new Date(now.getFullYear(), now.getMonth() - 1, 1),
              new Date(now.getFullYear(), now.getMonth(), 0),
            ])
          }
        >
          {t("filterLastMonth")}
        </Button>
        <Button
          size="sm"
          variant="default"
          onClick={() => setDateRange([new Date(now.getFullYear(), 0, 1), now])}
        >
          {t("filterThisYear")}
        </Button>
        <Button
          size="sm"
          variant="default"
          onClick={() => setDateRange([null, null])}
        >
          {t("filterAll")}
        </Button>
      </Group>

      <Paper withBorder radius="md" p="md">
        <BudgetPlacementTable
          accounts={accounts}
          categorySummaries={budgetSummary?.categories ?? []}
          currency={displayCurrency || "JPY"}
        />
      </Paper>

      <Paper withBorder radius="md" p="md">
        <Group mb="sm" justify="space-between">
          <Group gap="xs">
            {suspiciousEntries.length === 0 ? (
              <ThemeIcon color="teal" variant="light" size="sm" radius="xl">
                <IconCircleCheck size={14} />
              </ThemeIcon>
            ) : (
              <ThemeIcon color="orange" variant="light" size="sm" radius="xl">
                <IconAlertTriangle size={14} />
              </ThemeIcon>
            )}
            <Text fw={600} size="sm">
              {t("budgetConsistencyTitle")}
            </Text>
          </Group>
          <Group gap="xs">
            {suspiciousEntries.length > 0 && (
              <Badge color="red" variant="light">
                {t("budgetConsistencyIssues").replace(
                  "{n}",
                  String(suspiciousEntries.length),
                )}
              </Badge>
            )}
            <Badge color="gray" variant="light">
              {t("budgetConsistencyChecked").replace(
                "{n}",
                String(filteredJournal.length),
              )}
            </Badge>
          </Group>
        </Group>

        {suspiciousEntries.length === 0 ? (
          <Text size="sm" c="dimmed">
            {t("budgetConsistencyClear").replace(
              "{n}",
              String(filteredJournal.length),
            )}
          </Text>
        ) : (
          <Stack gap="sm">
            <Group
              justify="space-between"
              align="flex-end"
              wrap="wrap"
              gap="xs"
            >
              <Text size="sm" c="dimmed">
                {t("pageSummary")
                  .replace("{from}", String((page - 1) * pageSize + 1))
                  .replace(
                    "{to}",
                    String(Math.min(suspiciousEntries.length, page * pageSize)),
                  )
                  .replace("{total}", String(suspiciousEntries.length))}
              </Text>
              <Group gap="xs" align="flex-end" wrap="wrap">
                <Select
                  label={t("rowsPerPage")}
                  size="xs"
                  w={120}
                  data={["10", "25", "50", "100"]}
                  value={String(pageSize)}
                  onChange={(value) => {
                    const next = Number(value ?? 25);
                    setPageSize(next);
                    setPage(1);
                    localStorage.setItem(
                      "tt:budgetCheckPageSize",
                      String(next),
                    );
                  }}
                />
                <Pagination
                  total={pageCount}
                  value={page}
                  onChange={setPage}
                  size="sm"
                />
              </Group>
            </Group>
            <Table fz="sm" withRowBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Description</Table.Th>
                  <Table.Th className="currency-cell">
                    {locale === "ja" ? "費用" : "Expense"}
                  </Table.Th>
                  <Table.Th className="currency-cell">
                    {t("budgetCheckAllocated")}
                  </Table.Th>
                  <Table.Th>{t("budgetCheckIssue")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {pagedEntries.map(({ entry, reasons }) => {
                  const {
                    totalExpense,
                    totalIncome,
                    totalExpenseAllocated,
                    totalIncomeAllocated,
                  } = getBudgetCheckTotals(
                    entry,
                    accountMap,
                    excludedExpenseAllocationCategoryId,
                  );
                  const displayAmount =
                    totalExpense > 0 ? totalExpense : totalIncome;
                  const totalAllocated =
                    totalExpense > 0
                      ? totalExpenseAllocated
                      : totalIncomeAllocated;
                  const allocatedCatNames = [
                    ...(entry.budget_allocations ?? []),
                    ...(entry.income_budget_allocations ?? []),
                  ]
                    .map((a) => categoryMap.get(a.budget_category_id))
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <Table.Tr
                      key={entry.id}
                      style={{
                        background: "var(--mantine-color-red-light)",
                      }}
                    >
                      <Table.Td style={{ whiteSpace: "nowrap" }}>
                        {entry.date}
                      </Table.Td>
                      <Table.Td>{entry.description}</Table.Td>
                      <Table.Td className="currency-cell">
                        {formatJPY(displayAmount, locale)}
                      </Table.Td>
                      <Table.Td className="currency-cell">
                        {totalAllocated > 0 ? (
                          <Text
                            size="sm"
                            title={allocatedCatNames || undefined}
                          >
                            {formatJPY(totalAllocated, locale)}
                            {allocatedCatNames && (
                              <Text size="xs" c="dimmed" span>
                                {" "}
                                ({allocatedCatNames})
                              </Text>
                            )}
                          </Text>
                        ) : (
                          <Text size="sm" c="dimmed">
                            —{" "}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {reasons.map((r, i) => (
                          <Text key={i} size="xs" c="red">
                            {r}
                          </Text>
                        ))}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}
