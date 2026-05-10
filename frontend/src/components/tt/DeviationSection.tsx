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
import { IconCircleCheck, IconEdit, IconTrash } from "@tabler/icons-react";
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
import { formatJPY } from "../../lib/numberFormat";
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
}: {
  snapshots: ActualBalanceSnapshot[];
  ccState: CreditCardStateEntry[];
  onJournalCreated: () => Promise<void> | void;
}) {
  const { t, locale } = useLang();
  const { accounts, journal, refresh } = useAppData();
  const navigate = useNavigate();
  const getDisplayName = useAccountDisplayName();
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
      book_value: entry.book_value,
      actual_value: entry.amount,
      deviation: entry.amount - entry.book_value,
      match_key: `${entry.account_id}:summary`,
    }));
  }, [snapshot]);

  const creditCardRows = useMemo(() => {
    const todayStr = (() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    })();
    return [...ccState]
      .map((entry) => {
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
  }, [ccState, ccSettingsMap, journal, accounts, locale]);

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
          Math.abs(row.deviation) < 0.5,
      ),
    [creditCardRows, currentCreditCardMonth],
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
    (sum, row) => sum + row.deviation,
    0,
  );
  const totalCcDeviation = creditCardRows.reduce(
    (sum, row) => sum + row.deviation,
    0,
  );
  const visibleCcWithdrawalAmount = visibleCreditCardRows.reduce(
    (sum, row) => sum + row.withdrawal_amount,
    0,
  );
  const totalDeviation = totalGeneralDeviation + totalCcDeviation;

  const matchingJournalMap = useMemo(() => {
    const map = new Map<string, MatchingJournalEntry[]>();
    if (!snapshot) return map;
    const snapshotTime = new Date(
      `${snapshot.snapshot_date}T00:00:00`,
    ).getTime();

    for (const row of generalRows) {
      if (Math.abs(row.deviation) < 0.5) continue;
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
          delta: signedAccountImpact(entry, account),
          distanceToFix: 0,
        }))
        .map((candidate) => ({
          ...candidate,
          distanceToFix: Math.abs(candidate.delta + row.deviation),
        }))
        .filter((candidate) => candidate.distanceToFix < 0.5)
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
  }, [generalRows, snapshot, accounts, journal]);

  const totalAdjustment = generalRows.reduce(
    (s, r) => s + (adjustmentMap.get(r.account_id) ?? 0),
    0,
  );
  const adjustedTotalDeviation = totalGeneralDeviation + totalAdjustment;

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
      .filter((r) => Math.abs(r.deviation) > 0.5)
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
          date: snapshot.snapshot_date,
        };
      });
  }, [generalRows, snapshot, unknownFundsAccount, accounts, t, getDisplayName]);

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
            { account_id: debitAcct.id, debit: preview.amount, credit: 0 },
            { account_id: creditAcct.id, debit: 0, credit: preview.amount },
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

  function snapshotTotalDeviation(snap: ActualBalanceSnapshot) {
    const general = snap.general_entries.reduce(
      (sum, entry) => sum + (entry.amount - entry.book_value),
      0,
    );
    // CC deviation is based on the current standalone CC state (not per-snapshot)
    const ccDeviation = creditCardRows.reduce(
      (sum, row) => sum + row.deviation,
      0,
    );
    return general + ccDeviation;
  }

  const latestCleanSnapshot = useMemo(() => {
    const todayStr = (() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    })();
    for (const snap of snapshots) {
      if (snap.snapshot_date > todayStr) continue;
      const totalDev = snapshotTotalDeviation(snap);
      if (Math.abs(totalDev) < 0.5) return snap;
    }
    return null;
  }, [snapshots, ccSettingsMap, journal, accounts]);

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

  if (snapshots.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        {t("ttDeviationNoSnapshot")}
      </Text>
    );
  }

  const isSelectedClean = Math.abs(totalDeviation) < 0.5;

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
          <Button
            size="sm"
            variant="subtle"
            color="red"
            onClick={openDeleteConfirm}
          >
            {t("ttDeleteSnapshot")}
          </Button>
        )}
      </Group>

      {snapshot && (
        <Paper withBorder p="md" radius="md">
          <Group gap="xl" wrap="wrap">
            <Box>
              <Text size="xs" c="dimmed">
                {t("ttDeviationGeneralTotal")}
              </Text>
              <Text
                fw={700}
                c={
                  Math.abs(totalGeneralDeviation) < 0.5
                    ? "dimmed"
                    : totalGeneralDeviation > 0
                      ? "teal"
                      : "red"
                }
              >
                {totalGeneralDeviation >= 0 ? "+" : ""}
                {formatJPY(totalGeneralDeviation, locale)}
              </Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed">
                {t("ttDeviationCreditCardTotal")}
              </Text>
              <Text
                fw={700}
                c={
                  Math.abs(totalCcDeviation) < 0.5
                    ? "dimmed"
                    : totalCcDeviation > 0
                      ? "teal"
                      : "red"
                }
              >
                {totalCcDeviation >= 0 ? "+" : ""}
                {formatJPY(totalCcDeviation, locale)}
              </Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed">
                {t("ttDeviationGrandTotal")}
              </Text>
              <Text
                fw={700}
                c={
                  Math.abs(totalDeviation) < 0.5
                    ? "dimmed"
                    : totalDeviation > 0
                      ? "teal"
                      : "red"
                }
              >
                {totalDeviation >= 0 ? "+" : ""}
                {formatJPY(totalDeviation, locale)}
              </Text>
            </Box>
          </Group>
        </Paper>
      )}

      {!snapshot ? (
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
                            Math.abs(row.deviation) > 0.5
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
                                        {formatJPY(match.delta, locale)}
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
                            {formatJPY(row.book_value, locale)}
                          </Table.Td>
                          <Table.Td className="currency-cell">
                            {formatJPY(row.actual_value, locale)}
                          </Table.Td>
                          <Table.Td
                            className="currency-cell"
                            c={
                              Math.abs(row.deviation) < 0.5
                                ? "dimmed"
                                : row.deviation > 0
                                  ? "teal"
                                  : "red"
                            }
                          >
                            {row.deviation >= 0 ? "+" : ""}
                            {formatJPY(row.deviation, locale)}
                          </Table.Td>
                          {hasAdjustments && (
                            <Table.Td className="currency-cell" c="blue">
                              {adjustment !== 0 ? (
                                <>
                                  {adjustment >= 0 ? "+" : ""}
                                  {formatJPY(adjustment, locale)}
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
                                Math.abs(adjustedDeviation) < 0.5
                                  ? "dimmed"
                                  : adjustedDeviation > 0
                                    ? "teal"
                                    : "red"
                              }
                              fw={600}
                            >
                              {adjustedDeviation >= 0 ? "+" : ""}
                              {formatJPY(adjustedDeviation, locale)}
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
                          Math.abs(totalGeneralDeviation) < 0.5
                            ? "dimmed"
                            : totalGeneralDeviation > 0
                              ? "teal"
                              : "red"
                        }
                      >
                        {totalGeneralDeviation >= 0 ? "+" : ""}
                        {formatJPY(totalGeneralDeviation, locale)}
                      </Table.Td>
                      {hasAdjustments && (
                        <Table.Td className="currency-cell" c="blue">
                          {totalAdjustment >= 0 ? "+" : ""}
                          {formatJPY(totalAdjustment, locale)}
                        </Table.Td>
                      )}
                      {hasAdjustments && (
                        <Table.Td
                          className="currency-cell"
                          c={
                            Math.abs(adjustedTotalDeviation) < 0.5
                              ? "dimmed"
                              : adjustedTotalDeviation > 0
                                ? "teal"
                                : "red"
                          }
                        >
                          {adjustedTotalDeviation >= 0 ? "+" : ""}
                          {formatJPY(adjustedTotalDeviation, locale)}
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
                          {formatJPY(row.book_value, locale)}
                        </Table.Td>
                        <Table.Td className="currency-cell">
                          {formatJPY(row.amount, locale)}
                        </Table.Td>
                        <Table.Td className="currency-cell">
                          {formatJPY(row.withdrawal_amount, locale)}
                        </Table.Td>
                        <Table.Td
                          className="currency-cell"
                          c={
                            Math.abs(row.deviation) < 0.5
                              ? "dimmed"
                              : row.deviation > 0
                                ? "teal"
                                : "red"
                          }
                        >
                          {row.deviation >= 0 ? "+" : ""}
                          {formatJPY(row.deviation, locale)}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                    <Table.Tr style={{ fontWeight: 700 }}>
                      <Table.Td colSpan={5}>{t("ttDeviationTotal")}</Table.Td>
                      <Table.Td className="currency-cell">
                        {formatJPY(visibleCcWithdrawalAmount, locale)}
                      </Table.Td>
                      <Table.Td
                        className="currency-cell"
                        c={
                          Math.abs(totalCcDeviation) < 0.5
                            ? "dimmed"
                            : totalCcDeviation > 0
                              ? "teal"
                              : "red"
                        }
                      >
                        {totalCcDeviation >= 0 ? "+" : ""}
                        {formatJPY(totalCcDeviation, locale)}
                      </Table.Td>
                    </Table.Tr>
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            )}
          </Paper>

          {Math.abs(totalDeviation) < 0.5 ? (
            <Alert
              color="teal"
              icon={<IconCircleCheck size={16} />}
              variant="light"
            >
              {t("ttNoDeviation")}
            </Alert>
          ) : totalGeneralDeviation !== 0 ? (
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

          <WorksheetEditor
            rows={worksheetRows}
            onChange={setWorksheetRows}
            accountOptions={snapshot.general_entries.map((e) => ({
              value: String(e.account_id),
              label: getDisplayName(e.account_name),
            }))}
          />
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
