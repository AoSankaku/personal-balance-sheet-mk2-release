import {
  Accordion,
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import {
  IconCircleCheck,
  IconCopyPlus,
  IconEdit,
  IconTrash,
} from "@tabler/icons-react";
import { useDisclosure } from "@mantine/hooks";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  diffCreditCardMonths,
  statementMonthForTransactionDate,
  statementMonthWithTransactionOffset,
} from "@balance-sheet/shared";
import type {
  ActualBalanceSnapshot,
  CreateJournalInput,
  CreditCardSettings,
  CreditCardStateEntry,
  JournalEntry,
} from "@balance-sheet/shared";
import { api } from "../../api/client";
import { JournalModal } from "../JournalModal";
import { useLang } from "../../i18n";
import { useAppData } from "../../context/AppDataContext";
import { showFeedback } from "../../lib/feedback";
import { getEffectiveSymbol } from "../../lib/currencyUtils";
import { formatCurrency, formatJPY } from "../../lib/numberFormat";
import { toDateStr } from "../../lib/dateUtils";
import { hasMaterialBalanceDifference } from "../../lib/balanceReconciliation";
import { toAccountSelectOption } from "../../lib/accountUtils";
import {
  buildTrialBalanceCarryForward,
  type TrialBalanceCarryForwardDraft,
} from "../../lib/trialBalanceCarryForward";
import {
  useAccountDisplayName,
  type DeviationRow,
  type JournalPreviewEntry,
  type MatchingJournalEntry,
  type WorksheetRow,
  getCreditCardWindowMeta,
  cardBookChangeInPeriod,
  cardWithdrawalAmountForStatementMonth,
} from "./ttUtils";
import { WorksheetEditor, signedAccountImpact } from "./WorksheetEditor";

