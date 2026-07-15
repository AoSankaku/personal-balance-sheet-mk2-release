import {
  Accordion,
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  MultiSelect,
  NumberInput,
  Pagination,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  Skeleton,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useDisclosure } from "@mantine/hooks";
import {
  IconChartBar,
  IconChevronDown,
  IconChevronUp,
  IconList,
  IconPencil,
  IconSelector,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  BudgetAdjustmentLog,
  CreateJournalInput,
  JournalEntry,
} from "@balance-sheet/shared";
import { api } from "../api/client";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import { JournalTable } from "../components/JournalTable";
import { JournalModal } from "../components/JournalModal";
import { ConfirmModal } from "../components/ConfirmModal";
import { AppDataErrorAlert } from "../components/AppDataErrorAlert";
import { showFeedback } from "../lib/feedback";
import {
  accountDisplayName,
  categoryIndex,
} from "../lib/accountUtils";
import {
  renderAccountOption,
  toAccountOption,
  type AccountOption,
} from "../lib/accountSelect";
import { formatCurrency } from "../lib/numberFormat";
import { toDateStr } from "../lib/dateUtils";
import { getPageSize } from "../components/tt/ttUtils";
import {
  sortBudgetAdjustmentLogs,
  type BudgetAdjustmentLogSortKey,
} from "../lib/budgetAdjustmentLogSort";
import {
  budgetAdjustmentLogKey,
  buildBudgetAdjustmentLogBalanceMap,
} from "../lib/budgetAdjustmentLogBalances";
import { summarizeBudgetAdjustmentLogsByCategory } from "../lib/budgetAdjustmentCategorySummary";
import { refreshAfterBudgetAdjustment } from "../lib/budgetAdjustmentRefresh";
import { usePrivacy } from "../context/PrivacyContext";
import { completedDateRange } from "../lib/completedDateRange";
import classes from "./LedgerPage.module.css";

function normalizeCurrency(currency: string | null | undefined) {
  return (currency || "JPY").toUpperCase();
}

function isAmountLine(line: JournalEntry["lines"][number]) {
  return line.debit !== 0 || line.credit !== 0;
}

function entryHasCurrency(entry: JournalEntry, currency: string) {
  const targetCurrency = normalizeCurrency(currency);
  return entry.lines.some(
    (line) =>
      isAmountLine(line) && normalizeCurrency(line.currency) === targetCurrency,
  );
}

function entryAmountInCurrency(entry: JournalEntry, currency: string) {
  const targetCurrency = normalizeCurrency(currency);
  const lines = entry.lines.filter(
    (line) =>
      isAmountLine(line) && normalizeCurrency(line.currency) === targetCurrency,
  );
  const debit = lines.reduce((sum, line) => sum + line.debit, 0);
  if (debit > 0) return debit;
  return lines.reduce((sum, line) => sum + line.credit, 0);
}

function thisMonthRange(): [Date, Date] {
  const now = new Date();
  return [new Date(now.getFullYear(), now.getMonth(), 1), now];
}

function formatPageSummary(
  template: string,
  page: number,
  pageSize: number,
  total: number,
) {
  if (total === 0) {
    return template
      .replace("{from}", "0")
      .replace("{to}", "0")
      .replace("{total}", "0");
  }
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return template
    .replace("{from}", String(from))
    .replace("{to}", String(to))
    .replace("{total}", String(total));
}

function formatInputTimestamp(value: string) {
  return value.replace("T", " ").replace("Z", "").slice(0, 19);
}

function parseDateInputValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

