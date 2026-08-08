import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Pagination,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useDisclosure } from "@mantine/hooks";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconPencil,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type {
  BudgetAdjustmentLog,
  CreateJournalInput,
  JournalEntry,
} from "@balance-sheet/shared";
import { api } from "../../api/client";
import { useLang } from "../../i18n";
import { useAppData } from "../../context/AppDataContext";
import { usePrivacy } from "../../context/PrivacyContext";
import {
  findLatestBudgetResetBoundary,
  getAllocatableAssetDelta,
  getLoanBudgetFundingPrincipal,
  isEntryAfterBudgetReset,
  isLoanBudgetFundingMissing,
} from "../../lib/budgetFundingCompleteness";
import {
  findPreResetCreditCardSettlements,
  getExcludedCashBudgetConsumptionAmount,
  getUnallocatedAllocatableIncomeAmount,
} from "../../lib/budgetConsistency";
import { formatCurrency, formatJPY } from "../../lib/numberFormat";
import { showFeedback } from "../../lib/feedback";
import { BudgetPlacementTable } from "../BudgetPlacementTable";
import { JournalModal } from "../JournalModal";
import {
  getBudgetCheckTotals,
  getSuspiciousReasons,
  toDateStr,
  getPageSize,
} from "./ttUtils";

export function BudgetCheckSection() {
  const { t, locale } = useLang();
  const { privacyMode } = usePrivacy();
  const {
    accounts,
    accountsToday,
    journal,
    budgetCategories,
    budgetSettings,
    budgetSummary,
    budgetSummaryToday,
    budgetSummaryTotal,
    displayCurrency,
    refresh,
    refreshAllocatable,
    refreshBudget,
  } = useAppData();
  const [searchParams, setSearchParams] = useSearchParams();
  const placementBasis =
    searchParams.get("basis") === "today" ? "today" : "total";
  const placementAccounts =
    placementBasis === "today" ? accountsToday : accounts;
  const placementSummary =
    placementBasis === "today"
      ? budgetSummaryToday
      : (budgetSummaryTotal ?? budgetSummary);
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([
    null,
    null,
  ]);
  const [resetLogs, setResetLogs] = useState<BudgetAdjustmentLog[] | null>(
    null,
  );
  const [resetLogsError, setResetLogsError] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() =>
    getPageSize("tt:budgetCheckPageSize", 25),
  );
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [
    journalEditOpened,
    { open: openJournalEdit, close: closeJournalEdit },
  ] = useDisclosure(false);

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

  useEffect(() => {
    let active = true;
    setResetLogs(null);
    setResetLogsError(false);
    api.budget
      .listAdjustmentLogs({
        currency: displayCurrency || "JPY",
        resetsOnly: true,
      })
      .then((logs) => {
        if (active) setResetLogs(logs);
      })
      .catch(() => {
        if (active) setResetLogsError(true);
      });
    return () => {
      active = false;
    };
  }, [displayCurrency]);

  const latestResetBoundary = useMemo(
    () =>
      resetLogs == null
        ? null
        : findLatestBudgetResetBoundary(
            resetLogs,
            budgetCategories.map((category) => category.id),
          ),
    [resetLogs, budgetCategories],
  );

  const suspiciousEntries = useMemo(() => {
    return filteredJournal.flatMap((entry) => {
      const isManagedPeriodEntry =
        latestResetBoundary == null ||
        isEntryAfterBudgetReset(entry, latestResetBoundary);
      const reasons = isManagedPeriodEntry
        ? getSuspiciousReasons(
            entry,
            accountMap,
            locale,
            excludedExpenseAllocationCategoryId,
          )
        : [];
      if (isManagedPeriodEntry) {
        const currency = displayCurrency || "JPY";
        const unallocatedIncome = getUnallocatedAllocatableIncomeAmount(
          entry,
          accountMap,
          currency,
        );
        if (unallocatedIncome > 0) {
          reasons.push(
            t("budgetUnallocatedIncomeIssue").replace(
              "{amount}",
              formatCurrency(unallocatedIncome, locale, currency),
            ),
          );
        }
        const excludedCashConsumption =
          getExcludedCashBudgetConsumptionAmount(
            entry,
            accountMap,
            currency,
            excludedExpenseAllocationCategoryId,
          );
        if (excludedCashConsumption > 0) {
          reasons.push(
            t("budgetExcludedCashConsumptionIssue").replace(
              "{amount}",
              formatCurrency(excludedCashConsumption, locale, currency),
            ),
          );
        }
      }
      const missingLoanFunding =
        resetLogs != null &&
        isLoanBudgetFundingMissing(
          entry,
          accountMap,
          latestResetBoundary,
          displayCurrency || "JPY",
        );
      if (missingLoanFunding) {
        reasons.push(t("budgetFundingMissingIssue"));
      }
      if (reasons.length === 0) return [];
      return [{ entry, reasons, missingLoanFunding }];
    });
  }, [
    filteredJournal,
    accountMap,
    locale,
    excludedExpenseAllocationCategoryId,
    latestResetBoundary,
    resetLogs,
    displayCurrency,
    t,
  ]);
  const preResetCardSettlements = useMemo(() => {
    if (resetLogs == null || latestResetBoundary == null) return [];
    const filteredIds = new Set(filteredJournal.map((entry) => entry.id));
    return findPreResetCreditCardSettlements(
      journal,
      accountMap,
      latestResetBoundary,
      displayCurrency || "JPY",
    ).filter((settlement) => filteredIds.has(settlement.entry.id));
  }, [
    accountMap,
    displayCurrency,
    filteredJournal,
    journal,
    latestResetBoundary,
    resetLogs,
  ]);
  const preResetCardSettlementTotal = useMemo(
    () =>
      preResetCardSettlements.reduce(
        (sum, settlement) => sum + settlement.amount,
        0,
      ),
    [preResetCardSettlements],
  );
  const neutralFundingEntries = useMemo(
    () =>
      filteredJournal.filter(
        (entry) =>
          resetLogs != null &&
          isEntryAfterBudgetReset(entry, latestResetBoundary) &&
          (entry.budget_funding_components?.length ?? 0) === 0 &&
          (entry.budget_funding?.allocations.length ?? 0) === 0 &&
          getLoanBudgetFundingPrincipal(
            entry,
            accountMap,
            displayCurrency || "JPY",
          ) > 0 &&
          Math.abs(
            getAllocatableAssetDelta(
              entry,
              accountMap,
              displayCurrency || "JPY",
            ),
          ) < 0.000_001,
      ),
    [
      filteredJournal,
      accountMap,
      displayCurrency,
      resetLogs,
      latestResetBoundary,
    ],
  );

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

  function handleEditJournal(entry: JournalEntry) {
    if (privacyMode) return;
    setEditingEntry(entry);
    openJournalEdit();
  }

  async function handleSaveJournalEdit(
    values: CreateJournalInput,
    meta?: import("../SimpleEntryForm").SimpleEntryMeta,
  ) {
    if (privacyMode || !editingEntry) return;
    if (meta?.depreciationUpdate) {
      await api.depreciation.update(
        meta.depreciationUpdate.scheduleId,
        meta.depreciationUpdate.input,
      );
    } else {
      await api.journal.update(editingEntry.id, {
        ...values,
        lines: values.lines.map((line) => ({
          currency: displayCurrency,
          ...line,
        })),
      });
    }
    showFeedback({ message: t("transactionSaved"), color: "teal" });
    closeJournalEdit();
    setEditingEntry(null);
    refresh();
    void refreshAllocatable();
    void refreshBudget();
  }

  return (
    <Stack gap="md">
      <Paper withBorder radius="md" p="md">
        <Group justify="flex-end" mb="md">
          <SegmentedControl
            size="xs"
            value={placementBasis}
            data={[
              {
                value: "today",
                label: t("assignableMoneyTodayLabel"),
              },
              {
                value: "total",
                label: t("assignableMoneyTotalLabel"),
              },
            ]}
            onChange={(value) => {
              const nextParams = new URLSearchParams(searchParams);
              nextParams.set("basis", value);
              setSearchParams(nextParams, { replace: true });
            }}
          />
        </Group>
        <BudgetPlacementTable
          accounts={placementAccounts}
          categorySummaries={placementSummary?.categories ?? []}
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

        <Group align="flex-end" gap="xs" wrap="wrap" mb="xs">
          <DatePickerInput
            type="range"
            value={dateRange}
            onChange={setDateRange}
            clearable
            placeholder={t("dateRangePlaceholder")}
            valueFormat="YYYY/MM/DD"
            w={240}
            size="sm"
          />
          <Button
            size="sm"
            variant="default"
            onClick={() =>
              setDateRange([
                new Date(now.getFullYear(), now.getMonth(), 1),
                now,
              ])
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
            onClick={() =>
              setDateRange([new Date(now.getFullYear(), 0, 1), now])
            }
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

        {resetLogsError ? (
          <Text size="xs" c="red" mb="sm">
            {t("budgetFundingResetLoadError")}
          </Text>
        ) : resetLogs != null ? (
          <Text size="xs" c="dimmed" mb="sm">
            {latestResetBoundary
              ? t("budgetFundingLastResetLabel").replace(
                  "{date}",
                  latestResetBoundary.date,
                )
              : t("budgetFundingNoResetBoundary")}
          </Text>
        ) : null}
        {preResetCardSettlements.length > 0 && (
          <Paper
            withBorder
            radius="sm"
            p="sm"
            mb="sm"
            bg="var(--mantine-color-blue-light)"
          >
            <Stack gap={4}>
              <Text size="sm" fw={600}>
                {t("budgetResetCardSettlementTitle")}
              </Text>
              <Text size="xs" c="dimmed">
                {t("budgetResetCardSettlementHint")
                  .replace(
                    "{amount}",
                    formatCurrency(
                      preResetCardSettlementTotal,
                      locale,
                      displayCurrency || "JPY",
                    ),
                  )
                  .replace(
                    "{count}",
                    String(preResetCardSettlements.length),
                  )}
              </Text>
              {preResetCardSettlements.map((settlement) => (
                <Group
                  key={settlement.entry.id}
                  justify="space-between"
                  wrap="nowrap"
                >
                  <Text size="xs">
                    {settlement.entry.date}・{settlement.entry.description}・
                    {formatCurrency(
                      settlement.amount,
                      locale,
                      displayCurrency || "JPY",
                    )}
                  </Text>
                  {!privacyMode && (
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      onClick={() => handleEditJournal(settlement.entry)}
                      aria-label={t("editLabel")}
                    >
                      <IconPencil size={14} />
                    </ActionIcon>
                  )}
                </Group>
              ))}
            </Stack>
          </Paper>
        )}
        {neutralFundingEntries.length > 0 && (
          <Stack gap={4} mb="sm">
            {neutralFundingEntries.slice(0, 5).map((entry) => (
              <Group key={entry.id} justify="space-between" wrap="nowrap">
                <Text size="xs" c="dimmed">
                  {entry.date}・{entry.description}:{" "}
                  {t("budgetFundingExcludedInfo")}
                </Text>
                {!privacyMode && (
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    onClick={() => handleEditJournal(entry)}
                    aria-label={t("editLabel")}
                  >
                    <IconPencil size={14} />
                  </ActionIcon>
                )}
              </Group>
            ))}
          </Stack>
        )}

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
                    {t("amountLabel")}
                  </Table.Th>
                  <Table.Th className="currency-cell">
                    {t("budgetCheckAllocated")}
                  </Table.Th>
                  <Table.Th>{t("budgetCheckIssue")}</Table.Th>
                  {!privacyMode && <Table.Th />}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {pagedEntries.map(
                  ({ entry, reasons, missingLoanFunding }) => {
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
                      totalExpense > 0
                        ? totalExpense
                        : totalIncome > 0
                          ? totalIncome
                          : missingLoanFunding
                            ? getLoanBudgetFundingPrincipal(
                                entry,
                                accountMap,
                                displayCurrency || "JPY",
                              )
                            : 0;
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
                        {!privacyMode && (
                          <Table.Td>
                            <ActionIcon
                              size="sm"
                              variant="subtle"
                              onClick={() => handleEditJournal(entry)}
                              aria-label={t("editLabel")}
                            >
                              <IconPencil size={14} />
                            </ActionIcon>
                          </Table.Td>
                        )}
                      </Table.Tr>
                    );
                  },
                )}
              </Table.Tbody>
            </Table>
          </Stack>
        )}
      </Paper>
      <JournalModal
        opened={journalEditOpened}
        accounts={accounts}
        editEntry={editingEntry ?? undefined}
        onClose={() => {
          closeJournalEdit();
          setEditingEntry(null);
        }}
        onSubmit={handleSaveJournalEdit}
      />
    </Stack>
  );
}
