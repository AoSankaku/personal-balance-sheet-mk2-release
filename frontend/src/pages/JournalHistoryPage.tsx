import {
  Accordion,
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Loader,
  NumberInput,
  Pagination,
  Paper,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertTriangle, IconHistory } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { JournalDeletionCandidate } from "@balance-sheet/shared";
import { api } from "../api/client";
import { ConfirmModal } from "../components/ConfirmModal";
import { useLang } from "../i18n";
import { showFeedback } from "../lib/feedback";

const PAGE_SIZE = 50;
const MIN_RETENTION = 1;
const MAX_RETENTION = 10_000;

export function formatJournalHistoryAmount(value: number, locale: string) {
  return value.toLocaleString(locale, { maximumFractionDigits: 9 });
}

function HistoryCard({ candidate }: { candidate: JournalDeletionCandidate }) {
  const { t, locale } = useLang();
  const dateTime = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );
  const entry = candidate.entry;
  const budgetAllocations = candidate.related_records.journal_entry_budget_allocations ?? [];
  const incomeAdjustments = candidate.related_records.budget_adjustment_logs ?? [];
  const fundingAllocations = candidate.related_records.budget_funding_allocations ?? [];
  const hasDetails = budgetAllocations.length + incomeAdjustments.length + fundingAllocations.length > 0;
  const adjustmentKeys: Record<string, "journalHistoryAllocation" | "journalHistoryReset" | "journalHistoryTransfer" | "journalHistoryManualAdjustment"> = {
    allocation: "journalHistoryAllocation",
    reset: "journalHistoryReset",
    transfer: "journalHistoryTransfer",
    manual: "journalHistoryManualAdjustment",
  };
  const fundingKeys: Record<string, "journalHistoryBorrow" | "journalHistoryRepay" | "journalHistoryLend" | "journalHistoryCollect"> = {
    borrow: "journalHistoryBorrow",
    repay: "journalHistoryRepay",
    lend: "journalHistoryLend",
    collect: "journalHistoryCollect",
  };

  return (
    <Paper withBorder p="md" radius="sm">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="xs">
          <Stack gap={4}>
            <Group gap="xs">
              <Badge color={candidate.reason === "deleted" ? "red" : "orange"} variant="light">
                {t(candidate.reason === "deleted" ? "journalHistoryDeleted" : "journalHistoryEdited")}
              </Badge>
              <Text size="xs" c="dimmed">
                {t("journalHistoryEntryId")}: {candidate.original_journal_entry_id}
              </Text>
            </Group>
            <Text fw={600}>{entry.description}</Text>
            <Text size="sm" c="dimmed">{entry.date}</Text>
            {(entry.expense_tags?.length ?? 0) > 0 && <Stack gap={4}>
              <Group gap={4} aria-label={t("expenseTagsLabel")}>
                {entry.expense_tags!.map(tag => <Badge key={tag.id} color="cyan" variant="light" tt="none">{tag.name}</Badge>)}
              </Group>
              {(entry.tag_expense_amounts ?? []).map(value => <Text key={value.currency} size="xs" c="dimmed">
                {t("tagExpenseTotal")}: {formatJournalHistoryAmount(value.amount, locale)} {value.currency}
              </Text>)}
            </Stack>}
          </Stack>
          <Text component="time" dateTime={candidate.archived_at} size="xs" c="dimmed">
            {t("journalHistoryArchivedAt")}: {dateTime.format(new Date(candidate.archived_at))}
          </Text>
        </Group>

        <Accordion variant="contained" radius="sm">
          <Accordion.Item value="snapshot">
            <Accordion.Control>{t("journalHistoryLines")} ({entry.lines.length})</Accordion.Control>
            <Accordion.Panel>
              <Table.ScrollContainer minWidth={440} type="native">
                <Table striped highlightOnHover withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t("journalHistoryAccount")}</Table.Th>
                      <Table.Th ta="right">{t("journalHistoryDebit")}</Table.Th>
                      <Table.Th ta="right">{t("journalHistoryCredit")}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {entry.lines.map(line => (
                      <Table.Tr key={line.id}>
                        <Table.Td>{line.account_name}</Table.Td>
                        <Table.Td ta="right">{formatJournalHistoryAmount(line.debit, locale)} {line.currency}</Table.Td>
                        <Table.Td ta="right">{formatJournalHistoryAmount(line.credit, locale)} {line.currency}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
              {hasDetails && (
                <Accordion variant="separated" mt="sm">
                  <Accordion.Item value="related">
                    <Accordion.Control>{t("journalHistoryRelatedRecords")}</Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap="sm">
                        {budgetAllocations.length > 0 && (
                          <Stack gap={4}>
                            <Text size="sm" fw={600}>{t("journalHistoryBudgetAllocations")}</Text>
                            {budgetAllocations.map((row, index) => (
                              <Text size="sm" key={`budget-${index}`}>
                                {String(row.budget_category_name ?? `#${row.budget_category_id}`)}: {formatJournalHistoryAmount(Number(row.amount ?? 0), locale)} {String(row.currency ?? "JPY")}
                                {row.is_reference ? ` · ${t("journalHistoryReference")}` : ""}
                              </Text>
                            ))}
                          </Stack>
                        )}
                        {incomeAdjustments.length > 0 && (
                          <Stack gap={4}>
                            <Text size="sm" fw={600}>{t("journalHistoryIncomeAdjustments")}</Text>
                            {incomeAdjustments.map((row, index) => (
                              <Stack gap={0} key={`income-${index}`}>
                                <Text size="sm">
                                  {String(row.budget_category_name ?? `#${row.budget_category_id}`)}: {formatJournalHistoryAmount(Number(row.amount ?? 0), locale)} {String(row.currency ?? "JPY")} · {t(adjustmentKeys[String(row.adjustment_type)] ?? "journalHistoryAllocation")}
                                </Text>
                                {row.note != null && String(row.note).length > 0 && <Text size="xs" c="dimmed">{String(row.note)}</Text>}
                              </Stack>
                            ))}
                          </Stack>
                        )}
                        {fundingAllocations.length > 0 && (
                          <Stack gap={4}>
                            <Text size="sm" fw={600}>{t("journalHistoryBudgetFunding")}</Text>
                            {fundingAllocations.map((row, index) => (
                              <Text size="sm" key={`funding-${index}`}>
                                {t(fundingKeys[String(row.kind)] ?? "journalHistoryBorrow")} · {row.budget_category_name ? String(row.budget_category_name) : t("journalHistoryUnallocated")}: {formatJournalHistoryAmount(Number(row.amount ?? 0), locale)} {String(row.currency ?? "JPY")}
                              </Text>
                            ))}
                          </Stack>
                        )}
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                </Accordion>
              )}
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Stack>
    </Paper>
  );
}

export default function JournalHistoryPage() {
  const { t } = useLang();
  const [entries, setEntries] = useState<JournalDeletionCandidate[]>([]);
  const [total, setTotal] = useState(0);
  const [retentionLimit, setRetentionLimit] = useState(100);
  const [draftLimit, setDraftLimit] = useState<number | string>(100);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [confirmReduce, setConfirmReduce] = useState(false);
  const loadRequestId = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    setLoading(true);
    setError(false);
    try {
      const result = await api.journalHistory.list(offset, PAGE_SIZE);
      if (requestId !== loadRequestId.current) return;
      setEntries(result.entries);
      setTotal(result.total);
      setRetentionLimit(result.retention_limit);
      setDraftLimit(result.retention_limit);
      if (offset >= result.total && offset > 0) {
        setOffset(Math.max(0, Math.floor((result.total - 1) / PAGE_SIZE) * PAGE_SIZE));
      }
    } catch {
      if (requestId === loadRequestId.current) setError(true);
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  }, [offset]);

  useEffect(() => { void load(); }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const validDraftLimit = typeof draftLimit === "number"
    && Number.isInteger(draftLimit)
    && draftLimit >= MIN_RETENTION
    && draftLimit <= MAX_RETENTION;

  async function saveLimit() {
    if (!validDraftLimit || typeof draftLimit !== "number") return;
    setSaving(true);
    try {
      const result = await api.journalHistory.updateSettings(draftLimit);
      setRetentionLimit(result.retention_limit);
      setTotal(result.total);
      setConfirmReduce(false);
      showFeedback({ message: t("journalHistorySaved"), color: "teal" });
      await load();
    } catch {
      showFeedback({ message: t("saveFailed"), color: "red" });
    } finally {
      setSaving(false);
    }
  }

  function requestSave() {
    if (!validDraftLimit || typeof draftLimit !== "number" || draftLimit === retentionLimit) return;
    if (draftLimit < total) {
      setConfirmReduce(true);
      return;
    }
    void saveLimit();
  }

  const oldestToRemove = validDraftLimit && typeof draftLimit === "number"
    ? Math.max(0, total - draftLimit)
    : 0;

  return (
    <Stack gap="lg">
      <Anchor component={Link} to="/settings" size="sm" c="dimmed">
        {t("settingsSubpageBack")}
      </Anchor>
      <Stack gap="xs">
        <Group gap="xs">
          <IconHistory size={22} />
          <Title order={3}>{t("journalHistoryTitle")}</Title>
        </Group>
        <Text size="sm" c="dimmed">{t("journalHistoryDescription")}</Text>
      </Stack>

      <Paper withBorder p="md" radius="sm">
        <Stack gap="sm">
          <Group align="flex-end" gap="sm" wrap="wrap">
            <NumberInput
              label={t("journalHistoryRetentionLimit")}
              description={t("journalHistoryRetentionInputHint")}
              min={MIN_RETENTION}
              max={MAX_RETENTION}
              step={1}
              allowDecimal={false}
              value={draftLimit}
              onChange={setDraftLimit}
              disabled={loading || saving || confirmReduce}
              w={220}
            />
              <Button onClick={requestSave} loading={saving} disabled={loading || saving || error || confirmReduce || !validDraftLimit || draftLimit === retentionLimit}>
              {t("journalHistorySave")}
            </Button>
          </Group>
          <Text size="xs" c="dimmed">{t("journalHistoryRetentionHint").replace("{limit}", String(retentionLimit))}</Text>
          <Group gap="xs">
            <Text size="sm">{t("journalHistoryCount").replace("{count}", String(total))}</Text>
            {loading && <Loader size="xs" aria-label={t("journalHistoryLoading")} />}
          </Group>
        </Stack>
      </Paper>

      {error && (
        <Alert color="red" icon={<IconAlertTriangle size={16} />} title={t("errorTitle")}>
          <Group justify="space-between" gap="xs">
            <Text size="sm">{t("journalHistoryLoadFailed")}</Text>
            <Button size="xs" variant="light" onClick={() => void load()}>{t("journalHistoryRetry")}</Button>
          </Group>
        </Alert>
      )}

      {loading && entries.length === 0
        ? <Stack gap="sm" aria-label={t("journalHistoryLoading")}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} height={96} radius="sm" />)}</Stack>
        : !error && entries.length === 0
          ? <Paper withBorder p="lg" radius="sm"><Text size="sm" c="dimmed">{t("journalHistoryEmpty")}</Text></Paper>
          : !error && (
            <Stack gap="sm">
              {entries.map(candidate => <HistoryCard key={candidate.id} candidate={candidate} />)}
            </Stack>
          )}

      {total > PAGE_SIZE && (
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Text size="sm" c="dimmed">
            {t("journalHistoryPage").replace("{page}", String(Math.floor(offset / PAGE_SIZE) + 1)).replace("{pages}", String(pageCount))}
          </Text>
          <Pagination
            total={pageCount}
            value={Math.floor(offset / PAGE_SIZE) + 1}
            onChange={page => setOffset((page - 1) * PAGE_SIZE)}
            disabled={saving}
            aria-label={t("journalHistoryPagination")}
          />
        </SimpleGrid>
      )}

      <ConfirmModal
        opened={confirmReduce}
        onClose={() => setConfirmReduce(false)}
        onConfirm={() => void saveLimit()}
        title={t("journalHistoryReduceConfirmTitle")}
        message={t("journalHistoryReduceConfirmMessage").replace("{count}", String(oldestToRemove))}
        confirmLabel={t("journalHistorySave")}
        loading={saving}
      />
    </Stack>
  );
}