export default function LedgerPage() {
  const { t, locale } = useLang();
  const { privacyMode } = usePrivacy();
  const {
    accounts,
    journal,
    budgetCategories,
    budgetSummary,
    displayCurrency,
    displayCurrencySymbol,
    loading,
    error,
    refresh,
    refreshBudget,
    allocatableToday,
    allocatableTotal,
    refreshAllocatable,
  } = useAppData();
  const [viewMode, setViewMode] = useState<"simple" | "double">("simple");
  const [tableView, setTableView] = useState<"journal" | "budget">("journal");
  const [journalPage, setJournalPage] = useState(1);
  const [journalPageSize, setJournalPageSize] = useState(() =>
    getPageSize("ledger:journalPageSize", 25),
  );
  const [journalRange, setJournalRange] =
    useState<[Date | null, Date | null]>(thisMonthRange);
  const [appliedJournalRange, setAppliedJournalRange] =
    useState<[Date | null, Date | null]>(thisMonthRange);
  const [filterDesc, setFilterDesc] = useState("");
  const [filterSource, setFilterSource] = useState<string | null>(null);
  const [filterAmountMin, setFilterAmountMin] = useState<number | string>("");
  const [filterAmountMax, setFilterAmountMax] = useState<number | string>("");
  const [filterAccountIds, setFilterAccountIds] = useState<string[]>([]);

  const accountFilterOptions = useMemo(() => {
    type AType = (typeof accounts)[0]["type"];
    const TYPE_ORDER: AType[] = [
      "asset",
      "liability",
      "equity",
      "income",
      "expense",
    ];
    const TYPE_LABEL: Record<AType, Parameters<typeof t>[0]> = {
      asset: "typeAsset",
      liability: "typeLiability",
      equity: "typeEquity",
      income: "typeIncome",
      expense: "typeExpense",
    };
    const groups: { group: string; items: AccountOption[] }[] = [];
    for (const type of TYPE_ORDER) {
      const items = accounts
        .filter((a) => a.type === type)
        .sort((a, b) => {
          const ai = categoryIndex(a.type, a.category, a.is_system ?? false);
          const bi = categoryIndex(b.type, b.category, b.is_system ?? false);
          return ai !== bi
            ? ai - bi
            : accountDisplayName(a, t).localeCompare(
                accountDisplayName(b, t),
                "ja",
              );
        })
        .map((a): AccountOption => toAccountOption(a, t));
      if (items.length > 0) {
        groups.push({ group: t(TYPE_LABEL[type]), items });
      }
    }
    return groups;
  }, [accounts, t]);
  const [filterCreatedRange, setFilterCreatedRange] = useState<
    [Date | null, Date | null]
  >([null, null]);
  const [showTimestamp, setShowTimestamp] = useState(false);
  const [adjustmentLogs, setAdjustmentLogs] = useState<BudgetAdjustmentLog[]>(
    [],
  );
  const [budgetLogRange, setBudgetLogRange] =
    useState<[Date | null, Date | null]>(thisMonthRange);
  const [budgetPage, setBudgetPage] = useState(1);
  const [budgetPageSize, setBudgetPageSize] = useState(() =>
    getPageSize("ledger:budgetPageSize", 25),
  );
  const [budgetSort, setBudgetSort] = useState<{
    key: BudgetAdjustmentLogSortKey;
    dir: "asc" | "desc";
  }>({ key: "date", dir: "desc" });
  const [budgetHistoryMode, setBudgetHistoryMode] = useState<
    "entries" | "categories"
  >("entries");
  const [expandedBudgetCategories, setExpandedBudgetCategories] = useState<
    string[]
  >([]);
  const [editingLog, setEditingLog] = useState<BudgetAdjustmentLog | null>(
    null,
  );
  const [editModalOpened, { open: openEditModal, close: closeEditModal }] =
    useDisclosure(false);
  const [editAmount, setEditAmount] = useState<number | string>(0);
  const [editDate, setEditDate] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [
    journalEditOpened,
    { open: openJournalEdit, close: closeJournalEdit },
  ] = useDisclosure(false);
  const [logJournalLoading, setLogJournalLoading] = useState<number | null>(
    null,
  );
  const [
    deleteLogConfirmOpened,
    { open: openDeleteLogConfirm, close: closeDeleteLogConfirm },
  ] = useDisclosure(false);
  const [logToDelete, setLogToDelete] = useState<BudgetAdjustmentLog | null>(
    null,
  );
  const [
    deleteChunkConfirmOpened,
    { open: openDeleteChunkConfirm, close: closeDeleteChunkConfirm },
  ] = useDisclosure(false);
  const [chunkToDelete, setChunkToDelete] = useState<{
    journal_entry_id: number;
    logs: BudgetAdjustmentLog[];
  } | null>(null);

  // Journal entry delete confirmation
  const [entryToDelete, setEntryToDelete] = useState<number | null>(null);
  const [deleteSuppressChecked, setDeleteSuppressChecked] = useState(false);
  const SUPPRESS_KEY = "ledger_delete_suppress_until";
  const [
    deleteJournalConfirmOpened,
    { open: openDeleteJournalConfirm, close: closeDeleteJournalConfirm },
  ] = useDisclosure(false);
  const selectedCurrency = normalizeCurrency(displayCurrency);
  const formatSelectedCurrency = (amount: number) =>
    formatCurrency(amount, locale, selectedCurrency, displayCurrencySymbol);

  useEffect(() => {
    setJournalPage(1);
  }, [selectedCurrency]);

  async function fetchLogs(range?: [Date | null, Date | null]) {
    const [from, to] = range ?? budgetLogRange;
    try {
      const logs = await api.budget.listAdjustmentLogs({
        from: from ? toDateStr(from) : undefined,
        to: to ? toDateStr(to) : undefined,
        currency: selectedCurrency,
      });
      setAdjustmentLogs(logs);
    } catch {
      setAdjustmentLogs([]);
    }
  }

  useEffect(() => {
    void fetchLogs(thisMonthRange());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCurrency]);

  async function doDeleteJournal(id: number) {
    if (privacyMode) return;
    await api.journal.delete(id);
    showFeedback({ message: t("transactionDeleted"), color: "orange" });
    refresh();
    void fetchLogs();
    void refreshAllocatable();
    void refreshBudget();
  }

  function handleDeleteJournal(id: number) {
    if (privacyMode) return;
    const suppressUntil = Number(sessionStorage.getItem(SUPPRESS_KEY) ?? 0);
    if (suppressUntil > Date.now()) {
      void doDeleteJournal(id);
      return;
    }
    setEntryToDelete(id);
    setDeleteSuppressChecked(false);
    openDeleteJournalConfirm();
  }

  function confirmDeleteJournal() {
    if (!entryToDelete) return;
    if (deleteSuppressChecked) {
      sessionStorage.setItem(SUPPRESS_KEY, String(Date.now() + 5 * 60 * 1000));
    }
    void doDeleteJournal(entryToDelete);
    setEntryToDelete(null);
    closeDeleteJournalConfirm();
  }

  function handleEditJournal(entry: JournalEntry) {
    if (privacyMode) return;
    setEditingEntry(entry);
    openJournalEdit();
  }

  async function handleSaveJournalEdit(
    values: CreateJournalInput,
    meta?: import("../components/SimpleEntryForm").SimpleEntryMeta,
  ) {
    if (privacyMode) return;
    if (!editingEntry) return;
    if (meta?.depreciationUpdate) {
      await api.depreciation.update(
        meta.depreciationUpdate.scheduleId,
        meta.depreciationUpdate.input,
      );
    } else {
      const input = {
        ...values,
        lines: values.lines.map((l) => ({ currency: displayCurrency, ...l })),
      };
      await api.journal.update(editingEntry.id, input);
    }
    showFeedback({ message: t("transactionSaved"), color: "teal" });
    closeJournalEdit();
    setEditingEntry(null);
    refresh();
    void fetchLogs();
    void refreshAllocatable();
    void refreshBudget();
  }

  async function handleEditLogJournalEntry(log: BudgetAdjustmentLog) {
    if (privacyMode) return;
    if (!log.journal_entry_id) return;
    setLogJournalLoading(log.id);
    try {
      const entry = await api.journal.get(log.journal_entry_id);
      setEditingEntry(entry);
      openJournalEdit();
    } finally {
      setLogJournalLoading(null);
    }
  }

  function handleEditLog(log: BudgetAdjustmentLog) {
    if (privacyMode) return;
    setEditingLog(log);
    setEditAmount(log.amount);
    setEditDate(log.date);
    setEditNote(log.note ?? "");
    openEditModal();
  }

  async function handleSaveEdit() {
    if (privacyMode) return;
    if (!editingLog) return;
    try {
      await api.budget.updateAdjustmentLog(editingLog.id, {
        amount:
          typeof editAmount === "number" ? editAmount : Number(editAmount),
        date: editDate,
        note: editNote,
      });
      showFeedback({ message: t("adjustmentLogUpdated"), color: "teal" });
      closeEditModal();
      void fetchLogs();
      void refreshAfterBudgetAdjustment({ refreshBudget, refreshAllocatable });
    } catch {
      showFeedback({ message: "更新に失敗しました", color: "red" });
    }
  }

  function handleDeleteLog(log: BudgetAdjustmentLog) {
    if (privacyMode) return;
    setLogToDelete(log);
    openDeleteLogConfirm();
  }

  async function confirmDeleteLog() {
    if (privacyMode) return;
    if (!logToDelete) return;
    try {
      await api.budget.deleteAdjustmentLog(logToDelete.id);
      showFeedback({
        message: t("adjustmentLogDeleted"),
        color: "orange",
      });
      void fetchLogs();
      void refreshAfterBudgetAdjustment({ refreshBudget, refreshAllocatable });
    } catch {
      showFeedback({ message: "削除に失敗しました", color: "red" });
    }
  }

  function handleDeleteChunk(log: BudgetAdjustmentLog) {
    if (privacyMode) return;
    if (!log.journal_entry_id) return;
    const linked = sortedLogs.filter(
      (l) => l.journal_entry_id === log.journal_entry_id,
    );
    setChunkToDelete({ journal_entry_id: log.journal_entry_id, logs: linked });
    openDeleteChunkConfirm();
  }

  async function confirmDeleteChunk() {
    if (privacyMode) return;
    if (!chunkToDelete) return;
    try {
      for (const l of chunkToDelete.logs) {
        await api.budget.deleteAdjustmentLog(l.id);
      }
      showFeedback({
        message: t("incomeAllocationDeleted"),
        color: "orange",
      });
      void fetchLogs();
      void refreshAfterBudgetAdjustment({ refreshBudget, refreshAllocatable });
    } catch {
      showFeedback({ message: "削除に失敗しました", color: "red" });
    }
  }

  const activeFilterCount = [
    filterDesc !== "",
    filterSource !== null,
    filterAmountMin !== "",
    filterAmountMax !== "",
    filterAccountIds.length > 0,
    filterCreatedRange[0] !== null || filterCreatedRange[1] !== null,
  ].filter(Boolean).length;

  const filteredJournal = useMemo(() => {
    const [from, to] = appliedJournalRange;
    return journal.filter((e) => {
      if (!entryHasCurrency(e, selectedCurrency)) return false;
      if (from && e.date < toDateStr(from)) return false;
      if (to && e.date > toDateStr(to)) return false;
      if (
        filterDesc &&
        !e.description.toLowerCase().includes(filterDesc.toLowerCase())
      )
        return false;
      if (filterSource && (e.source ?? "manual") !== filterSource) return false;
      if (filterAccountIds.length > 0) {
        const entryIds = e.lines.map((l) => String(l.account_id));
        if (!filterAccountIds.some((id) => entryIds.includes(id))) return false;
      }
      if (filterAmountMin !== "" || filterAmountMax !== "") {
        const amt = entryAmountInCurrency(e, selectedCurrency);
        if (filterAmountMin !== "" && amt < Number(filterAmountMin))
          return false;
        if (filterAmountMax !== "" && amt > Number(filterAmountMax))
          return false;
      }
      const [cFrom, cTo] = filterCreatedRange;
      if (cFrom || cTo) {
        const createdDate = e.created_at.slice(0, 10);
        if (cFrom && createdDate < toDateStr(cFrom)) return false;
        if (cTo && createdDate > toDateStr(cTo)) return false;
      }
      return true;
    });
  }, [
    journal,
    appliedJournalRange,
    filterDesc,
    filterSource,
    filterAccountIds,
    filterAmountMin,
    filterAmountMax,
    filterCreatedRange,
    selectedCurrency,
  ]);

  const outsideRangeCount = useMemo(() => {
    const [from, to] = appliedJournalRange;
    if (!from && !to) return 0;
    return journal.filter((e) => {
      if (!entryHasCurrency(e, selectedCurrency)) return false;
      // Must be outside the date range
      const outside =
        (from != null && e.date < toDateStr(from)) ||
        (to != null && e.date > toDateStr(to));
      if (!outside) return false;
      // Apply all non-date-range filters
      if (
        filterDesc &&
        !e.description.toLowerCase().includes(filterDesc.toLowerCase())
      )
        return false;
      if (filterSource && (e.source ?? "manual") !== filterSource) return false;
      if (filterAccountIds.length > 0) {
        const entryAcctIds = e.lines.map((l) => String(l.account_id));
        if (!filterAccountIds.some((id) => entryAcctIds.includes(id)))
          return false;
      }
      if (filterAmountMin !== "" || filterAmountMax !== "") {
        const amt = entryAmountInCurrency(e, selectedCurrency);
        if (filterAmountMin !== "" && amt < Number(filterAmountMin))
          return false;
        if (filterAmountMax !== "" && amt > Number(filterAmountMax))
          return false;
      }
      const [cFrom, cTo] = filterCreatedRange;
      if (cFrom || cTo) {
        const createdDate = e.created_at.slice(0, 10);
        if (cFrom && createdDate < toDateStr(cFrom)) return false;
        if (cTo && createdDate > toDateStr(cTo)) return false;
      }
      return true;
    }).length;
  }, [
    journal,
    appliedJournalRange,
    selectedCurrency,
    filterDesc,
    filterSource,
    filterAccountIds,
    filterAmountMin,
    filterAmountMax,
    filterCreatedRange,
  ]);

  const sortedLogs = useMemo(() => {
    return sortBudgetAdjustmentLogs(
      adjustmentLogs,
      budgetSort,
      budgetCategories.map((category) => category.id),
    );
  }, [adjustmentLogs, budgetSort, budgetCategories]);
  const budgetLogBalanceByKey = useMemo(
    () => buildBudgetAdjustmentLogBalanceMap(adjustmentLogs),
    [adjustmentLogs],
  );
  const budgetAvailableByCategoryId = useMemo(
    () =>
      new Map(
        (budgetSummary?.categories ?? []).map(
          (summary) => [summary.category.id, summary.available] as const,
        ),
      ),
    [budgetSummary],
  );
  const categorySummaries = useMemo(
    () =>
      summarizeBudgetAdjustmentLogsByCategory(
        adjustmentLogs,
        budgetCategories.map((category) => category.id),
        budgetAvailableByCategoryId,
      ),
    [adjustmentLogs, budgetCategories, budgetAvailableByCategoryId],
  );

  const journalPageCount = Math.max(
    1,
    Math.ceil(filteredJournal.length / journalPageSize),
  );
  const pagedJournal = useMemo(
    () =>
      filteredJournal.slice(
        (journalPage - 1) * journalPageSize,
        journalPage * journalPageSize,
      ),
    [filteredJournal, journalPage, journalPageSize],
  );
  const budgetPageCount = Math.max(
    1,
    Math.ceil(sortedLogs.length / budgetPageSize),
  );
  const pagedLogs = useMemo(
    () =>
      sortedLogs.slice(
        (budgetPage - 1) * budgetPageSize,
        budgetPage * budgetPageSize,
      ),
    [sortedLogs, budgetPage, budgetPageSize],
  );

  useEffect(() => {
    if (journalPage > journalPageCount) setJournalPage(journalPageCount);
  }, [journalPage, journalPageCount]);

  useEffect(() => {
    if (budgetPage > budgetPageCount) setBudgetPage(budgetPageCount);
  }, [budgetPage, budgetPageCount]);

  function toggleSort(key: BudgetAdjustmentLogSortKey) {
    setBudgetSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "desc" },
    );
  }

  function SortIcon({ col }: { col: BudgetAdjustmentLogSortKey }) {
    if (budgetSort.key !== col)
      return <IconSelector size={12} style={{ opacity: 0.4 }} />;
    return budgetSort.dir === "asc" ? (
      <IconChevronUp size={12} />
    ) : (
      <IconChevronDown size={12} />
    );
  }

  function renderBudgetLogTypeBadge(log: BudgetAdjustmentLog) {
    if (log.type === "income") {
      return (
        <Badge color="teal" variant="light" size="sm">
          {t("budgetHistorySourceIncome")}
        </Badge>
      );
    }
    if (log.type === "transfer") {
      return (
        <Badge color="cyan" variant="light" size="sm">
          {t("budgetHistorySourceTransfer")}
        </Badge>
      );
    }
    if (log.type === "simple") {
      return (
        <Badge color="blue" variant="light" size="sm">
          {t("budgetHistorySourceSimple")}
        </Badge>
      );
    }
    if (log.type === "multiline") {
      return (
        <Badge color="violet" variant="light" size="sm">
          {t("budgetHistorySourceMultiline")}
        </Badge>
      );
    }
    if (log.type === "reset") {
      return (
        <Badge color="red" variant="light" size="sm">
          {t("budgetHistorySourceReset")}
        </Badge>
      );
    }
    return (
      <Badge color="gray" variant="light" size="sm">
        {t("budgetHistorySourceManual")}
      </Badge>
    );
  }

  function renderBudgetLogActions(log: BudgetAdjustmentLog) {
    if (privacyMode) return null;
    return (
      <Group gap={4} wrap="nowrap">
        {(log.type === "manual" || log.type === "reset") && (
          <ActionIcon
            size="sm"
            variant="subtle"
            onClick={() => handleEditLog(log)}
            aria-label={t("editLabel")}
          >
            <IconPencil size={14} />
          </ActionIcon>
        )}
        {(log.type === "income" ||
          log.type === "transfer" ||
          log.type === "simple" ||
          log.type === "multiline") &&
          log.journal_entry_id && (
            <ActionIcon
              size="sm"
              variant="subtle"
              loading={logJournalLoading === log.id}
              onClick={() => void handleEditLogJournalEntry(log)}
              aria-label={t("editLabel")}
            >
              <IconPencil size={14} />
            </ActionIcon>
          )}
        {log.type === "income" && !log.journal_entry_id && (
          <ActionIcon
            size="sm"
            variant="subtle"
            onClick={() => handleEditLog(log)}
            aria-label={t("editLabel")}
          >
            <IconPencil size={14} />
          </ActionIcon>
        )}
        {(log.type === "manual" || log.type === "reset") && (
          <ActionIcon
            size="sm"
            variant="subtle"
            color="red"
            onClick={() => void handleDeleteLog(log)}
            aria-label={t("deleteEntry")}
          >
            <IconTrash size={14} />
          </ActionIcon>
        )}
        {(log.type === "income" || log.type === "transfer") &&
          log.journal_entry_id && (
          <ActionIcon
            size="sm"
            variant="subtle"
            color="red"
            onClick={() => handleDeleteChunk(log)}
            aria-label={t("deleteEntry")}
          >
            <IconTrash size={14} />
          </ActionIcon>
        )}
        {log.type === "income" && !log.journal_entry_id && (
          <ActionIcon
            size="sm"
            variant="subtle"
            color="red"
            onClick={() => void handleDeleteLog(log)}
            aria-label={t("deleteEntry")}
          >
            <IconTrash size={14} />
          </ActionIcon>
        )}
      </Group>
    );
  }

  const filteredPL = useMemo(() => {
    const accountTypeMap = new Map(accounts.map((a) => [a.id, a.type]));
    let income = 0;
    let expense = 0;
    for (const entry of filteredJournal) {
      for (const line of entry.lines) {
        if (normalizeCurrency(line.currency) !== selectedCurrency) continue;
        const type = accountTypeMap.get(line.account_id);
        if (type === "income") income += line.credit;
        else if (type === "expense") expense += line.debit;
      }
    }
    return { income, expense, net_income: income - expense };
  }, [filteredJournal, accounts, selectedCurrency]);

  if (loading) {
    return (
      <Stack gap="lg">
        <Skeleton height={42} radius="sm" />
        <Group justify="space-between">
          <Skeleton height={32} width={240} radius="sm" />
          <Skeleton height={36} width={160} radius="sm" />
        </Group>
        <Skeleton height={36} radius="md" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} height={34} radius="sm" />
        ))}
      </Stack>
    );
  }

  if (error) {
    return <AppDataErrorAlert error={error} />;
  }

  return (
    <Tabs
      value={tableView}
      onChange={(v) => setTableView(v as "journal" | "budget")}
    >
      <Tabs.List grow>
        <Tabs.Tab value="journal" leftSection={<IconList size={16} />}>
          {t("budgetHistoryJournalTab")}
        </Tabs.Tab>
        <Tabs.Tab value="budget" leftSection={<IconChartBar size={16} />}>
          {t("budgetHistoryBudgetTab")}
        </Tabs.Tab>
      </Tabs.List>

      {/* Journal tab */}
      <Tabs.Panel value="journal" pt="md">
        <Stack gap="lg">
          {/* Toolbar */}
          <Group justify="space-between" align="flex-end" wrap="wrap" gap="xs">
            <div className={classes.dateRangeControls}>
              <DatePickerInput
                type="range"
                value={journalRange}
                onChange={(value) => {
                  setJournalRange(value);
                  setAppliedJournalRange((current) => {
                    return completedDateRange(current, value);
                  });
                  if ((value[0] === null) === (value[1] === null))
                    setJournalPage(1);
                }}
                clearable
                placeholder={t("dateRangePlaceholder")}
                valueFormat="YYYY/MM/DD"
                className={classes.dateRangePicker}
                size="sm"
              />
              <Button
                className={classes.dateRangeButton}
                size="sm"
                variant="default"
                onClick={() => {
                  setJournalRange([null, null]);
                  setAppliedJournalRange([null, null]);
                  setJournalPage(1);
                }}
              >
                {t("filterAll")}
              </Button>
              <Button
                className={classes.dateRangeButton}
                size="sm"
                variant="default"
                onClick={() => {
                  const range = thisMonthRange();
                  setJournalRange(range);
                  setAppliedJournalRange(range);
                  setJournalPage(1);
                }}
              >
                {t("filterThisMonth")}
              </Button>
            </div>
            <Group gap="xs" align="center">
              <Checkbox
                size="xs"
                label={t("showInputTimestamp")}
                checked={showTimestamp}
                onChange={(e) => setShowTimestamp(e.currentTarget.checked)}
              />
              <SegmentedControl
                size="xs"
                data={[
                  { value: "simple", label: t("viewSimple") },
                  { value: "double", label: t("viewDoubleEntry") },
                ]}
                value={viewMode}
                onChange={(v) => setViewMode(v as "simple" | "double")}
              />
              {!privacyMode && (
                <Button component={Link} to="/input" variant="default" size="sm">
                  {t("addTransactionBtn")}
                </Button>
              )}
            </Group>
          </Group>

          {/* Filter accordion */}
          <Accordion
            variant="contained"
            radius="md"
            styles={{ label: { paddingTop: 8, paddingBottom: 8 } }}
          >
            <Accordion.Item value="filters">
              <Accordion.Control>
                <Group gap="xs">
                  <Text size="sm" fw={500}>
                    {t("filterPanel")}
                  </Text>
                  {activeFilterCount > 0 && (
                    <Badge size="xs" color="blue" variant="filled">
                      {t("filterActiveCount").replace(
                        "{n}",
                        String(activeFilterCount),
                      )}
                    </Badge>
                  )}
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap="sm">
                  <Group align="flex-end" gap="sm" wrap="wrap">
                    <TextInput
                      label={t("filterDescriptionLabel")}
                      placeholder={t("filterDescriptionPlaceholder")}
                      value={filterDesc}
                      onChange={(e) => {
                        setFilterDesc(e.currentTarget.value);
                        setJournalPage(1);
                      }}
                      size="xs"
                      style={{ flex: "1 1 160px" }}
                    />
                    <Select
                      label={t("filterSourceLabel")}
                      placeholder={t("filterSourceAll")}
                      value={filterSource}
                      onChange={(v) => {
                        setFilterSource(v);
                        setJournalPage(1);
                      }}
                      clearable
                      data={[
                        {
                          value: "manual",
                          label: t("journalSourceManual"),
                        },
                        {
                          value: "csv_import",
                          label: t("journalSourceCsvImport"),
                        },
                      ]}
                      size="xs"
                      style={{ flex: "1 1 120px", maxWidth: 180 }}
                    />
                    <MultiSelect
                      label={t("filterAccountLabel")}
                      placeholder={t("filterAccountPlaceholder")}
                      value={filterAccountIds}
                      onChange={(v) => {
                        setFilterAccountIds(v);
                        setJournalPage(1);
                      }}
                      data={accountFilterOptions}
                      renderOption={renderAccountOption}
                      searchable
                      clearable
                      size="xs"
                      style={{ flex: "1 1 160px" }}
                    />
                  </Group>
                  <Group align="flex-end" gap="sm" wrap="wrap">
                    <NumberInput
                      label={t("filterAmountLabel")}
                      placeholder={t("filterAmountMin")}
                      value={filterAmountMin}
                      onChange={(v) => {
                        setFilterAmountMin(v);
                        setJournalPage(1);
                      }}
                      min={0}
                      allowDecimal={false}
                      hideControls
                      size="xs"
                      style={{ flex: "1 1 100px", maxWidth: 140 }}
                    />
                    <Text size="xs" c="dimmed" pb={4}>
                      〜
                    </Text>
                    <NumberInput
                      label=" "
                      placeholder={t("filterAmountMax")}
                      value={filterAmountMax}
                      onChange={(v) => {
                        setFilterAmountMax(v);
                        setJournalPage(1);
                      }}
                      min={0}
                      allowDecimal={false}
                      hideControls
                      size="xs"
                      style={{ flex: "1 1 100px", maxWidth: 140 }}
                    />
                  </Group>
                  <Group align="flex-end" gap="sm" wrap="wrap">
                    <DatePickerInput
                      type="range"
                      label={t("filterCreatedRangeLabel")}
                      value={filterCreatedRange}
                      onChange={(v) => {
                        setFilterCreatedRange(v);
                        setJournalPage(1);
                      }}
                      clearable
                      valueFormat="YYYY/MM/DD"
                      size="xs"
                      style={{ flex: "1 1 200px", maxWidth: 280 }}
                    />
                    {activeFilterCount > 0 && (
                      <Button
                        size="xs"
                        variant="subtle"
                        color="gray"
                        onClick={() => {
                          setFilterDesc("");
                          setFilterSource(null);
                          setFilterAmountMin("");
                          setFilterAmountMax("");
                          setFilterAccountIds([]);
                          setFilterCreatedRange([null, null]);
                          setJournalPage(1);
                        }}
                      >
                        {t("filterClearAll")}
                      </Button>
                    )}
                  </Group>
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>

          {/* P&L summary — compact inline row */}
          <Paper withBorder px="md" py="xs" radius="md">
            <Group gap="xl" justify="center" wrap="wrap">
              <Group gap={6}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  {t("income")}
                </Text>
                <Text size="sm" fw={700} c="teal">
                  {formatSelectedCurrency(filteredPL.income)}
                </Text>
              </Group>
              <Group gap={6}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  {t("expenses")}
                </Text>
                <Text size="sm" fw={700} c="red">
                  {formatSelectedCurrency(filteredPL.expense)}
                </Text>
              </Group>
              <Group gap={6}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  {t("netIncome")}
                </Text>
                <Text
                  size="sm"
                  fw={700}
                  c={filteredPL.net_income >= 0 ? "blue" : "red"}
                >
                  {filteredPL.net_income >= 0 ? "+" : ""}
                  {formatSelectedCurrency(filteredPL.net_income)}
                </Text>
              </Group>
            </Group>
          </Paper>

          <Group justify="space-between" align="flex-end" wrap="wrap" gap="xs">
            <Text size="sm" c="dimmed">
              {formatPageSummary(
                t("pageSummary"),
                journalPage,
                journalPageSize,
                filteredJournal.length,
              )}
            </Text>
            <Group gap="xs" align="flex-end" wrap="wrap">
              <Select
                label={t("rowsPerPage")}
                size="xs"
                w={120}
                data={["10", "25", "50", "100"]}
                value={String(journalPageSize)}
                onChange={(value) => {
                  const next = Number(value ?? 25);
                  setJournalPageSize(next);
                  setJournalPage(1);
                  localStorage.setItem("ledger:journalPageSize", String(next));
                }}
              />
              <Pagination
                total={journalPageCount}
                value={journalPage}
                onChange={setJournalPage}
                size="sm"
              />
            </Group>
          </Group>

          <JournalTable
            entries={pagedJournal}
            accounts={accounts}
            onDelete={handleDeleteJournal}
            onEdit={privacyMode ? undefined : handleEditJournal}
            readOnly={privacyMode}
            view={viewMode}
            showTimestamp={showTimestamp}
            displayCurrency={selectedCurrency}
            displayCurrencySymbol={displayCurrencySymbol}
          />
          <Group justify="space-between" align="center" wrap="wrap" gap="xs">
            {journalPage === journalPageCount && outsideRangeCount > 0 ? (
              <Group gap="xs">
                <Text size="sm" c="dimmed">
                  {t("outsideDateRangeMsg").replace(
                    "{n}",
                    String(outsideRangeCount),
                  )}
                </Text>
                <Anchor
                  size="sm"
                  onClick={() => {
                    setJournalRange([null, null]);
                    setAppliedJournalRange([null, null]);
                    setJournalPage(1);
                  }}
                >
                  {t("clearDateFilter")}
                </Anchor>
              </Group>
            ) : (
              <div />
            )}
            <Pagination
              total={journalPageCount}
              value={journalPage}
              onChange={setJournalPage}
              size="sm"
            />
          </Group>
        </Stack>
      </Tabs.Panel>

      {/* Budget history tab */}
      <Tabs.Panel value="budget" pt="md">
        <Stack gap="lg">
          <Paper withBorder px="md" py="xs" radius="md">
            <Group gap={6} align="center">
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                {t("assignableMoneyLabel")}
              </Text>
              <Text
                size="sm"
                fw={700}
                c={allocatableToday >= 0 ? "teal" : "red"}
              >
                {formatSelectedCurrency(allocatableToday)}
              </Text>
              <Text size="xs" c="dimmed">
                {t("assignableMoneyTodayLabel")}
              </Text>
              <Text size="sm" c={allocatableTotal >= 0 ? "dimmed" : "red"}>
                {formatSelectedCurrency(allocatableTotal)}
              </Text>
              <Text size="xs" c="dimmed">
                {t("assignableMoneyTotalLabel")}
              </Text>
            </Group>
          </Paper>
          <Group align="flex-end" gap="xs" wrap="wrap">
            <div className={classes.dateRangeControls}>
              <DatePickerInput
                type="range"
                placeholder={t("dateRangePlaceholder")}
                value={budgetLogRange}
                onChange={(v) => {
                  setBudgetLogRange(v);
                  setBudgetPage(1);
                  void fetchLogs(v);
                }}
                clearable
                valueFormat="YYYY/MM/DD"
                size="sm"
                className={classes.dateRangePicker}
              />
              <Button
                className={classes.dateRangeButton}
                size="sm"
                variant="default"
                onClick={() => {
                  const range: [Date | null, Date | null] = [null, null];
                  setBudgetLogRange(range);
                  setBudgetPage(1);
                  void fetchLogs(range);
                }}
              >
                {t("filterAll")}
              </Button>
              <Button
                className={classes.dateRangeButton}
                size="sm"
                variant="default"
                onClick={() => {
                  const range = thisMonthRange();
                  setBudgetLogRange(range);
                  setBudgetPage(1);
                  void fetchLogs(range);
                }}
              >
                {t("filterThisMonth")}
              </Button>
            </div>
            <SegmentedControl
              size="sm"
              value={budgetHistoryMode}
              onChange={(value) =>
                setBudgetHistoryMode(value as "entries" | "categories")
              }
              data={[
                { value: "entries", label: t("budgetHistoryModeEntries") },
                {
                  value: "categories",
                  label: t("budgetHistoryModeCategories"),
                },
              ]}
            />
          </Group>
          {sortedLogs.length === 0 ? (
            <Text size="sm" c="dimmed">
              {t("noBudgetHistory")}
            </Text>
          ) : budgetHistoryMode === "entries" ? (
            <Stack gap="xs">
              <Group
                justify="space-between"
                align="flex-end"
                wrap="wrap"
                gap="xs"
              >
                <Text size="sm" c="dimmed">
                  {formatPageSummary(
                    t("pageSummary"),
                    budgetPage,
                    budgetPageSize,
                    sortedLogs.length,
                  )}
                </Text>
                <Group gap="xs" align="flex-end" wrap="wrap">
                  <Select
                    label={t("rowsPerPage")}
                    size="xs"
                    w={120}
                    data={["10", "25", "50", "100"]}
                    value={String(budgetPageSize)}
                    onChange={(value) => {
                      const next = Number(value ?? 25);
                      setBudgetPageSize(next);
                      setBudgetPage(1);
                      localStorage.setItem(
                        "ledger:budgetPageSize",
                        String(next),
                      );
                    }}
                  />
                  <Pagination
                    total={budgetPageCount}
                    value={budgetPage}
                    onChange={setBudgetPage}
                    size="sm"
                  />
                </Group>
              </Group>
              <Paper withBorder radius="md">
                <ScrollArea>
                  <Table striped highlightOnHover style={{ minWidth: 780 }}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>
                          <UnstyledButton onClick={() => toggleSort("date")}>
                            <Group gap={4} wrap="nowrap">
                              {t("thDate")}
                              <SortIcon col="date" />
                            </Group>
                          </UnstyledButton>
                        </Table.Th>
                        <Table.Th>
                          <UnstyledButton onClick={() => toggleSort("type")}>
                            <Group gap={4} wrap="nowrap">
                              {t("budgetHistoryTypeCol")}
                              <SortIcon col="type" />
                            </Group>
                          </UnstyledButton>
                        </Table.Th>
                        <Table.Th>
                          <UnstyledButton
                            onClick={() => toggleSort("category")}
                          >
                            <Group gap={4} wrap="nowrap">
                              {t("budgetCategoryLabel")}
                              <SortIcon col="category" />
                            </Group>
                          </UnstyledButton>
                        </Table.Th>
                        <Table.Th className="currency-cell">
                          <UnstyledButton onClick={() => toggleSort("amount")}>
                            <Group gap={4} wrap="nowrap" justify="flex-end">
                              {t("budgetHistoryAmountCol")}
                              <SortIcon col="amount" />
                            </Group>
                          </UnstyledButton>
                        </Table.Th>
                        <Table.Th className="currency-cell">
                          {t("budgetHistoryAdjustedTotal")}
                        </Table.Th>
                        <Table.Th>{t("budgetHistoryNoteCol")}</Table.Th>
                        <Table.Th />
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {pagedLogs.map((log) => (
                        <Table.Tr key={`${log.type}-${log.id}`}>
                          <Table.Td>{log.date}</Table.Td>
                          <Table.Td>{renderBudgetLogTypeBadge(log)}</Table.Td>
                          <Table.Td>
                            {log.budget_category_name ??
                              `#${log.budget_category_id}`}
                          </Table.Td>
                          <Table.Td className="currency-cell">
                            {(() => {
                              const displayAmount = log.amount;
                              return (
                                <Text
                                  size="sm"
                                  fw={600}
                                  c={displayAmount >= 0 ? "teal" : "red"}
                                >
                                  {displayAmount >= 0 ? "+" : ""}
                                  {formatSelectedCurrency(displayAmount)}
                                </Text>
                              );
                            })()}
                          </Table.Td>
                          <Table.Td className="currency-cell">
                            {(() => {
                              const balanceAfter =
                                budgetLogBalanceByKey.get(
                                  budgetAdjustmentLogKey(log),
                                ) ?? log.amount;
                              return (
                                <Text
                                  size="sm"
                                  fw={700}
                                  c={balanceAfter >= 0 ? "teal" : "red"}
                                >
                                  {balanceAfter >= 0 ? "+" : ""}
                                  {formatSelectedCurrency(balanceAfter)}
                                </Text>
                              );
                            })()}
                          </Table.Td>
                          <Table.Td>
                            {log.note ? (
                              <Text size="sm" c="dimmed">
                                {log.note}
                              </Text>
                            ) : (
                              <Text size="sm" c="dimmed">
                                -
                              </Text>
                            )}
                          </Table.Td>
                          <Table.Td>{renderBudgetLogActions(log)}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              </Paper>
            </Stack>
          ) : (
            <Stack gap="xs">
              <Group justify="space-between" align="center" wrap="wrap">
                <Text size="sm" c="dimmed">
                  {t("budgetHistoryCategorySummaryCount").replace(
                    "{count}",
                    String(categorySummaries.length),
                  )}
                </Text>
              </Group>
              <Paper withBorder radius="md">
                <Accordion
                  multiple
                  value={expandedBudgetCategories}
                  onChange={setExpandedBudgetCategories}
                >
                  {categorySummaries.map((summary) => {
                    const summaryValue = String(summary.budget_category_id);
                    const isExpanded =
                      expandedBudgetCategories.includes(summaryValue);
                    return (
                      <Accordion.Item
                        key={summary.budget_category_id}
                        value={summaryValue}
                      >
                        <Accordion.Control>
                          <Group justify="space-between" gap="sm" wrap="wrap">
                            <Stack gap={2} style={{ flex: "1 1 180px" }}>
                              <Text size="sm" fw={700}>
                                {summary.budget_category_name ??
                                  `#${summary.budget_category_id}`}
                              </Text>
                              <Group gap="xs">
                                <Badge size="sm" variant="light">
                                  {t("budgetHistoryEntryCount").replace(
                                    "{count}",
                                    String(summary.entry_count),
                                  )}
                                </Badge>
                                <Text size="xs" c="dimmed">
                                  {t("budgetHistoryLatestInput")}:{" "}
                                  {formatInputTimestamp(
                                    summary.latest_log.created_at,
                                  )}
                                </Text>
                              </Group>
                            </Stack>
                            <Stack gap={2} align="flex-end">
                              <Text
                                size="xs"
                                c="dimmed"
                                tt="uppercase"
                                fw={600}
                              >
                                {t("budgetHistoryAdjustedTotal")}
                              </Text>
                              <Text
                                size="lg"
                                fw={800}
                                c={
                                  summary.adjusted_total >= 0 ? "teal" : "red"
                                }
                              >
                                {summary.adjusted_total >= 0 ? "+" : ""}
                                {formatSelectedCurrency(summary.adjusted_total)}
                              </Text>
                            </Stack>
                          </Group>
                        </Accordion.Control>
                        <Accordion.Panel>
                          {isExpanded && (
                            <ScrollArea>
                              <Table
                                striped
                                highlightOnHover
                                style={{ minWidth: 720 }}
                              >
                                <Table.Thead>
                                  <Table.Tr>
                                    <Table.Th>{t("thDate")}</Table.Th>
                                    <Table.Th>
                                      {t("budgetHistoryInputTimestamp")}
                                    </Table.Th>
                                    <Table.Th>
                                      {t("budgetHistoryTypeCol")}
                                    </Table.Th>
                                    <Table.Th className="currency-cell">
                                      {t("budgetHistoryAmountCol")}
                                    </Table.Th>
                                    <Table.Th className="currency-cell">
                                      {t("budgetHistoryPeriodRunningTotal")}
                                    </Table.Th>
                                    <Table.Th>
                                      {t("budgetHistoryNoteCol")}
                                    </Table.Th>
                                    <Table.Th />
                                  </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                  {summary.log_balances.map(
                                    ({ log, adjusted_total_after }) => (
                                      <Table.Tr key={`${log.type}-${log.id}`}>
                                        <Table.Td>{log.date}</Table.Td>
                                        <Table.Td>
                                          <Text size="sm" c="dimmed">
                                            {formatInputTimestamp(
                                              log.created_at,
                                            )}
                                          </Text>
                                        </Table.Td>
                                        <Table.Td>
                                          {renderBudgetLogTypeBadge(log)}
                                        </Table.Td>
                                        <Table.Td className="currency-cell">
                                          <Text
                                            size="sm"
                                            fw={600}
                                            c={
                                              log.amount >= 0 ? "teal" : "red"
                                            }
                                          >
                                            {log.amount >= 0 ? "+" : ""}
                                            {formatSelectedCurrency(log.amount)}
                                          </Text>
                                        </Table.Td>
                                        <Table.Td className="currency-cell">
                                          <Text
                                            size="sm"
                                            fw={700}
                                            c={
                                              adjusted_total_after >= 0
                                                ? "teal"
                                                : "red"
                                            }
                                          >
                                            {adjusted_total_after >= 0
                                              ? "+"
                                              : ""}
                                            {formatSelectedCurrency(
                                              adjusted_total_after,
                                            )}
                                          </Text>
                                        </Table.Td>
                                        <Table.Td>
                                          {log.note ? (
                                            <Text size="sm" c="dimmed">
                                              {log.note}
                                            </Text>
                                          ) : (
                                            <Text size="sm" c="dimmed">
                                              -
                                            </Text>
                                          )}
                                        </Table.Td>
                                        <Table.Td>
                                          {renderBudgetLogActions(log)}
                                        </Table.Td>
                                      </Table.Tr>
                                    ),
                                  )}
                                </Table.Tbody>
                              </Table>
                            </ScrollArea>
                          )}
                        </Accordion.Panel>
                      </Accordion.Item>
                    );
                  })}
                </Accordion>
              </Paper>
            </Stack>
          )}
        </Stack>
      </Tabs.Panel>

      {/* Edit journal entry modal */}
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

      {/* Edit adjustment log modal */}
      <Modal
        opened={editModalOpened}
        onClose={closeEditModal}
        title={t("editLabel")}
        size="sm"
      >
        <Stack gap="sm">
          <NumberInput
            label={t("budgetHistoryAmountCol")}
            value={editAmount}
            onChange={setEditAmount}
            allowDecimal={false}
          />
          <DatePickerInput
            label={t("thDate")}
            value={parseDateInputValue(editDate)}
            onChange={(value) => setEditDate(value ? toDateStr(value) : "")}
            valueFormat="YYYY-MM-DD"
            clearable={false}
          />
          <Textarea
            label={t("budgetHistoryNoteCol")}
            value={editNote}
            onChange={(event) => setEditNote(event.currentTarget.value)}
            autosize
            minRows={2}
          />
          <Group justify="flex-end">
            <Button variant="default" size="sm" onClick={closeEditModal}>
              {t("cancel")}
            </Button>
            <Button size="sm" onClick={() => void handleSaveEdit()}>
              {t("saveBudgetCategory")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <ConfirmModal
        opened={deleteLogConfirmOpened}
        onClose={closeDeleteLogConfirm}
        onConfirm={() => void confirmDeleteLog()}
        title={t("deleteAdjustmentLog")}
        message={t("deleteAdjustmentLogConfirm")}
      />

      <ConfirmModal
        opened={deleteChunkConfirmOpened}
        onClose={closeDeleteChunkConfirm}
        onConfirm={() => void confirmDeleteChunk()}
        title={t("deleteIncomeChunk")}
        message={t("deleteIncomeChunkConfirm")
          .replace("{count}", String(chunkToDelete?.logs.length ?? 0))
          .replace(
            "{total}",
            (
              chunkToDelete?.logs.reduce((s, l) => s + l.amount, 0) ?? 0
            ).toLocaleString(),
          )}
        confirmColor="red"
      />

      {/* Journal entry delete confirmation modal */}
      <Modal
        opened={deleteJournalConfirmOpened}
        onClose={closeDeleteJournalConfirm}
        title={t("deleteJournalConfirm")}
        size="sm"
        centered
      >
        <Stack gap="sm">
          <Text size="sm">{t("deleteJournalConfirmMsg")}</Text>
          <Checkbox
            label={t("suppressDeleteWarning5min")}
            checked={deleteSuppressChecked}
            onChange={(e) => setDeleteSuppressChecked(e.currentTarget.checked)}
          />
          <Group justify="flex-end" mt="xs">
            <Button
              variant="default"
              size="sm"
              onClick={closeDeleteJournalConfirm}
            >
              {t("cancel")}
            </Button>
            <Button color="red" size="sm" onClick={confirmDeleteJournal}>
              {t("deleteEntry")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Tabs>
  );
}