export function DeviationSection({
  snapshots,
  ccState,
  onJournalCreated,
  onCreateFromSnapshot,
}: {
  snapshots: ActualBalanceSnapshot[];
  ccState: CreditCardStateEntry[];
  onJournalCreated: () => Promise<void> | void;
  onCreateFromSnapshot: (draft: TrialBalanceCarryForwardDraft) => void;
}) {
  const { t, locale } = useLang();
  const {
    accounts,
    journal,
    refresh,
    displayCurrency,
    displayCurrencySymbol,
    convertCurrency,
    enabledCurrencies,
  } = useAppData();
  const navigate = useNavigate();
  const getDisplayName = useAccountDisplayName();
  const accountMap = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );
  const normalizeCurrency = (currency: string | null | undefined) =>
    (currency || "JPY").toUpperCase();
  const accountCurrency = (
    account: ReturnType<typeof useAppData>["accounts"][number] | undefined,
  ) =>
    normalizeCurrency(
      Object.keys(account?.balances ?? {}).find(
          (currency) => Math.abs(account?.balances?.[currency] ?? 0) > 0.001,
        ) ||
        Object.keys(account?.balances ?? {})[0] ||
        displayCurrency,
    );
  const currencySymbolFor = (currency: string | null | undefined) =>
    getEffectiveSymbol(normalizeCurrency(currency), enabledCurrencies);
  const formatAccountCurrency = (
    amount: number,
    currency: string | null | undefined,
  ) =>
    formatCurrency(
      amount,
      locale,
      normalizeCurrency(currency),
      currencySymbolFor(currency),
    );
  const formatDisplayCurrency = (amount: number) =>
    formatCurrency(amount, locale, displayCurrency, displayCurrencySymbol);
  const hasDifference = (
    difference: number,
    currency: string | null | undefined,
  ) => hasMaterialBalanceDifference(difference, currency, enabledCurrencies);
  const [confirmOpen, { open: openConfirm, close: closeConfirm }] =
    useDisclosure(false);
  const [processing, setProcessing] = useState(false);
  const [
    journalEditOpened,
    { open: openJournalEdit, close: closeJournalEdit },
  ] = useDisclosure(false);
  const [
    deleteJournalConfirmOpened,
    { open: openDeleteJournalConfirm, close: closeDeleteJournalConfirm },
  ] = useDisclosure(false);
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [entryToDelete, setEntryToDelete] = useState<JournalEntry | null>(null);
  const [deletingEntry, setDeletingEntry] = useState(false);
  const [showResolvedCreditCardRows, setShowResolvedCreditCardRows] =
    useState(false);

  const [ccSettings, setCcSettings] = useState<CreditCardSettings[]>([]);
  useEffect(() => {
    api.creditCardSettings
      .list()
      .then(setCcSettings)
      .catch(() => {});
  }, []);
  const ccSettingsMap = useMemo(
    () => new Map(ccSettings.map((s) => [s.account_id, s])),
    [ccSettings],
  );

  const unknownFundsAccount = accounts.find(
    (a) => a.name === "__system:unknown_funds__",
  );

  const [selectedId, setSelectedId] = useState<string | null>(
    snapshots[0] ? String(snapshots[0].id) : null,
  );

  const snapshot = useMemo(
    () => snapshots.find((s) => String(s.id) === selectedId),
    [snapshots, selectedId],
  );

  // ── Worksheet state (persisted in localStorage per snapshot_date) ──
  const [worksheetRows, setWorksheetRows] = useState<WorksheetRow[]>([]);

  useEffect(() => {
    if (!snapshot) {
      setWorksheetRows([]);
      return;
    }
    const key = `tt:worksheet:${snapshot.snapshot_date}`;
    const raw = localStorage.getItem(key);
    try {
      const parsed: WorksheetRow[] = raw ? JSON.parse(raw) : [];
      // Backfill `note` for rows saved before the field was added
      setWorksheetRows(parsed.map((r) => ({ ...r, note: r.note ?? "" })));
    } catch {
      setWorksheetRows([]);
    }
  }, [snapshot?.snapshot_date]);

  useEffect(() => {
    if (!snapshot) return;
    const key = `tt:worksheet:${snapshot.snapshot_date}`;
    localStorage.setItem(key, JSON.stringify(worksheetRows));
  }, [worksheetRows, snapshot?.snapshot_date]);

  const adjustmentMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const row of worksheetRows) {
      if (row.account_id === null) continue;
      const amount = Number(row.amount) || 0;
      if (amount === 0) continue;
      map.set(row.account_id, (map.get(row.account_id) ?? 0) + amount);
    }
    return map;
  }, [worksheetRows]);

  const hasAdjustments = adjustmentMap.size > 0;
  const generalRows: DeviationRow[] = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.general_entries.map((entry) => ({
      account_id: entry.account_id,
      account_name: entry.account_name,
      currency:
        entry.currency || accountCurrency(accountMap.get(entry.account_id)),
      book_value: entry.book_value,
      actual_value: entry.amount,
      deviation: entry.amount - entry.book_value,
      match_key: `${entry.account_id}:summary`,
    }));
  }, [snapshot, accountMap]);

  const creditCardRows = useMemo(() => {
    const todayStr = toDateStr(new Date());
    return [...ccState]
      .map((entry) => {
        const account = accountMap.get(entry.account_id);
        const currency = accountCurrency(account);
        const setting = ccSettingsMap.get(entry.account_id);
        const meta = getCreditCardWindowMeta(
          todayStr,
          entry.payment_month,
          setting,
          locale,
        );
        const bookValue =
          setting && meta.period
            ? cardBookChangeInPeriod(
                entry.account_id,
                entry.payment_month,
                todayStr,
                meta.period.start,
                meta.periodEnd,
                setting,
                journal,
                accounts,
              )
            : 0;
        return {
          id: entry.id,
          account_id: entry.account_id,
          account_name: entry.account_name,
          currency,
          amount: entry.amount,
          payment_month: entry.payment_month,
          status: meta.status as "open" | "confirmed" | "paid",
          book_value: bookValue,
          withdrawal_amount: cardWithdrawalAmountForStatementMonth(
            entry.account_id,
            entry.payment_month,
            todayStr,
            setting,
            journal,
            accounts,
          ),
          deviation: entry.amount - bookValue,
          period_label: meta.periodLabel,
        };
      })
      .sort((a, b) => {
        if (a.account_id !== b.account_id) return a.account_id - b.account_id;
        const order: Record<"open" | "confirmed" | "paid", number> = {
          open: 0,
          confirmed: 1,
          paid: 2,
        };
        if (a.status !== b.status) return order[a.status] - order[b.status];
        return a.payment_month < b.payment_month ? 1 : -1;
      });
  }, [ccState, ccSettingsMap, journal, accounts, locale, accountMap]);

  const currentCreditCardMonth = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }, []);
  const hiddenResolvedCreditCardRows = useMemo(
    () =>
      creditCardRows.filter(
        (row) =>
          row.status === "paid" &&
          diffCreditCardMonths(row.payment_month, currentCreditCardMonth) >=
            3 &&
          !hasDifference(row.deviation, row.currency),
      ),
    [creditCardRows, currentCreditCardMonth, enabledCurrencies],
  );
  const visibleCreditCardRows = showResolvedCreditCardRows
    ? creditCardRows
    : creditCardRows.filter(
        (row) =>
          !hiddenResolvedCreditCardRows.some(
            (hiddenRow) => hiddenRow.id === row.id,
          ),
      );

  const totalGeneralDeviation = generalRows.reduce(
    (sum, row) =>
      sum +
      convertCurrency(
        row.deviation,
        normalizeCurrency(row.currency),
        displayCurrency,
      ),
    0,
  );
  const totalCcDeviation = creditCardRows.reduce(
    (sum, row) =>
      sum +
      convertCurrency(
        row.deviation,
        normalizeCurrency(row.currency),
        displayCurrency,
      ),
    0,
  );
  const visibleCcWithdrawalAmount = visibleCreditCardRows.reduce(
    (sum, row) =>
      sum +
      convertCurrency(
        row.withdrawal_amount,
        normalizeCurrency(row.currency),
        displayCurrency,
      ),
    0,
  );
  const totalDeviation = totalGeneralDeviation + totalCcDeviation;
  const hasGeneralDifferences = generalRows.some((row) =>
    hasDifference(row.deviation, row.currency),
  );
  const hasCreditCardDifferences = creditCardRows.some((row) =>
    hasDifference(row.deviation, row.currency),
  );
  const isSelectedClean =
    !hasGeneralDifferences && !hasCreditCardDifferences;

  const matchingJournalMap = useMemo(() => {
    const map = new Map<string, MatchingJournalEntry[]>();
    if (!snapshot) return map;
    const snapshotTime = new Date(
      `${snapshot.snapshot_date}T00:00:00`,
    ).getTime();

    for (const row of generalRows) {
      if (!hasDifference(row.deviation, row.currency)) continue;
      const account = accounts.find((a) => a.id === row.account_id);
      if (!account) continue;

      const matches = journal
        .filter(
          (entry) =>
            (!row.match_from || entry.date >= row.match_from) &&
            (!row.match_to || entry.date <= row.match_to),
        )
        .map((entry) => ({
          entry,
          delta: signedAccountImpact(entry, account, row.currency),
          distanceToFix: 0,
        }))
        .map((candidate) => ({
          ...candidate,
          distanceToFix: Math.abs(candidate.delta + row.deviation),
        }))
        .filter(
          (candidate) =>
            !hasDifference(candidate.distanceToFix, row.currency),
        )
        .sort((a, b) => {
          if (a.distanceToFix !== b.distanceToFix) {
            return a.distanceToFix - b.distanceToFix;
          }
          const aDistance = Math.abs(
            new Date(`${a.entry.date}T00:00:00`).getTime() - snapshotTime,
          );
          const bDistance = Math.abs(
            new Date(`${b.entry.date}T00:00:00`).getTime() - snapshotTime,
          );
          if (aDistance !== bDistance) return aDistance - bDistance;
          return b.entry.id - a.entry.id;
        });

      if (matches.length > 0) {
        map.set(row.match_key, matches);
      }
    }

    return map;
  }, [generalRows, snapshot, accounts, journal, enabledCurrencies]);

  const totalAdjustment = generalRows.reduce(
    (s, r) =>
      s +
      convertCurrency(
        adjustmentMap.get(r.account_id) ?? 0,
        normalizeCurrency(r.currency),
        displayCurrency,
      ),
    0,
  );
  const adjustedTotalDeviation = totalGeneralDeviation + totalAdjustment;
  const hasAdjustedGeneralDifferences = generalRows.some((row) =>
    hasDifference(
      row.deviation + (adjustmentMap.get(row.account_id) ?? 0),
      row.currency,
    ),
  );

  // Entries where credit_card_billing_offset_months > 0, grouped by account + offset month
  const offsetCcGroups = useMemo(() => {
    type OffsetEntry = {
      entry_id: number;
      date: string;
      description: string;
      credit_amount: number;
      base_month: string;
    };
    type Group = {
      key: string;
      account_id: number;
      account_name: string;
      offset_month: string;
      total: number;
      entries: OffsetEntry[];
    };
    const groupMap = new Map<string, Group>();
    for (const entry of journal) {
      for (const line of entry.lines) {
        const offset = line.credit_card_billing_offset_months;
        if (offset == null || offset <= 0 || line.credit <= 0) continue;
        const acct = accounts.find((a) => a.id === line.account_id);
        if (acct?.category !== "credit_card") continue;
        const setting = ccSettingsMap.get(line.account_id);
        if (!setting) continue;
        const baseMonth = statementMonthForTransactionDate(
          entry.date,
          setting.closing_day,
        );
        const offsetMonth = statementMonthWithTransactionOffset(
          entry.date,
          setting.closing_day,
          offset,
        );
        const key = `${line.account_id}:${offsetMonth}`;
        if (!groupMap.has(key)) {
          groupMap.set(key, {
            key,
            account_id: line.account_id,
            account_name: acct.name,
            offset_month: offsetMonth,
            total: 0,
            entries: [],
          });
        }
        const group = groupMap.get(key)!;
        group.total += line.credit;
        group.entries.push({
          entry_id: entry.id,
          date: entry.date,
          description: entry.description,
          credit_amount: line.credit,
          base_month: baseMonth,
        });
      }
    }
    return [...groupMap.values()].sort((a, b) =>
      a.account_id !== b.account_id
        ? a.account_id - b.account_id
        : a.offset_month < b.offset_month
          ? -1
          : 1,
    );
  }, [journal, accounts, ccSettingsMap]);

  async function refreshAfterJournalChange() {
    await refresh();
    await Promise.resolve(onJournalCreated());
  }

  const journalPreview: JournalPreviewEntry[] = useMemo(() => {
    if (!snapshot || !unknownFundsAccount) return [];
    return generalRows
      .filter((r) => hasDifference(r.deviation, r.currency))
      .map((r) => {
        const acct = accounts.find((a) => a.id === r.account_id);
        const displayName = getDisplayName(r.account_name);
        const unknownName = t("sysUnknownFunds");
        const isAsset = acct?.type === "asset";

        // Asset: positive deviation means excess assets; negative means shortage.
        // Liability: positive deviation means excess liabilities; negative means shortage.
        let debitName: string;
        let creditName: string;
        if (isAsset) {
          if (r.deviation > 0) {
            debitName = displayName;
            creditName = unknownName;
          } else {
            debitName = unknownName;
            creditName = displayName;
          }
        } else {
          // liability
          if (r.deviation > 0) {
            debitName = unknownName;
            creditName = displayName;
          } else {
            debitName = displayName;
            creditName = unknownName;
          }
        }

        return {
          debit_account: debitName,
          credit_account: creditName,
          amount: Math.abs(r.deviation),
          currency: normalizeCurrency(r.currency),
          date: snapshot.snapshot_date,
        };
      });
  }, [
    generalRows,
    snapshot,
    unknownFundsAccount,
    accounts,
    t,
    getDisplayName,
    enabledCurrencies,
  ]);

  async function handleProcessUnknownFunds() {
    if (!snapshot || !unknownFundsAccount) return;
    setProcessing(true);
    try {
      for (const preview of journalPreview) {
        const debitAcct = accounts.find(
          (a) => getDisplayName(a.name) === preview.debit_account,
        );
        const creditAcct = accounts.find(
          (a) => getDisplayName(a.name) === preview.credit_account,
        );
        if (!debitAcct || !creditAcct) continue;
        await api.journal.create({
          date: preview.date,
          description:
            locale === "ja"
              ? `不明金処理 - ${preview.debit_account !== t("sysUnknownFunds") ? preview.debit_account : preview.credit_account}`
              : `Unknown funds - ${preview.debit_account !== t("sysUnknownFunds") ? preview.debit_account : preview.credit_account}`,
          lines: [
            {
              account_id: debitAcct.id,
              debit: preview.amount,
              credit: 0,
              currency: preview.currency,
            },
            {
              account_id: creditAcct.id,
              debit: 0,
              credit: preview.amount,
              currency: preview.currency,
            },
          ],
          budget_source: "multiline",
        });
      }
      showFeedback({ message: t("ttUnknownFundsRecorded"), color: "teal" });
      closeConfirm();
      await refreshAfterJournalChange();
    } catch {
      showFeedback({ message: t("saveFailed"), color: "red" });
    } finally {
      setProcessing(false);
    }
  }

  const [
    deleteConfirmOpen,
    { open: openDeleteConfirm, close: closeDeleteConfirm },
  ] = useDisclosure(false);
  const [deleting, setDeleting] = useState(false);
  const [
    createFromSnapshotOpen,
    { open: openCreateFromSnapshot, close: closeCreateFromSnapshot },
  ] = useDisclosure(false);

  const carryForwardDifferenceCount =
    snapshot?.general_entries.filter(
      (entry) =>
        hasDifference(entry.amount - entry.book_value, entry.currency),
    ).length ?? 0;

  function handleCreateFromSnapshot(scope: "differences" | "all") {
    if (!snapshot) return;
    const draft = buildTrialBalanceCarryForward(
      snapshot,
      scope,
      enabledCurrencies,
    );
    if (draft.entries.length === 0) return;
    closeCreateFromSnapshot();
    onCreateFromSnapshot(draft);
  }

  const latestCleanSnapshot = useMemo(() => {
    const todayStr = toDateStr(new Date());
    for (const snap of snapshots) {
      if (snap.snapshot_date > todayStr) continue;
      const hasSnapshotDifference = snap.general_entries.some((entry) =>
        hasDifference(entry.amount - entry.book_value, entry.currency),
      );
      if (!hasSnapshotDifference && !hasCreditCardDifferences) return snap;
    }
    return null;
  }, [snapshots, hasCreditCardDifferences, enabledCurrencies]);

  async function handleDeleteSnapshot() {
    if (!snapshot) return;
    setDeleting(true);
    try {
      await api.trialBalance.deleteSnapshot(snapshot.id);
      showFeedback({ message: t("ttDeleteSnapshotDeleted"), color: "teal" });
      closeDeleteConfirm();
      onJournalCreated(); // triggers snapshot reload in parent
    } catch {
      showFeedback({ message: t("saveFailed"), color: "red" });
    } finally {
      setDeleting(false);
    }
  }

  function handleEditJournal(entry: JournalEntry) {
    setEditingEntry(entry);
    openJournalEdit();
  }

  async function handleSaveJournalEdit(
    values: CreateJournalInput,
    meta?: import("../SimpleEntryForm").SimpleEntryMeta,
  ) {
    if (!editingEntry) return;
    try {
      if (meta?.depreciationUpdate) {
        await api.depreciation.update(
          meta.depreciationUpdate.scheduleId,
          meta.depreciationUpdate.input,
        );
      } else {
        await api.journal.update(editingEntry.id, values);
      }
      showFeedback({ message: t("transactionSaved"), color: "teal" });
      closeJournalEdit();
      setEditingEntry(null);
      await refreshAfterJournalChange();
    } catch {
      showFeedback({ message: t("saveFailed"), color: "red" });
    }
  }

  function handleDeleteJournal(entry: JournalEntry) {
    setEntryToDelete(entry);
    openDeleteJournalConfirm();
  }

  async function confirmDeleteJournal() {
    if (!entryToDelete) return;
    setDeletingEntry(true);
    try {
      await api.journal.delete(entryToDelete.id);
      showFeedback({ message: t("transactionDeleted"), color: "orange" });
      closeDeleteJournalConfirm();
      setEntryToDelete(null);
      await refreshAfterJournalChange();
    } catch {
      showFeedback({ message: t("saveFailed"), color: "red" });
    } finally {
      setDeletingEntry(false);
    }
  }

  if (snapshots.length === 0 && creditCardRows.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        {t("ttDeviationNoSnapshot")}
      </Text>
    );
  }

  return (
    <Stack gap="md">
      {latestCleanSnapshot && (
        <Text size="xs" c="teal" fw={500}>
          {t("ttLastCleanSnapshot")}: {latestCleanSnapshot.snapshot_date}
          {latestCleanSnapshot.snapshot_time
            ? ` ${latestCleanSnapshot.snapshot_time}`
            : ""}
        </Text>
      )}
      <Group align="flex-end" gap="xs" wrap="wrap">
        <Select
          label={t("ttDeviationSelectSnapshot")}
          data={snapshots.map((s) => ({
            value: String(s.id),
            label: s.snapshot_time
              ? `${s.snapshot_date} ${s.snapshot_time}`
              : s.snapshot_date,
          }))}
          value={selectedId}
          onChange={setSelectedId}
          w={220}
          size="sm"
        />
        {snapshot && (
          <>
            <Button
              size="sm"
              variant="light"
              leftSection={<IconCopyPlus size={16} />}
              onClick={openCreateFromSnapshot}
            >
              {t("ttCreateFromSnapshot")}
            </Button>
            <Button
              size="sm"
              variant="subtle"
              color="red"
              onClick={openDeleteConfirm}
            >
              {t("ttDeleteSnapshot")}
            </Button>
          </>
        )}
      </Group>

      {(snapshot || creditCardRows.length > 0) && (
        <Paper withBorder p="md" radius="md">
          <Group gap="xl" wrap="wrap">
            <Box>
              <Text size="xs" c="dimmed">
                {t("ttDeviationGeneralTotal")}
              </Text>
              <Text
                fw={700}
                c={
                  !hasGeneralDifferences
                    ? "dimmed"
                    : totalGeneralDeviation > 0
                      ? "teal"
                      : "red"
                }
              >
                {totalGeneralDeviation >= 0 ? "+" : ""}
                {formatDisplayCurrency(totalGeneralDeviation)}
              </Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed">
                {t("ttDeviationCreditCardTotal")}
              </Text>
              <Text
                fw={700}
                c={
                  !hasCreditCardDifferences
                    ? "dimmed"
                    : totalCcDeviation > 0
                      ? "teal"
                      : "red"
                }
              >
                {totalCcDeviation >= 0 ? "+" : ""}
                {formatDisplayCurrency(totalCcDeviation)}
              </Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed">
                {t("ttDeviationGrandTotal")}
              </Text>
              <Text
                fw={700}
                c={
                  isSelectedClean
                    ? "dimmed"
                    : totalDeviation > 0
                      ? "teal"
                      : "red"
                }
              >
                {totalDeviation >= 0 ? "+" : ""}
                {formatDisplayCurrency(totalDeviation)}
              </Text>
            </Box>
          </Group>
        </Paper>
      )}

      {!snapshot && creditCardRows.length === 0 ? (
        <Text c="dimmed" size="sm">
          {t("ttDeviationNoSnapshot")}
        </Text>
      ) : (
        <>
          <Paper withBorder p="md" radius="md">
            <Text fw={600} size="sm" mb="sm">
              {t("ttDeviationGeneralSection")}
            </Text>
            {generalRows.length === 0 ? (
              <Text size="sm" c="dimmed">
                {t("ttDeviationNoGeneralEntries")}
              </Text>
            ) : (
              <ScrollArea type="auto">
                <Table
                  fz="sm"
                  withRowBorders
                  withColumnBorders
                  miw={hasAdjustments ? 720 : 480}
                >
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t("ttDeviationAccount")}</Table.Th>
                      <Table.Th className="currency-cell">
                        {t("ttDeviationBookValue")}
                      </Table.Th>
                      <Table.Th className="currency-cell">
                        {t("ttDeviationActualValue")}
                      </Table.Th>
                      <Table.Th className="currency-cell">
                        {t("ttDeviationDiff")}
                      </Table.Th>
                      {hasAdjustments && (
                        <Table.Th className="currency-cell">
                          {t("ttWorksheetAdjustment")}
                        </Table.Th>
                      )}
                      {hasAdjustments && (
                        <Table.Th className="currency-cell">
                          {t("ttWorksheetAdjustedDeviation")}
                        </Table.Th>
                      )}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {generalRows.map((row) => {
                      const matches =
                        matchingJournalMap.get(row.match_key) ?? [];
                      const visibleMatches = matches.slice(0, 3);
                      const adjustment = adjustmentMap.get(row.account_id) ?? 0;
                      const adjustedDeviation = row.deviation + adjustment;
                      return (
                        <Table.Tr
                          key={row.match_key}
                          style={
                            hasDifference(row.deviation, row.currency)
                              ? { background: "var(--mantine-color-red-light)" }
                              : undefined
                          }
                        >
                          <Table.Td>
                            <Stack gap={4}>
                              <Text size="sm">
                                {getDisplayName(row.account_name)}
                              </Text>
                              {matches.length > 0 && (
                                <>
                                  <Badge
                                    color="yellow"
                                    variant="light"
                                    w="fit-content"
                                  >
                                    {t(
                                      "ttDeviationDuplicateCandidates",
                                    ).replace("{n}", String(matches.length))}
                                  </Badge>
                                  {visibleMatches.map((match) => (
                                    <Group
                                      key={match.entry.id}
                                      justify="space-between"
                                      gap="xs"
                                      wrap="nowrap"
                                    >
                                      <Text
                                        size="xs"
                                        c="dimmed"
                                        style={{ flex: 1 }}
                                      >
                                        {match.entry.date}
                                        {" · "}
                                        {match.entry.description || "-"}
                                        {" · "}
                                        {formatAccountCurrency(
                                          match.delta,
                                          row.currency,
                                        )}
                                      </Text>
                                      <Group gap={4} wrap="nowrap">
                                        <ActionIcon
                                          variant="subtle"
                                          size="sm"
                                          aria-label={t("editLabel")}
                                          onClick={() =>
                                            handleEditJournal(match.entry)
                                          }
                                        >
                                          <IconEdit size={14} />
                                        </ActionIcon>
                                        <ActionIcon
                                          variant="subtle"
                                          color="red"
                                          size="sm"
                                          aria-label={t("deleteEntry")}
                                          onClick={() =>
                                            handleDeleteJournal(match.entry)
                                          }
                                        >
                                          <IconTrash size={14} />
                                        </ActionIcon>
                                      </Group>
                                    </Group>
                                  ))}
                                  {matches.length > visibleMatches.length && (
                                    <Text size="xs" c="dimmed">
                                      {t("ttDeviationMoreMatches").replace(
                                        "{n}",
                                        String(
                                          matches.length -
                                            visibleMatches.length,
                                        ),
                                      )}
                                    </Text>
                                  )}
                                </>
                              )}
                            </Stack>
                          </Table.Td>
                          <Table.Td className="currency-cell">
                            {formatAccountCurrency(row.book_value, row.currency)}
                          </Table.Td>
                          <Table.Td className="currency-cell">
                            {formatAccountCurrency(
                              row.actual_value,
                              row.currency,
                            )}
                          </Table.Td>
                          <Table.Td
                            className="currency-cell"
                            c={
                              !hasDifference(row.deviation, row.currency)
                                ? "dimmed"
                                : row.deviation > 0
                                  ? "teal"
                                  : "red"
                            }
                          >
                            {row.deviation >= 0 ? "+" : ""}
                            {formatAccountCurrency(row.deviation, row.currency)}
                          </Table.Td>
                          {hasAdjustments && (
                            <Table.Td className="currency-cell" c="blue">
                              {adjustment !== 0 ? (
                                <>
                                  {adjustment >= 0 ? "+" : ""}
                                  {formatAccountCurrency(
                                    adjustment,
                                    row.currency,
                                  )}
                                </>
                              ) : (
                                <Text c="dimmed">-</Text>
                              )}
                            </Table.Td>
                          )}
                          {hasAdjustments && (
                            <Table.Td
                              className="currency-cell"
                              c={
                                !hasDifference(
                                  adjustedDeviation,
                                  row.currency,
                                )
                                  ? "dimmed"
                                  : adjustedDeviation > 0
                                    ? "teal"
                                    : "red"
                              }
                              fw={600}
                            >
                              {adjustedDeviation >= 0 ? "+" : ""}
                              {formatAccountCurrency(
                                adjustedDeviation,
                                row.currency,
                              )}
                            </Table.Td>
                          )}
                        </Table.Tr>
                      );
                    })}
                    <Table.Tr style={{ fontWeight: 700 }}>
                      <Table.Td colSpan={3}>{t("ttDeviationTotal")}</Table.Td>
                      <Table.Td
                        className="currency-cell"
                        c={
                          !hasGeneralDifferences
                            ? "dimmed"
                            : totalGeneralDeviation > 0
                              ? "teal"
                              : "red"
                        }
                      >
                        {totalGeneralDeviation >= 0 ? "+" : ""}
                        {formatDisplayCurrency(totalGeneralDeviation)}
                      </Table.Td>
                      {hasAdjustments && (
                        <Table.Td className="currency-cell" c="blue">
                          {totalAdjustment >= 0 ? "+" : ""}
                          {formatDisplayCurrency(totalAdjustment)}
                        </Table.Td>
                      )}
                      {hasAdjustments && (
                        <Table.Td
                          className="currency-cell"
                          c={
                            !hasAdjustedGeneralDifferences
                              ? "dimmed"
                              : adjustedTotalDeviation > 0
                                ? "teal"
                                : "red"
                          }
                        >
                          {adjustedTotalDeviation >= 0 ? "+" : ""}
                          {formatDisplayCurrency(adjustedTotalDeviation)}
                        </Table.Td>
                      )}
                    </Table.Tr>
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            )}
          </Paper>

          <Paper withBorder p="md" radius="md">
            <Group justify="space-between" align="center" mb="sm">
              <Stack gap={0}>
                <Text fw={600} size="sm">
                  {t("ttDeviationCreditCardSection")}
                </Text>
                {hiddenResolvedCreditCardRows.length > 0 && (
                  <Text size="xs" c="dimmed">
                    {t("ttDeviationHiddenResolvedCcRows").replace(
                      "{n}",
                      String(hiddenResolvedCreditCardRows.length),
                    )}
                  </Text>
                )}
              </Stack>
              {hiddenResolvedCreditCardRows.length > 0 && (
                <Button
                  size="xs"
                  variant="subtle"
                  onClick={() =>
                    setShowResolvedCreditCardRows((current) => !current)
                  }
                >
                  {showResolvedCreditCardRows
                    ? t("ttDeviationHideResolvedCcRows")
                    : t("ttDeviationShowResolvedCcRows").replace(
                        "{n}",
                        String(hiddenResolvedCreditCardRows.length),
                      )}
                </Button>
              )}
            </Group>
            {creditCardRows.length === 0 ? (
              <Text size="sm" c="dimmed">
                {t("ttDeviationNoCreditCardEntries")}
              </Text>
            ) : visibleCreditCardRows.length === 0 ? (
              <Text size="sm" c="dimmed">
                {t("ttDeviationOnlyHiddenCreditCardEntries")}
              </Text>
            ) : (
              <ScrollArea type="auto">
                <Table fz="sm" withRowBorders withColumnBorders miw={760}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t("ttDeviationAccount")}</Table.Th>
                      <Table.Th>{t("ttCcPaymentMonth")}</Table.Th>
                      <Table.Th>{t("ttCcEntryStatus")}</Table.Th>
                      <Table.Th>{t("ttDeviationSnapshotDate")}</Table.Th>
                      <Table.Th className="currency-cell">
                        {t("ttDeviationBookValue")}
                      </Table.Th>
                      <Table.Th className="currency-cell">
                        {t("ttDeviationActualValue")}
                      </Table.Th>
                      <Table.Th className="currency-cell">
                        {t("ttCcWithdrawalAmount")}
                      </Table.Th>
                      <Table.Th className="currency-cell">
                        {t("ttDeviationDiff")}
                      </Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {visibleCreditCardRows.map((row) => (
                      <Table.Tr
                        key={`${row.account_id}:${row.status}:${row.payment_month}`}
                      >
                        <Table.Td>{getDisplayName(row.account_name)}</Table.Td>
                        <Table.Td>{row.payment_month}</Table.Td>
                        <Table.Td>
                          {row.status === "open"
                            ? t("ttCcStatusOpen")
                            : row.status === "paid"
                              ? t("ttCcStatusPaid")
                              : t("ttCcStatusConfirmed")}
                        </Table.Td>
                        <Table.Td>{row.period_label}</Table.Td>
                        <Table.Td className="currency-cell">
                          {formatAccountCurrency(row.book_value, row.currency)}
                        </Table.Td>
                        <Table.Td className="currency-cell">
                          {formatAccountCurrency(row.amount, row.currency)}
                        </Table.Td>
                        <Table.Td className="currency-cell">
                          {formatAccountCurrency(
                            row.withdrawal_amount,
                            row.currency,
                          )}
                        </Table.Td>
                        <Table.Td
                          className="currency-cell"
                          c={
                            !hasDifference(row.deviation, row.currency)
                              ? "dimmed"
                              : row.deviation > 0
                                ? "teal"
                                : "red"
                          }
                        >
                          {row.deviation >= 0 ? "+" : ""}
                          {formatAccountCurrency(row.deviation, row.currency)}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                    <Table.Tr style={{ fontWeight: 700 }}>
                      <Table.Td colSpan={6}>{t("ttDeviationTotal")}</Table.Td>
                      <Table.Td className="currency-cell">
                        {formatDisplayCurrency(visibleCcWithdrawalAmount)}
                      </Table.Td>
                      <Table.Td
                        className="currency-cell"
                        c={
                          !hasCreditCardDifferences
                            ? "dimmed"
                            : totalCcDeviation > 0
                              ? "teal"
                              : "red"
                        }
                      >
                        {totalCcDeviation >= 0 ? "+" : ""}
                        {formatDisplayCurrency(totalCcDeviation)}
                      </Table.Td>
                    </Table.Tr>
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            )}
          </Paper>

          {isSelectedClean ? (
            <Alert
              color="teal"
              icon={<IconCircleCheck size={16} />}
              variant="light"
            >
              {t("ttNoDeviation")}
            </Alert>
          ) : hasGeneralDifferences ? (
            <Group gap="sm">
              <Button
                color="orange"
                variant="light"
                onClick={openConfirm}
                disabled={!unknownFundsAccount}
              >
                {t("ttProcessAsUnknownFunds")}
              </Button>
              <Button
                color="blue"
                variant="light"
                onClick={() => navigate("/input?from=tt")}
              >
                {t("ttCauseFoundInput")}
              </Button>
            </Group>
          ) : (
            <Alert color="blue" variant="light">
              {t("ttDeviationCreditCardOnlyHint")}
            </Alert>
          )}

          {offsetCcGroups.length > 0 && (
            <Paper withBorder p="md" radius="md">
              <Text fw={600} size="sm" mb="sm">
                {t("ttOffsetCcTitle")}
              </Text>
              <Accordion variant="separated" radius="md">
                {offsetCcGroups.map((group) => (
                  <Accordion.Item key={group.key} value={group.key}>
                    <Accordion.Control>
                      <Group justify="space-between" wrap="nowrap" pr="sm">
                        <Text size="sm" fw={500}>
                          {getDisplayName(group.account_name)}
                        </Text>
                        <Group gap="xs" wrap="nowrap">
                          <Text size="sm" c="dimmed">
                            {group.offset_month}
                          </Text>
                          <Text size="sm" fw={600}>
                            {formatJPY(group.total, locale)}
                          </Text>
                        </Group>
                      </Group>
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Table fz="xs" withRowBorders>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>
                              {locale === "ja" ? "利用日" : "Date"}
                            </Table.Th>
                            <Table.Th>
                              {locale === "ja" ? "摘要" : "Description"}
                            </Table.Th>
                            <Table.Th>{t("ttOffsetCcOriginalMonth")}</Table.Th>
                            <Table.Th className="currency-cell">
                              {locale === "ja" ? "金額" : "Amount"}
                            </Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {group.entries.map((e, i) => (
                            <Table.Tr key={i}>
                              <Table.Td style={{ whiteSpace: "nowrap" }}>
                                {e.date}
                              </Table.Td>
                              <Table.Td>{e.description}</Table.Td>
                              <Table.Td c="dimmed">
                                {e.base_month} → {group.offset_month}
                              </Table.Td>
                              <Table.Td className="currency-cell">
                                {formatJPY(e.credit_amount, locale)}
                              </Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </Accordion.Panel>
                  </Accordion.Item>
                ))}
              </Accordion>
            </Paper>
          )}

          {snapshot && (
            <WorksheetEditor
              rows={worksheetRows}
              onChange={setWorksheetRows}
              accountOptions={snapshot.general_entries.map((e) => {
                const account = accountMap.get(e.account_id);
                return account
                  ? toAccountSelectOption(account, t)
                  : {
                      value: String(e.account_id),
                      label: getDisplayName(e.account_name),
                    };
              })}
            />
          )}
        </>
      )}

      <Modal
        opened={confirmOpen}
        onClose={closeConfirm}
        title={t("ttProcessAsUnknownFunds")}
        size="lg"
      >
        <Stack gap="md">
          <Text size="sm">{t("ttUnknownFundsJournalPreview")}</Text>
          <Table fz="sm" withRowBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Date</Table.Th>
                <Table.Th>{locale === "ja" ? "借方" : "Debit"}</Table.Th>
                <Table.Th>{locale === "ja" ? "貸方" : "Credit"}</Table.Th>
                <Table.Th className="currency-cell">Amount</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {journalPreview.map((p, i) => (
                <Table.Tr key={i}>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>{p.date}</Table.Td>
                  <Table.Td>{p.debit_account}</Table.Td>
                  <Table.Td>{p.credit_account}</Table.Td>
                  <Table.Td className="currency-cell">
                    {formatJPY(p.amount, locale)}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Text size="sm" c="dimmed">
            {t("ttUnknownFundsConfirmMsg")}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={closeConfirm}>
              {t("cancel")}
            </Button>
            <Button
              color="orange"
              loading={processing}
              onClick={handleProcessUnknownFunds}
            >
              {t("confirm")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={createFromSnapshotOpen}
        onClose={closeCreateFromSnapshot}
        title={t("ttCreateFromSnapshot")}
      >
        <Stack gap="md">
          <Alert color="blue" variant="light">
            {t("ttCreateFromSnapshotNotice")}
          </Alert>
          <Button
            variant="light"
            disabled={carryForwardDifferenceCount === 0}
            onClick={() => handleCreateFromSnapshot("differences")}
          >
            {t("ttCreateFromSnapshotDifferences").replace(
              "{count}",
              String(carryForwardDifferenceCount),
            )}
          </Button>
          {carryForwardDifferenceCount === 0 && (
            <Text size="xs" c="dimmed" ta="center">
              {t("ttCreateFromSnapshotNoDifferences")}
            </Text>
          )}
          <Button
            variant="default"
            onClick={() => handleCreateFromSnapshot("all")}
          >
            {t("ttCreateFromSnapshotAll").replace(
              "{count}",
              String(snapshot?.general_entries.length ?? 0),
            )}
          </Button>
        </Stack>
      </Modal>

      <Modal
        opened={deleteConfirmOpen}
        onClose={closeDeleteConfirm}
        title={t("ttDeleteSnapshot")}
      >
        <Stack gap="md">
          {isSelectedClean && (
            <Alert
              color="blue"
              variant="light"
              icon={<IconCircleCheck size={16} />}
            >
              {t("ttDeleteSnapshotZeroWarning")}
            </Alert>
          )}
          <Text size="sm">{t("ttDeleteSnapshotConfirm")}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={closeDeleteConfirm}>
              {t("cancel")}
            </Button>
            <Button
              color="red"
              loading={deleting}
              onClick={handleDeleteSnapshot}
            >
              {t("confirm")}
            </Button>
          </Group>
        </Stack>
      </Modal>

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

      <Modal
        opened={deleteJournalConfirmOpened}
        onClose={closeDeleteJournalConfirm}
        title={t("deleteJournalConfirm")}
        size="sm"
        centered
      >
        <Stack gap="sm">
          <Text size="sm">{t("deleteJournalConfirmMsg")}</Text>
          {entryToDelete && (
            <Text size="xs" c="dimmed">
              {entryToDelete.date}
              {" · "}
              {entryToDelete.description || "-"}
            </Text>
          )}
          <Group justify="flex-end" mt="xs">
            <Button
              variant="default"
              size="sm"
              onClick={closeDeleteJournalConfirm}
            >
              {t("cancel")}
            </Button>
            <Button
              color="red"
              size="sm"
              loading={deletingEntry}
              onClick={confirmDeleteJournal}
            >
              {t("deleteEntry")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
