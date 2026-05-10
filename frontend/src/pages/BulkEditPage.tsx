import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import {
  IconAlertTriangle,
  IconArrowsExchange,
  IconTrash,
} from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import {
  type AccountOption,
  renderAccountOption,
} from "../components/SimpleEntryForm";
import { useAppData } from "../context/AppDataContext";
import { useLang } from "../i18n";
import {
  categoryIndex,
  systemAccountTranslationKey,
} from "../lib/accountUtils";
import { showFeedback } from "../lib/feedback";
import { formatJPY } from "../lib/numberFormat";
import type { Account, JournalEntry } from "@balance-sheet/shared";
import dayjs from "dayjs";

type SelectData = AccountOption | { group: string; items: AccountOption[] };
const typeOrder: Account["type"][] = [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
];

// ── Shared entry list with checkboxes ──────────────────────────────────────
interface EntryListProps {
  entries: JournalEntry[];
  checkedIds: Set<number>;
  onToggle: (id: number) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  highlightAccountId?: number; // mark lines for this account
}

function EntryList({
  entries,
  checkedIds,
  onToggle,
  onSelectAll,
  onDeselectAll,
  highlightAccountId,
}: EntryListProps) {
  const { t, locale } = useLang();
  const allChecked = entries.length > 0 && checkedIds.size === entries.length;
  const someChecked = checkedIds.size > 0 && !allChecked;

  return (
    <Stack gap="xs">
      {/* Toolbar */}
      <Group justify="space-between">
        <Checkbox
          label={t("bulkSelectAll")}
          checked={allChecked}
          indeterminate={someChecked}
          onChange={() => (allChecked ? onDeselectAll() : onSelectAll())}
        />
        <Text size="sm" c="dimmed">
          {t("bulkSelectedCount")
            .replace("{selected}", String(checkedIds.size))
            .replace("{total}", String(entries.length))}
        </Text>
      </Group>

      <Divider />

      <Box
        mah="min(64vh, 720px)"
        pr={4}
        tabIndex={0}
        style={{
          overflowY: "auto",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
        }}
      >
        <Stack gap={6}>
          {entries.map((entry) => {
            const checked = checkedIds.has(entry.id);
            return (
              <Box
                key={entry.id}
                style={(theme) => ({
                  border: `1px solid ${checked ? theme.colors.blue[4] : theme.colors.gray[3]}`,
                  borderRadius: theme.radius.sm,
                  padding: theme.spacing.xs,
                  background: checked
                    ? "var(--mantine-color-blue-light)"
                    : undefined,
                  cursor: "pointer",
                })}
                onClick={() => onToggle(entry.id)}
              >
                <Group gap="xs" wrap="nowrap" align="flex-start">
                  <Checkbox
                    checked={checked}
                    onChange={() => onToggle(entry.id)}
                    onClick={(e) => e.stopPropagation()}
                    mt={2}
                  />
                  <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                    <Group gap="xs" wrap="nowrap">
                      <Badge size="xs" variant="outline" color="gray">
                        {entry.date}
                      </Badge>
                      <Text
                        size="sm"
                        fw={500}
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {entry.description}
                      </Text>
                    </Group>
                    <Table
                      withRowBorders={false}
                      horizontalSpacing={4}
                      verticalSpacing={1}
                      fz="xs"
                    >
                      <Table.Tbody>
                        {entry.lines.map((line) => {
                          const isHighlighted =
                            highlightAccountId != null &&
                            line.account_id === highlightAccountId;
                          return (
                            <Table.Tr key={line.id}>
                              <Table.Td
                                style={{ width: 28 }}
                                c={isHighlighted ? "orange.7" : "dimmed"}
                                fw={isHighlighted ? 700 : undefined}
                              >
                                {line.debit > 0 ? "DR" : "CR"}
                              </Table.Td>
                              <Table.Td
                                c={isHighlighted ? "orange.7" : undefined}
                                fw={isHighlighted ? 700 : undefined}
                              >
                                {line.account_name ?? String(line.account_id)}
                              </Table.Td>
                              <Table.Td
                                className="currency-cell"
                                style={{ width: 100 }}
                                c={isHighlighted ? "orange.7" : undefined}
                                fw={isHighlighted ? 700 : undefined}
                              >
                                {formatJPY(
                                  line.debit > 0 ? line.debit : line.credit,
                                  locale,
                                )}
                              </Table.Td>
                            </Table.Tr>
                          );
                        })}
                      </Table.Tbody>
                    </Table>
                  </Stack>
                </Group>
              </Box>
            );
          })}
        </Stack>
      </Box>
    </Stack>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function BulkEditPage() {
  const { t } = useLang();
  const { accounts, refresh } = useAppData();

  // Replace tab
  const [fromAccountId, setFromAccountId] = useState<string | null>(null);
  const [toAccountId, setToAccountId] = useState<string | null>(null);
  const [replaceEntries, setReplaceEntries] = useState<JournalEntry[]>([]);
  const [replaceChecked, setReplaceChecked] = useState<Set<number>>(new Set());
  const [replaceLoading, setReplaceLoading] = useState(false);
  const [replaceConfirmOpen, setReplaceConfirmOpen] = useState(false);
  const [replacePreviewDone, setReplacePreviewDone] = useState(false);

  // Delete tab
  const [delAccountId, setDelAccountId] = useState<string | null>(null);
  const [delDateFrom, setDelDateFrom] = useState<Date | null>(null);
  const [delDateTo, setDelDateTo] = useState<Date | null>(null);
  const [delDescription, setDelDescription] = useState("");
  const [deleteEntries, setDeleteEntries] = useState<JournalEntry[]>([]);
  const [deleteChecked, setDeleteChecked] = useState<Set<number>>(new Set());
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletePreviewDone, setDeletePreviewDone] = useState(false);

  const typeLabelKey = {
    asset: "sectionAssets",
    liability: "sectionLiabilities",
    equity: "sectionEquity",
    income: "sectionIncome",
    expense: "sectionExpenses",
  } as const satisfies Record<Account["type"], Parameters<typeof t>[0]>;

  const resolveAccountLabel = (account: Account) => {
    if (account.is_system) {
      const key = systemAccountTranslationKey(account.name);
      if (key) return t(key);
    }
    return account.name;
  };

  const toAccountOption = (account: Account): AccountOption => ({
    value: String(account.id),
    label: resolveAccountLabel(account),
    category: account.category,
    is_system: account.is_system ?? false,
  });

  const sortAccounts = (a: Account, b: Account) => {
    if (a.type !== b.type) {
      return typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type);
    }
    const ai = categoryIndex(a.type, a.category, a.is_system ?? false);
    const bi = categoryIndex(b.type, b.category, b.is_system ?? false);
    return ai !== bi
      ? ai - bi
      : resolveAccountLabel(a).localeCompare(resolveAccountLabel(b), "ja");
  };

  const buildAccountGroups = (source: Account[]): SelectData[] => {
    const groups = new Map<Account["type"], AccountOption[]>();
    for (const account of [...source].sort(sortAccounts)) {
      const items = groups.get(account.type) ?? [];
      items.push(toAccountOption(account));
      groups.set(account.type, items);
    }
    return typeOrder.flatMap((type) => {
      const items = groups.get(type) ?? [];
      return items.length > 0 ? [{ group: t(typeLabelKey[type]), items }] : [];
    });
  };

  const filterSelectData = (
    data: SelectData[],
    predicate: (option: AccountOption) => boolean,
  ): SelectData[] => {
    const next: SelectData[] = [];
    for (const item of data) {
      if ("items" in item) {
        const items = item.items.filter(predicate);
        if (items.length > 0) next.push({ ...item, items });
      } else if (predicate(item)) {
        next.push(item);
      }
    }
    return next;
  };

  const accountOptions = buildAccountGroups(
    accounts.filter((a) => !a.is_system),
  );
  const allAccountOptions = buildAccountGroups(accounts);
  const replacementAccountOptions = filterSelectData(
    allAccountOptions,
    (o) => o.value !== fromAccountId,
  );

  const fromAccount = accounts.find((a) => String(a.id) === fromAccountId);
  const toAccount = accounts.find((a) => String(a.id) === toAccountId);

  // ── Replace handlers ────────────────────────────────────────────────────
  function resetReplace() {
    setReplaceEntries([]);
    setReplaceChecked(new Set());
    setReplacePreviewDone(false);
  }

  async function handleReplacePreview() {
    if (!fromAccountId || !toAccountId) return;
    setReplaceLoading(true);
    try {
      const res = await api.journal.bulkReplace({
        from_account_id: Number(fromAccountId),
        to_account_id: Number(toAccountId),
        dry_run: true,
      });
      const entries = res.entries ?? [];
      setReplaceEntries(entries);
      setReplaceChecked(new Set(entries.map((e) => e.id)));
      setReplacePreviewDone(true);
    } catch (e) {
      showFeedback({
        message: e instanceof Error ? e.message : String(e),
        color: "red",
      });
    } finally {
      setReplaceLoading(false);
    }
  }

  async function handleReplaceExecute() {
    if (!fromAccountId || !toAccountId) return;
    setReplaceLoading(true);
    try {
      const res = await api.journal.bulkReplace({
        from_account_id: Number(fromAccountId),
        to_account_id: Number(toAccountId),
        entry_ids: [...replaceChecked],
      });
      showFeedback({
        message: t("bulkReplaceSuccess").replace(
          "{count}",
          String(res.affected_lines),
        ),
        color: "teal",
      });
      setReplaceConfirmOpen(false);
      setFromAccountId(null);
      setToAccountId(null);
      resetReplace();
      refresh();
    } catch (e) {
      showFeedback({
        message: e instanceof Error ? e.message : String(e),
        color: "red",
      });
    } finally {
      setReplaceLoading(false);
    }
  }

  // ── Delete handlers ─────────────────────────────────────────────────────
  function hasDeleteCondition() {
    return !!(delAccountId || delDateFrom || delDateTo || delDescription);
  }

  function resetDelete() {
    setDeleteEntries([]);
    setDeleteChecked(new Set());
    setDeletePreviewDone(false);
  }

  async function handleDeletePreview() {
    if (!hasDeleteCondition()) {
      showFeedback({ message: t("bulkDeleteNoCondition"), color: "orange" });
      return;
    }
    setDeleteLoading(true);
    try {
      const res = await api.journal.bulkDelete({
        account_id: delAccountId ? Number(delAccountId) : undefined,
        date_from: delDateFrom
          ? dayjs(delDateFrom).format("YYYY-MM-DD")
          : undefined,
        date_to: delDateTo ? dayjs(delDateTo).format("YYYY-MM-DD") : undefined,
        description: delDescription || undefined,
        dry_run: true,
      });
      const entries = res.entries ?? [];
      setDeleteEntries(entries);
      setDeleteChecked(new Set(entries.map((e) => e.id)));
      setDeletePreviewDone(true);
    } catch (e) {
      showFeedback({
        message: e instanceof Error ? e.message : String(e),
        color: "red",
      });
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handleDeleteExecute() {
    setDeleteLoading(true);
    try {
      const res = await api.journal.bulkDelete({
        entry_ids: [...deleteChecked],
      });
      showFeedback({
        message: t("bulkDeleteSuccess").replace(
          "{count}",
          String(res.deleted_entries),
        ),
        color: "teal",
      });
      setDeleteConfirmOpen(false);
      setDelAccountId(null);
      setDelDateFrom(null);
      setDelDateTo(null);
      setDelDescription("");
      resetDelete();
      refresh();
    } catch (e) {
      showFeedback({
        message: e instanceof Error ? e.message : String(e),
        color: "red",
      });
    } finally {
      setDeleteLoading(false);
    }
  }

  // ── Checkbox helpers ────────────────────────────────────────────────────
  function toggleReplace(id: number) {
    setReplaceChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleDelete(id: number) {
    setDeleteChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <Stack gap="lg">
      <Group gap="xs">
        <Anchor component={Link} to="/settings" size="sm">
          {t("backToSettings")}
        </Anchor>
      </Group>

      <Title order={3}>{t("bulkEditPageTitle")}</Title>
      <Text size="sm" c="dimmed">
        {t("bulkEditSectionDesc")}
      </Text>

      <Tabs defaultValue="replace">
        <Tabs.List>
          <Tabs.Tab
            value="replace"
            leftSection={<IconArrowsExchange size={14} />}
          >
            {t("bulkReplaceTabLabel")}
          </Tabs.Tab>
          <Tabs.Tab value="delete" leftSection={<IconTrash size={14} />}>
            {t("bulkDeleteTabLabel")}
          </Tabs.Tab>
        </Tabs.List>

        {/* ── Replace tab ── */}
        <Tabs.Panel value="replace" pt="md">
          <Stack gap="md">
            <Group align="flex-end" gap="sm">
              <Select
                label={t("bulkReplaceFromLabel")}
                placeholder={t("selectAccount")}
                data={accountOptions}
                value={fromAccountId}
                onChange={(v) => {
                  setFromAccountId(v);
                  resetReplace();
                }}
                clearable
                w={220}
                renderOption={renderAccountOption as any}
              />
              <Select
                label={t("bulkReplaceToLabel")}
                placeholder={t("selectAccount")}
                data={replacementAccountOptions}
                value={toAccountId}
                onChange={(v) => {
                  setToAccountId(v);
                  resetReplace();
                }}
                clearable
                w={220}
                renderOption={renderAccountOption as any}
              />
              <Button
                variant="default"
                size="sm"
                loading={replaceLoading}
                disabled={!fromAccountId || !toAccountId}
                onClick={() => void handleReplacePreview()}
              >
                {t("bulkReplacePreviewBtn")}
              </Button>
            </Group>

            {replacePreviewDone && replaceEntries.length === 0 && (
              <Alert color="gray" variant="light">
                {t("bulkReplaceNoLines")}
              </Alert>
            )}

            {replaceEntries.length > 0 && (
              <>
                <EntryList
                  entries={replaceEntries}
                  checkedIds={replaceChecked}
                  onToggle={toggleReplace}
                  onSelectAll={() =>
                    setReplaceChecked(new Set(replaceEntries.map((e) => e.id)))
                  }
                  onDeselectAll={() => setReplaceChecked(new Set())}
                  highlightAccountId={
                    fromAccountId ? Number(fromAccountId) : undefined
                  }
                />
                <Group>
                  <Button
                    color="orange"
                    size="sm"
                    loading={replaceLoading}
                    disabled={replaceChecked.size === 0}
                    onClick={() => setReplaceConfirmOpen(true)}
                  >
                    {t("bulkReplaceExecBtn")}
                  </Button>
                </Group>
              </>
            )}
          </Stack>
        </Tabs.Panel>

        {/* ── Delete tab ── */}
        <Tabs.Panel value="delete" pt="md">
          <Stack gap="md">
            <Group align="flex-end" gap="sm" wrap="wrap">
              <Select
                label={t("bulkDeleteAccountLabel")}
                placeholder={t("selectAccount")}
                data={allAccountOptions}
                value={delAccountId}
                onChange={(v) => {
                  setDelAccountId(v);
                  resetDelete();
                }}
                searchable
                clearable
                w={200}
                renderOption={renderAccountOption as any}
              />
              <DateInput
                label={t("bulkDeleteDateFromLabel")}
                valueFormat="YYYY-MM-DD"
                value={delDateFrom}
                onChange={(v) => {
                  setDelDateFrom(v);
                  resetDelete();
                }}
                clearable
                w={160}
              />
              <DateInput
                label={t("bulkDeleteDateToLabel")}
                valueFormat="YYYY-MM-DD"
                value={delDateTo}
                onChange={(v) => {
                  setDelDateTo(v);
                  resetDelete();
                }}
                clearable
                w={160}
              />
              <TextInput
                label={t("bulkDeleteDescLabel")}
                value={delDescription}
                onChange={(e) => {
                  setDelDescription(e.currentTarget.value);
                  resetDelete();
                }}
                w={180}
              />
              <Button
                variant="default"
                size="sm"
                loading={deleteLoading}
                disabled={!hasDeleteCondition()}
                onClick={() => void handleDeletePreview()}
              >
                {t("bulkDeletePreviewBtn")}
              </Button>
            </Group>

            {deletePreviewDone && deleteEntries.length === 0 && (
              <Alert color="gray" variant="light">
                {t("bulkDeleteNoMatch")}
              </Alert>
            )}

            {deleteEntries.length > 0 && (
              <>
                <EntryList
                  entries={deleteEntries}
                  checkedIds={deleteChecked}
                  onToggle={toggleDelete}
                  onSelectAll={() =>
                    setDeleteChecked(new Set(deleteEntries.map((e) => e.id)))
                  }
                  onDeselectAll={() => setDeleteChecked(new Set())}
                  highlightAccountId={
                    delAccountId ? Number(delAccountId) : undefined
                  }
                />
                <Group>
                  <Button
                    color="red"
                    size="sm"
                    loading={deleteLoading}
                    disabled={deleteChecked.size === 0}
                    onClick={() => setDeleteConfirmOpen(true)}
                  >
                    {t("bulkDeleteExecBtn")}
                  </Button>
                </Group>
              </>
            )}
          </Stack>
        </Tabs.Panel>
      </Tabs>

      {/* ── Replace confirm modal ── */}
      <Modal
        opened={replaceConfirmOpen}
        onClose={() => setReplaceConfirmOpen(false)}
        title={
          <Group gap="xs">
            <IconAlertTriangle
              size={18}
              color="var(--mantine-color-orange-6)"
            />
            <Text fw={600}>{t("bulkReplaceConfirmTitle")}</Text>
          </Group>
        }
        centered
      >
        <Stack gap="md">
          <Alert color="orange" variant="light">
            <Text size="sm">
              {t("bulkReplaceConfirmBody")
                .replace("{from}", fromAccount?.name ?? "")
                .replace("{to}", toAccount?.name ?? "")}
            </Text>
            <Text size="sm" mt={4} fw={600}>
              {t("bulkSelectedCount")
                .replace("{selected}", String(replaceChecked.size))
                .replace("{total}", String(replaceEntries.length))}{" "}
              {t("bulkReplaceConfirmSuffix")}
            </Text>
          </Alert>
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => setReplaceConfirmOpen(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              color="orange"
              loading={replaceLoading}
              onClick={() => void handleReplaceExecute()}
            >
              {t("confirm")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* ── Delete confirm modal ── */}
      <Modal
        opened={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title={
          <Group gap="xs">
            <IconAlertTriangle size={18} color="var(--mantine-color-red-6)" />
            <Text fw={600} c="red">
              {t("bulkDeleteConfirmTitle")}
            </Text>
          </Group>
        }
        centered
      >
        <Stack gap="md">
          <Alert
            color="red"
            variant="filled"
            icon={<IconAlertTriangle size={16} />}
          >
            <Text size="sm" fw={500}>
              {t("bulkDeleteConfirmBody")}
            </Text>
          </Alert>
          <Text size="sm" fw={600} c="red">
            {t("bulkDeletePreviewMsg").replace(
              "{count}",
              String(deleteChecked.size),
            )}
          </Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => setDeleteConfirmOpen(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              color="red"
              loading={deleteLoading}
              onClick={() => void handleDeleteExecute()}
            >
              {t("confirm")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
