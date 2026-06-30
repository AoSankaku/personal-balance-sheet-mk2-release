import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Modal,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import {
  IconArrowDown,
  IconArrowUp,
  IconArrowsSort,
  IconDeviceFloppy,
  IconFileSpreadsheet,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { CreateJournalInput } from "@balance-sheet/shared";
import type { StoreAccountMapping } from "@balance-sheet/shared";
import { api } from "../api/client";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import { type SimpleFormDraft } from "./SimpleEntryForm";
import { showFeedback } from "../lib/feedback";
import {
  parseCSVFile,
  isBankFormat,
  type ParseResult,
  type CsvFormat,
  type ParsedTransaction,
} from "../utils/csvParser";
import {
  FORMAT_LABELS,
  normalizeStore,
  isAmazonTransaction,
  hasAmazon,
  findDuplicateEntries,
  buildGroupedExpenseOptions,
  buildGroupedIncomeOptions,
  buildGroupedLiabilityOptions,
  buildGroupedAssetOptions,
  mergeUniqueOptionGroups,
} from "../utils/csvInputUtils";
import {
  csvDraft,
  setCsvDraft,
  setBulkDraft,
  setSimpleDraft,
  type WithdrawalRowType,
  type CsvRowState,
  type BulkExpenseRow,
} from "../utils/inputDrafts";
import { countMissingCounterAccountWarnings } from "../utils/csvImportWarnings";
import {
  accountDisplayNameFromName,
  isUserSelectableAccount,
  toAccountSelectOption,
} from "../lib/accountUtils";
import { renderAccountOption } from "../lib/accountSelect";

type SortCol = "date" | "store";
type SortDir = "asc" | "desc";

export function CsvImportTab({
  onImportDone,
  onSwitchToBulk,
  onSwitchToSimple,
}: {
  onImportDone: () => void;
  onSwitchToBulk: () => void;
  onSwitchToSimple: () => void;
}) {
  const { t } = useLang();
  const { accounts, journal, budgetCategories } = useAppData();

  const [parseResult, setParseResult] = useState<ParseResult | null>(
    csvDraft.parseResult,
  );
  const [manualFormat, setManualFormat] = useState<CsvFormat | null>(
    csvDraft.manualFormat,
  );
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    csvDraft.selectedAccountId,
  );
  const [rowStates, setRowStates] = useState<CsvRowState[]>(csvDraft.rowStates);
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [importing, setImporting] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [duplicateIndices, setDuplicateIndices] = useState<number[]>([]);
  const [duplicateDecisions, setDuplicateDecisions] = useState<
    Record<number, "skip" | "import">
  >({});
  const [showEmptyRowsModal, setShowEmptyRowsModal] = useState(false);
  const [emptyRowCount, setEmptyRowCount] = useState(0);
  const [pendingDecisions, setPendingDecisions] = useState<
    Record<number, "skip" | "import">
  >({});

  // Store mappings
  const [storeMappings, setStoreMappings] = useState<StoreAccountMapping[]>([]);
  const [overwriteTarget, setOverwriteTarget] = useState<{
    storeKey: string;
    accountId: string;
    rowType: WithdrawalRowType;
    existingMapping: StoreAccountMapping;
  } | null>(null);

  useEffect(() => {
    void api.storeMappings
      .list()
      .then(setStoreMappings)
      .catch(() => {});
  }, []);

  // Persist draft
  useEffect(() => {
    setCsvDraft({ parseResult, manualFormat, selectedAccountId, rowStates });
  }, [parseResult, manualFormat, selectedAccountId, rowStates]);

  const bankAccounts = accounts.filter(
    (a) => a.type === "asset" && isUserSelectableAccount(a),
  );
  const creditCardAccounts = accounts.filter(
    (a) =>
      a.type === "liability" &&
      a.category === "credit_card" &&
      isUserSelectableAccount(a),
  );

  const groupedExpenseOpts = buildGroupedExpenseOptions(
    accounts,
    t("groupExpenseAccounts"),
    t("catLending"),
  );
  const groupedIncomeOpts = buildGroupedIncomeOptions(
    accounts,
    t("groupIncomeAccounts"),
  );
  const groupedLiabilityOpts = buildGroupedLiabilityOptions(
    accounts,
    t("groupLiabilityAccounts"),
  );
  const groupedAssetOpts = buildGroupedAssetOptions(
    accounts,
    t("importGroupAssetTransferAccounts"),
    selectedAccountId,
  );

  const cardOptions = creditCardAccounts.map((a) => toAccountSelectOption(a, t));
  const bankOptions = bankAccounts.map((a) => toAccountSelectOption(a, t));
  const budgetCategoryOptions = budgetCategories.map((cat) => ({
    value: String(cat.id),
    label: cat.name,
  }));

  const transactions: ParsedTransaction[] = parseResult?.transactions ?? [];
  const effectiveFormat: CsvFormat =
    manualFormat ?? parseResult?.format ?? "unknown";
  const isBankImport = isBankFormat(effectiveFormat);

  function applyStoreMappingsToRows(
    txs: ParsedTransaction[],
    mappings: StoreAccountMapping[],
  ): CsvRowState[] {
    const mappingMap = new Map(
      mappings.map((m) => [normalizeStore(m.store_name), m]),
    );
    return txs.map((tx) => {
      const key = normalizeStore(tx.store);
      const mapping = mappingMap.get(key);
      return {
        counterAccountId: mapping ? String(mapping.account_id) : null,
        budgetCategoryId: null,
        rowType:
          tx.direction === "withdrawal" && tx.store.includes("口座振替")
            ? ("liability" as const)
            : ("expense" as const),
        skip: false,
        note: tx.store,
      };
    });
  }

  async function handleFileSelect(file: File | null) {
    if (!file) return;
    try {
      const result = await parseCSVFile(file);
      setParseResult(result);
      setManualFormat(null);
      const mappings = await api.storeMappings
        .list()
        .catch(() => storeMappings);
      setStoreMappings(mappings);
      setRowStates(applyStoreMappingsToRows(result.transactions, mappings));
    } catch {
      showFeedback({
        message: "ファイルの読み込みに失敗しました",
        color: "red",
      });
    }
  }

  function setRowCounter(idx: number, value: string | null) {
    setRowStates((prev) => {
      const next = [...prev];
      const counterAccount = value
        ? accounts.find((a) => String(a.id) === value)
        : null;
      next[idx] = {
        ...next[idx]!,
        counterAccountId: value,
        budgetCategoryId:
          counterAccount?.type === "income" &&
          counterAccount.category !== "salary"
            ? (next[idx]?.budgetCategoryId ?? null)
            : null,
      };
      return next;
    });
  }

  function setRowBudgetCategory(idx: number, value: string | null) {
    setRowStates((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx]!, budgetCategoryId: value };
      return next;
    });
  }

  function setRowType(idx: number, value: WithdrawalRowType) {
    setRowStates((prev) => {
      const next = [...prev];
      next[idx] = {
        ...next[idx]!,
        rowType: value,
        counterAccountId: null,
        budgetCategoryId: null,
      };
      return next;
    });
  }

  function setRowNote(idx: number, value: string) {
    setRowStates((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx]!, note: value };
      return next;
    });
  }

  async function saveStoreMapping(
    storeKey: string,
    accountId: string,
    rowType: WithdrawalRowType,
    force = false,
  ) {
    const normalizedKey = normalizeStore(storeKey);
    const existing = storeMappings.find(
      (m) => normalizeStore(m.store_name) === normalizedKey,
    );
    if (existing && existing.account_id !== Number(accountId) && !force) {
      setOverwriteTarget({
        storeKey,
        accountId,
        rowType,
        existingMapping: existing,
      });
      return;
    }
    try {
      const saved = await api.storeMappings.upsert({
        store_name: normalizedKey,
        account_id: Number(accountId),
      });
      setStoreMappings((prev) => {
        const next = prev.filter(
          (m) => normalizeStore(m.store_name) !== normalizedKey,
        );
        return [...next, saved];
      });
      showFeedback({ message: t("storeMappingSaved"), color: "teal" });
      applyToAllSameStore(storeKey, accountId, rowType);
    } catch {
      showFeedback({ message: t("saveFailed"), color: "red" });
    }
  }

  function applyToAllSameStore(
    storeKey: string,
    accountId: string | null,
    rowType: WithdrawalRowType,
  ) {
    const normalizedKey = normalizeStore(storeKey);
    setRowStates((prev) =>
      prev.map((rs, i) => {
        const tx = transactions[i];
        if (!tx) return rs;
        if (normalizeStore(tx.store) === normalizedKey) {
          return {
            ...rs,
            counterAccountId: accountId,
            rowType,
            note: tx.store,
          };
        }
        return rs;
      }),
    );
  }

  function toggleSort(col: SortCol) {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  const sortedIndices = useMemo(() => {
    const indices = transactions.map((_, i) => i);
    if (!sortCol) return indices;
    return [...indices].sort((a, b) => {
      const txA = transactions[a]!;
      const txB = transactions[b]!;
      const valA =
        sortCol === "date" ? txA.date : (rowStates[a]?.note ?? txA.store);
      const valB =
        sortCol === "date" ? txB.date : (rowStates[b]?.note ?? txB.store);
      const cmp = valA.localeCompare(valB, "ja");
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [transactions, sortCol, sortDir, rowStates]);

  const accountId = selectedAccountId ? Number(selectedAccountId) : null;

  const duplicateMatches = useMemo(() => {
    if (!accountId)
      return new Map<number, ReturnType<typeof useAppData>["journal"]>();
    const matches = new Map<number, ReturnType<typeof useAppData>["journal"]>();
    transactions.forEach((tx, i) => {
      const entries = findDuplicateEntries(tx, accountId, journal);
      if (entries.length > 0) matches.set(i, entries);
    });
    return matches;
  }, [transactions, accountId, journal]);

  function isSalaryPendingRow(
    tx: ParsedTransaction,
    rowState: CsvRowState | undefined,
  ) {
    if (
      !isBankImport ||
      tx.direction !== "deposit" ||
      !rowState?.counterAccountId
    ) {
      return false;
    }
    const account = accounts.find(
      (a) => a.id === Number(rowState.counterAccountId),
    );
    return account?.type === "income" && account.category === "salary";
  }

  const importableCount = transactions.filter(
    (tx, i) =>
      !isAmazonTransaction(tx.store) &&
      !isSalaryPendingRow(tx, rowStates[i]) &&
      rowStates[i]?.counterAccountId &&
      !rowStates[i]?.skip,
  ).length;

  const amazonCount = transactions.filter((tx) =>
    isAmazonTransaction(tx.store),
  ).length;
  const salaryHoldCount = transactions.filter((tx, i) =>
    isSalaryPendingRow(tx, rowStates[i]),
  ).length;

  const noAccountsForFormat = isBankImport
    ? bankAccounts.length === 0
    : creditCardAccounts.length === 0;

  function buildSalarySimpleDraft(
    salaryRows: { tx: ParsedTransaction; rowState: CsvRowState }[],
  ): SimpleFormDraft | null {
    if (!accountId || salaryRows.length === 0) return null;

    const totalAmount = salaryRows.reduce((sum, row) => sum + row.tx.amount, 0);
    const latestDate = [...salaryRows]
      .sort((a, b) => a.tx.date.localeCompare(b.tx.date))
      .at(-1)?.tx.date;
    const descriptions = Array.from(
      new Set(
        salaryRows
          .map(({ tx, rowState }) => {
            const note = rowState.note.trim();
            return note === "" ? tx.store.trim() : note;
          })
          .filter((value) => value !== ""),
      ),
    );
    const firstIncomeAccountId = Number(
      salaryRows[0]!.rowState.counterAccountId,
    );
    const allSameIncomeAccount = salaryRows.every(
      ({ rowState }) =>
        Number(rowState.counterAccountId) === firstIncomeAccountId,
    );

    const incomeDistMap = new Map<number, number>();
    for (const { tx, rowState } of salaryRows) {
      if (!rowState.budgetCategoryId) continue;
      const categoryId = Number(rowState.budgetCategoryId);
      incomeDistMap.set(
        categoryId,
        (incomeDistMap.get(categoryId) ?? 0) + tx.amount,
      );
    }

    return {
      formValues: {
        date: latestDate ? dayjs(latestDate).toDate() : new Date(),
        description:
          descriptions.length === 1 ? descriptions[0]! : t("catSalary"),
        entryType: "income",
        incomeTypeId: allSameIncomeAccount ? firstIncomeAccountId : null,
        incomeDepositedToId: accountId,
        amount: totalAmount,
      },
      budgetDist: [],
      showZeroCategories: false,
      incomeDist: Array.from(incomeDistMap.entries())
        .map(([budget_category_id, amount]) => ({
          budget_category_id,
          name:
            budgetCategories.find((cat) => cat.id === budget_category_id)
              ?.name ?? `#${budget_category_id}`,
          amount,
        }))
        .sort((a, b) => b.amount - a.amount),
      isRegularIncome: true,
      selectedFilterId: null,
      filterStepPreview: [],
    };
  }

  function buildBudgetAllocations(
    counterAccId: number,
    amount: number,
    sign: 1 | -1 = -1,
  ): { budget_category_id: number; amount: number }[] {
    const acc = accounts.find((a) => a.id === counterAccId);
    if (!acc || acc.type !== "expense" || !acc.budget_ratios?.length) return [];
    return acc.budget_ratios
      .filter((r) => r.ratio > 0)
      .map((r) => ({
        budget_category_id: r.budget_category_id,
        amount: sign * Math.round(amount * (r.ratio / 100)),
      }));
  }

  const handleImportClick = useCallback(() => {
    if (!accountId) return;

    const emptyRows = countMissingCounterAccountWarnings(
      transactions.map((tx, i) => ({
        isAmazon: isAmazonTransaction(tx.store),
        isSalaryPending: isSalaryPendingRow(tx, rowStates[i]),
        hasCounterAccount: Boolean(rowStates[i]?.counterAccountId),
        isPossibleDuplicate: duplicateMatches.has(i),
      })),
    );

    const dupRows: number[] = [];
    transactions.forEach((tx, i) => {
      if (isAmazonTransaction(tx.store)) return;
      if (isSalaryPendingRow(tx, rowStates[i])) return;
      if (rowStates[i]?.counterAccountId && duplicateMatches.has(i)) {
        dupRows.push(i);
      }
    });

    if (emptyRows > 0) {
      setEmptyRowCount(emptyRows);
      if (dupRows.length > 0) {
        setDuplicateIndices(dupRows);
        const initialDecisions: Record<number, "skip" | "import"> = {};
        dupRows.forEach((i) => (initialDecisions[i] = "skip"));
        setPendingDecisions(initialDecisions);
      }
      setShowEmptyRowsModal(true);
    } else if (dupRows.length > 0) {
      setDuplicateIndices(dupRows);
      const initialDecisions: Record<number, "skip" | "import"> = {};
      dupRows.forEach((i) => (initialDecisions[i] = "skip"));
      setDuplicateDecisions(initialDecisions);
      setShowDuplicateModal(true);
    } else {
      void executeImport({});
    }
  }, [transactions, rowStates, duplicateMatches, accountId]);

  async function executeImport(decisions: Record<number, "skip" | "import">) {
    if (!accountId) return;
    setImporting(true);
    try {
      const entries: CreateJournalInput[] = [];
      const amazonRows: ParsedTransaction[] = [];
      const salaryRows: { tx: ParsedTransaction; rowState: CsvRowState }[] = [];

      transactions.forEach((tx, i) => {
        if (isAmazonTransaction(tx.store)) {
          amazonRows.push(tx);
          return;
        }
        const rs = rowStates[i];
        if (!rs?.counterAccountId) return;
        if (isSalaryPendingRow(tx, rs)) {
          salaryRows.push({ tx, rowState: rs });
          return;
        }
        if (duplicateMatches.has(i) && (decisions[i] ?? "skip") === "skip") {
          return;
        }
        const counterAccId = Number(rs.counterAccountId);
        const counterAcc = accounts.find((a) => a.id === counterAccId);
        const isDeposit = tx.direction === "deposit";
        const budget_allocations =
          counterAcc?.type === "expense"
            ? buildBudgetAllocations(
                counterAccId,
                tx.amount,
                isDeposit ? 1 : -1,
              )
            : undefined;
        const income_budget_allocations =
          isDeposit && counterAcc?.type === "income" && rs.budgetCategoryId
            ? [
                {
                  budget_category_id: Number(rs.budgetCategoryId),
                  amount: tx.amount,
                },
              ]
            : undefined;
        entries.push({
          date: tx.date,
          description: rs.note.trim() === "" ? tx.store : rs.note,
          lines: isDeposit
            ? [
                { account_id: accountId, debit: tx.amount, credit: 0 },
                { account_id: counterAccId, debit: 0, credit: tx.amount },
              ]
            : [
                { account_id: counterAccId, debit: tx.amount, credit: 0 },
                { account_id: accountId, debit: 0, credit: tx.amount },
              ],
          budget_allocations:
            budget_allocations && budget_allocations.length > 0
              ? budget_allocations
              : undefined,
          income_budget_allocations,
          budget_source: "simple",
        });
      });

      if (
        entries.length === 0 &&
        amazonRows.length === 0 &&
        salaryRows.length === 0
      ) {
        showFeedback({
          message: "インポートする取引がありません",
          color: "yellow",
        });
        return;
      }

      if (entries.length > 0) {
        await api.journal.batchCreate({ entries });
      }

      // Clear CSV draft after successful import
      setCsvDraft({
        parseResult: null,
        manualFormat: null,
        selectedAccountId: null,
        rowStates: [],
      });
      setParseResult(null);
      setRowStates([]);
      setSelectedAccountId(null);

      if (amazonRows.length > 0) {
        setBulkDraft({
          paymentAccountId: selectedAccountId!,
          rows: [
            {
              type: "expense",
              date: new Date(),
              itemName: "",
              qty: 1,
              price: 0,
              expenseAccountId: null,
            } satisfies BulkExpenseRow,
          ],
          billingRows: amazonRows.map((tx) => ({
            label: `${tx.store} ${tx.date}`,
            amount: String(tx.amount),
          })),
        });
      }

      const salaryDraft = buildSalarySimpleDraft(salaryRows);

      if (salaryDraft) {
        setSimpleDraft(salaryDraft);
        showFeedback({
          message: t(
            amazonRows.length > 0
              ? "importSalaryAndAmazonSwitched"
              : "importSalarySwitched",
          ),
          color: "blue",
        });
        onSwitchToSimple();
      } else if (amazonRows.length > 0) {
        showFeedback({ message: t("importAmazonSwitched"), color: "blue" });
        onSwitchToBulk();
      } else {
        showFeedback({ message: t("importSuccess"), color: "teal" });
        onImportDone();
      }
    } catch {
      showFeedback({ message: "インポートに失敗しました", color: "red" });
    } finally {
      setImporting(false);
    }
  }

  function resetRowNote(idx: number) {
    setRowStates((prev) => {
      const next = [...prev];
      const tx = transactions[idx];
      if (!tx) return prev;
      next[idx] = { ...next[idx]!, note: tx.store };
      return next;
    });
  }

  const showAmazonHint = hasAmazon(transactions);

  return (
    <Stack gap="lg">
      {/* Upload section */}
      <Paper withBorder p="lg" radius="md">
        <Stack gap="md">
          <Text fw={500}>{t("importUploadLabel")}</Text>
          <Dropzone
            onDrop={(files) => void handleFileSelect(files[0] ?? null)}
            onReject={() =>
              showFeedback({
                message: "CSVファイルを選択してください",
                color: "red",
              })
            }
            accept={{ "text/csv": [".csv"], "text/plain": [".csv"] }}
            maxFiles={1}
            multiple={false}
          >
            <Group
              justify="center"
              gap="xl"
              mih={80}
              style={{ pointerEvents: "none" }}
            >
              <Dropzone.Accept>
                <IconUpload
                  size={36}
                  stroke={1.5}
                  color="var(--mantine-color-blue-6)"
                />
              </Dropzone.Accept>
              <Dropzone.Reject>
                <IconX
                  size={36}
                  stroke={1.5}
                  color="var(--mantine-color-red-6)"
                />
              </Dropzone.Reject>
              <Dropzone.Idle>
                <IconFileSpreadsheet
                  size={36}
                  stroke={1.5}
                  color="var(--mantine-color-dimmed)"
                />
              </Dropzone.Idle>
              <Stack gap={4}>
                <Text size="sm" fw={500}>
                  CSVファイルをドロップ、またはクリックして選択
                </Text>
                <Text size="xs" c="dimmed">
                  .csv ファイルのみ対応
                </Text>
              </Stack>
            </Group>
          </Dropzone>
          {parseResult && (
            <Badge
              color={parseResult.format === "unknown" ? "gray" : "teal"}
              size="lg"
            >
              {t("importDetectedFormat")}:{" "}
              {FORMAT_LABELS[effectiveFormat] ?? effectiveFormat}
            </Badge>
          )}

          {parseResult?.format === "unknown" && (
            <Select
              label={t("importSelectFormat")}
              data={[
                { value: "smbc-draft", label: t("importFormatSmbcDraft") },
                {
                  value: "smbc-confirmed",
                  label: t("importFormatSmbcConfirmed"),
                },
                {
                  value: "rakuten-draft",
                  label: t("importFormatRakutenDraft"),
                },
                {
                  value: "rakuten-confirmed",
                  label: t("importFormatRakutenConfirmed"),
                },
                {
                  value: "smbc-bank",
                  label: t("importFormatSmbcBank"),
                },
                { value: "sbi-bank", label: t("importFormatSbiBank") },
              ]}
              value={manualFormat}
              onChange={(v) => setManualFormat(v as CsvFormat | null)}
              clearable
            />
          )}

          {parseResult && transactions.length > 0 && (
            <Text size="sm" c="dimmed">
              {transactions.length} {t("importTransactionCount")}
            </Text>
          )}

          {noAccountsForFormat && parseResult && (
            <Alert color="yellow">
              {isBankImport
                ? t("importNoBankAccounts")
                : t("importNoCardAccounts")}
            </Alert>
          )}
        </Stack>
      </Paper>

      {/* Review section */}
      {transactions.length > 0 && (
        <Paper withBorder p="lg" radius="md">
          <Stack gap="md">
            <Title order={5}>{t("importReviewTitle")}</Title>

            {showAmazonHint && (
              <Alert color="blue" title={t("importAmazonHint")}>
                <Anchor
                  href="https://www.amazon.co.jp/cpe/yourpayments/transactions"
                  target="_blank"
                  size="sm"
                >
                  https://www.amazon.co.jp/cpe/yourpayments/transactions
                </Anchor>
              </Alert>
            )}

            {isBankImport ? (
              <Select
                label={t("importSelectBankAccount")}
                data={bankOptions}
                renderOption={renderAccountOption as never}
                value={selectedAccountId}
                onChange={setSelectedAccountId}
                required
                searchable
              />
            ) : (
              <Select
                label={t("importSelectCard")}
                data={cardOptions}
                renderOption={renderAccountOption as never}
                value={selectedAccountId}
                onChange={setSelectedAccountId}
                required
                searchable
              />
            )}

            <Divider />

            <ScrollArea>
              <Table
                striped
                highlightOnHover
                withTableBorder
                style={{
                  width: 830,
                  minWidth: 830,
                  tableLayout: "fixed",
                }}
              >
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th style={{ width: 110, minWidth: 110 }}>
                      <UnstyledButton
                        onClick={() => toggleSort("date")}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          fontWeight: 600,
                          fontSize: "var(--mantine-font-size-sm)",
                        }}
                      >
                        {t("importDateCol")}
                        {sortCol === "date" ? (
                          sortDir === "asc" ? (
                            <IconArrowUp size={14} />
                          ) : (
                            <IconArrowDown size={14} />
                          )
                        ) : (
                          <IconArrowsSort size={14} opacity={0.4} />
                        )}
                      </UnstyledButton>
                    </Table.Th>
                    <Table.Th style={{ width: 300, minWidth: 300 }}>
                      <UnstyledButton
                        onClick={() => toggleSort("store")}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          fontWeight: 600,
                          fontSize: "var(--mantine-font-size-sm)",
                        }}
                      >
                        {t("importStoreCol")}
                        {sortCol === "store" ? (
                          sortDir === "asc" ? (
                            <IconArrowUp size={14} />
                          ) : (
                            <IconArrowDown size={14} />
                          )
                        ) : (
                          <IconArrowsSort size={14} opacity={0.4} />
                        )}
                      </UnstyledButton>
                    </Table.Th>
                    {isBankImport && (
                      <Table.Th style={{ width: 120, minWidth: 120 }}>
                        {t("importDirectionWithdrawal")}/
                        {t("importDirectionDeposit")}
                      </Table.Th>
                    )}
                    <Table.Th
                      className="currency-cell"
                      style={{ width: 88, minWidth: 88 }}
                    >
                      {t("importAmountCol")}
                    </Table.Th>
                    {!isBankImport && (
                      <Table.Th style={{ width: 80, minWidth: 80 }}>
                        {t("importPaymentMonthCol")}
                      </Table.Th>
                    )}
                    <Table.Th style={{ width: 260, minWidth: 260 }}>
                      {isBankImport
                        ? `${t("importExpenseAccount")} / ${t("importIncomeAccount")}`
                        : t("importExpenseAccount")}
                    </Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {sortedIndices.map((i) => {
                    const tx = transactions[i]!;
                    const rs = rowStates[i];
                    const duplicateEntries = duplicateMatches.get(i) ?? [];
                    const isDup = duplicateEntries.length > 0;
                    const isDeposit = tx.direction === "deposit";
                    const effectiveRowType = rs?.rowType ?? "expense";
                    const selectedCounterAccount = rs?.counterAccountId
                      ? accounts.find(
                          (a) => a.id === Number(rs.counterAccountId),
                        )
                      : null;
                    const showIncomeBudgetCategory =
                      isDeposit &&
                      isBankImport &&
                      selectedCounterAccount?.type === "income" &&
                      selectedCounterAccount.category !== "salary";

                    let counterOptions: ReturnType<
                      typeof mergeUniqueOptionGroups
                    >;
                    if (isDeposit) {
                      counterOptions = isBankImport
                        ? mergeUniqueOptionGroups(
                            groupedIncomeOpts,
                            groupedAssetOpts,
                          )
                        : mergeUniqueOptionGroups(
                            groupedExpenseOpts,
                            groupedAssetOpts,
                          );
                    } else if (effectiveRowType === "liability") {
                      counterOptions = groupedLiabilityOpts;
                    } else if (effectiveRowType === "transfer") {
                      counterOptions = groupedAssetOpts;
                    } else {
                      counterOptions = mergeUniqueOptionGroups(
                        groupedExpenseOpts,
                        groupedAssetOpts,
                      );
                    }

                    const counterPlaceholder = isDeposit
                      ? isBankImport
                        ? `${t("importIncomeAccount")}...`
                        : `${t("importExpenseAccount")}...`
                      : effectiveRowType === "liability"
                        ? `${t("importLiabilityAccount")}...`
                        : effectiveRowType === "transfer"
                          ? t("importRowTypeTransfer") + "..."
                          : t("importExpenseAccount") + "...";

                    return (
                      <Fragment key={i}>
                        <Table.Tr style={isDup ? { opacity: 0.7 } : undefined}>
                          <Table.Td style={{ width: 110, minWidth: 110 }}>
                            <Text size="xs" style={{ whiteSpace: "nowrap" }}>
                              {tx.date}
                            </Text>
                            {isDup && (
                              <Badge color="yellow" size="xs" mt={2}>
                                {t("importDuplicateWarning")}
                              </Badge>
                            )}
                          </Table.Td>
                          <Table.Td style={{ width: 300, minWidth: 300 }}>
                            <Group
                              gap={6}
                              wrap="nowrap"
                              align="flex-start"
                              style={{ width: "100%" }}
                            >
                              <TextInput
                                size="xs"
                                value={rs?.note ?? tx.store}
                                onChange={(e) =>
                                  setRowNote(i, e.currentTarget.value)
                                }
                                placeholder={tx.store}
                                styles={{
                                  input: {
                                    fontWeight:
                                      (rs?.note ?? tx.store) !== tx.store
                                        ? 600
                                        : undefined,
                                  },
                                }}
                                style={{ flex: 1, minWidth: 0 }}
                              />
                              <Button
                                size="compact-xs"
                                variant="subtle"
                                onClick={() => resetRowNote(i)}
                                disabled={(rs?.note ?? tx.store) === tx.store}
                              >
                                リセット
                              </Button>
                            </Group>
                          </Table.Td>
                          {isBankImport && (
                            <Table.Td style={{ width: 120, minWidth: 120 }}>
                              <Badge
                                color={isDeposit ? "teal" : "red"}
                                size="xs"
                                variant="light"
                              >
                                {isDeposit
                                  ? t("importDirectionDeposit")
                                  : t("importDirectionWithdrawal")}
                              </Badge>
                            </Table.Td>
                          )}
                          <Table.Td
                            className="currency-cell"
                            style={{ width: 88, minWidth: 88 }}
                          >
                            <Text
                              size="xs"
                              fw={600}
                              c={isBankImport && isDeposit ? "teal" : undefined}
                            >
                              ¥{tx.amount.toLocaleString()}
                            </Text>
                          </Table.Td>
                          {!isBankImport && (
                            <Table.Td style={{ width: 80, minWidth: 80 }}>
                              <Text size="xs">{tx.paymentMonth}</Text>
                            </Table.Td>
                          )}
                          <Table.Td style={{ width: 260, minWidth: 260 }}>
                            {isAmazonTransaction(tx.store) ? (
                              <Badge color="blue" variant="light" size="sm">
                                {t("importAmazonBulkBadge")}
                              </Badge>
                            ) : (
                              <>
                                {isBankImport && !isDeposit && (
                                  <Select
                                    size="xs"
                                    mb={4}
                                    data={[
                                      {
                                        value: "expense",
                                        label: t("importRowTypeExpense"),
                                      },
                                      {
                                        value: "liability",
                                        label: t("importRowTypeLiability"),
                                      },
                                      {
                                        value: "transfer",
                                        label: t("importRowTypeTransfer"),
                                      },
                                    ]}
                                    value={effectiveRowType}
                                    onChange={(v) =>
                                      setRowType(i, v as WithdrawalRowType)
                                    }
                                    searchable={false}
                                  />
                                )}
                                <Select
                                  size="xs"
                                  data={counterOptions}
                                  renderOption={renderAccountOption as never}
                                  value={rs?.counterAccountId ?? null}
                                  onChange={(v) => setRowCounter(i, v)}
                                  searchable={false}
                                  clearable
                                  placeholder={counterPlaceholder}
                                  onClick={(e) => e.stopPropagation()}
                                />
                                {showIncomeBudgetCategory && (
                                  <Select
                                    size="xs"
                                    mt={4}
                                    data={budgetCategoryOptions}
                                    value={rs?.budgetCategoryId ?? null}
                                    onChange={(v) => setRowBudgetCategory(i, v)}
                                    searchable={false}
                                    clearable
                                    placeholder={`${t("budgetCategoryLabel")}...`}
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                )}
                                {rs?.counterAccountId && (
                                  <Button
                                    size="compact-xs"
                                    variant="subtle"
                                    mt={2}
                                    leftSection={<IconDeviceFloppy size={12} />}
                                    onClick={() =>
                                      void saveStoreMapping(
                                        tx.store,
                                        rs.counterAccountId!,
                                        effectiveRowType,
                                      )
                                    }
                                  >
                                    {t("importApplyToAll")}
                                  </Button>
                                )}
                              </>
                            )}
                          </Table.Td>
                        </Table.Tr>
                        {isDup && (
                          <Table.Tr>
                            <Table.Td
                              colSpan={5}
                              style={{
                                background:
                                  "light-dark(var(--mantine-color-yellow-0), rgba(234,179,8,0.12))",
                              }}
                            >
                              <Stack gap={6}>
                                <Text size="xs" fw={600}>
                                  既存の仕訳候補
                                </Text>
                                <Table
                                  withTableBorder
                                  striped
                                  styles={{
                                    td: {
                                      fontSize: "var(--mantine-font-size-xs)",
                                    },
                                    th: {
                                      fontSize: "var(--mantine-font-size-xs)",
                                    },
                                  }}
                                >
                                  <Table.Thead>
                                    <Table.Tr>
                                      <Table.Th>日付</Table.Th>
                                      <Table.Th>摘要</Table.Th>
                                      <Table.Th className="currency-cell">
                                        借方
                                      </Table.Th>
                                      <Table.Th className="currency-cell">
                                        貸方
                                      </Table.Th>
                                    </Table.Tr>
                                  </Table.Thead>
                                  <Table.Tbody>
                                    {duplicateEntries.map((entry) => (
                                      <Table.Tr key={entry.id}>
                                        <Table.Td>{entry.date}</Table.Td>
                                        <Table.Td>{entry.description}</Table.Td>
                                        <Table.Td className="currency-cell">
                                          {entry.lines
                                            .filter((line) => line.debit > 0)
                                            .map(
                                              (line) =>
                                                `${accountDisplayNameFromName(line.account_name, t)} ¥${line.debit.toLocaleString()}`,
                                            )
                                            .join(" / ")}
                                        </Table.Td>
                                        <Table.Td className="currency-cell">
                                          {entry.lines
                                            .filter((line) => line.credit > 0)
                                            .map(
                                              (line) =>
                                                `${accountDisplayNameFromName(line.account_name, t)} ¥${line.credit.toLocaleString()}`,
                                            )
                                            .join(" / ")}
                                        </Table.Td>
                                      </Table.Tr>
                                    ))}
                                  </Table.Tbody>
                                </Table>
                              </Stack>
                            </Table.Td>
                          </Table.Tr>
                        )}
                      </Fragment>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>

            <Group justify="space-between" align="center">
              <Group gap="xs">
                <Text size="sm" c="dimmed">
                  {importableCount} 件インポート予定
                </Text>
                {amazonCount > 0 && (
                  <Badge color="blue" variant="light" size="sm">
                    {t("importAmazonCount").replace(
                      "{count}",
                      String(amazonCount),
                    )}
                  </Badge>
                )}
                {salaryHoldCount > 0 && (
                  <Badge color="grape" variant="light" size="sm">
                    {t("importSalaryCount").replace(
                      "{count}",
                      String(salaryHoldCount),
                    )}
                  </Badge>
                )}
              </Group>
              <Button
                onClick={handleImportClick}
                disabled={
                  !selectedAccountId ||
                  (importableCount === 0 &&
                    amazonCount === 0 &&
                    salaryHoldCount === 0) ||
                  importing
                }
                loading={importing}
              >
                {t("importConfirmButton")}
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}

      {/* Empty rows warning modal */}
      <Modal
        opened={showEmptyRowsModal}
        onClose={() => setShowEmptyRowsModal(false)}
        title={t("importEmptyRowsWarningTitle")}
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">
            {t("importEmptyRowsWarning").replace(
              "{count}",
              String(emptyRowCount),
            )}
          </Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => setShowEmptyRowsModal(false)}
            >
              {t("cancel") as string}
            </Button>
            <Button
              onClick={() => {
                setShowEmptyRowsModal(false);
                if (duplicateIndices.length > 0) {
                  setDuplicateDecisions(pendingDecisions);
                  setShowDuplicateModal(true);
                } else {
                  void executeImport({});
                }
              }}
            >
              {t("importContinue")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Duplicate confirmation modal */}
      <Modal
        opened={showDuplicateModal}
        onClose={() => setShowDuplicateModal(false)}
        title={t("importDuplicateModalTitle")}
        size="lg"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            以下の取引が既存のデータと重複している可能性があります。各取引についてインポートするかスキップするかを選択してください。
          </Text>
          {duplicateIndices.map((i) => {
            const tx = transactions[i];
            if (!tx) return null;
            const decision = duplicateDecisions[i] ?? "skip";
            return (
              <Paper key={i} withBorder p="sm" radius="sm">
                <Group justify="space-between" align="center">
                  <Box>
                    <Text size="sm" fw={500}>
                      {tx.store}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {tx.date} · ¥{tx.amount.toLocaleString()}
                    </Text>
                  </Box>
                  <Group gap="xs">
                    <Button
                      size="xs"
                      variant={decision === "skip" ? "filled" : "outline"}
                      color="gray"
                      onClick={() =>
                        setDuplicateDecisions((d) => ({
                          ...d,
                          [i]: "skip",
                        }))
                      }
                    >
                      {t("importSkip")}
                    </Button>
                    <Button
                      size="xs"
                      variant={decision === "import" ? "filled" : "outline"}
                      color="blue"
                      onClick={() =>
                        setDuplicateDecisions((d) => ({
                          ...d,
                          [i]: "import",
                        }))
                      }
                    >
                      {t("importImportAnyway")}
                    </Button>
                  </Group>
                </Group>
              </Paper>
            );
          })}
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => setShowDuplicateModal(false)}
            >
              {t("cancel") as string}
            </Button>
            <Button
              onClick={() => {
                setShowDuplicateModal(false);
                void executeImport(duplicateDecisions);
              }}
            >
              確定してインポート
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Store mapping overwrite confirm modal */}
      <Modal
        opened={overwriteTarget !== null}
        onClose={() => setOverwriteTarget(null)}
        title={t("storeMappingOverwriteTitle")}
        size="sm"
      >
        {overwriteTarget && (
          <Stack gap="md">
            <Text size="sm">
              {t("storeMappingOverwriteMsg")
                .replace("{store}", overwriteTarget.storeKey)
                .replace(
                  "{existing}",
                  accountDisplayNameFromName(
                    overwriteTarget.existingMapping.account_name,
                    t,
                  ) || String(overwriteTarget.existingMapping.account_id),
                )
                .replace(
                  "{new}",
                  accountDisplayNameFromName(
                    accounts.find(
                      (a) => a.id === Number(overwriteTarget.accountId),
                    )?.name,
                    t,
                  ) || overwriteTarget.accountId,
                )}
            </Text>
            <Group justify="flex-end">
              <Button
                variant="default"
                onClick={() => setOverwriteTarget(null)}
              >
                {t("cancel") as string}
              </Button>
              <Button
                color="orange"
                onClick={() => {
                  const target = overwriteTarget;
                  setOverwriteTarget(null);
                  void saveStoreMapping(
                    target.storeKey,
                    target.accountId,
                    target.rowType,
                    true,
                  );
                }}
              >
                {t("storeMappingOverwrite")}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
