import {
  Accordion,
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  List,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useDisclosure } from "@mantine/hooks";
import { IconDeviceFloppy, IconPlus, IconTrash } from "@tabler/icons-react";
import dayjs from "dayjs";
import { useEffect, useRef, useState } from "react";
import type { CreateJournalInput } from "@balance-sheet/shared";
import { api } from "../api/client";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import { showFeedback } from "../lib/feedback";
import { ConfirmModal } from "./ConfirmModal";
import {
  buildGroupedAssetOptions,
  buildGroupedExpenseOptions,
  buildGroupedIncomeOptions,
  buildGroupedLiabilityOptions,
} from "../utils/csvInputUtils";
import {
  bulkDraft,
  setBulkDraft,
  DEFAULT_BILLING_ROW,
  type BulkExpenseRow,
  type BulkDiscountRow,
  type BulkRow,
  type BillingRow,
} from "../utils/inputDrafts";

export function BulkExpenseTab({ onPosted }: { onPosted: () => void }) {
  const { t } = useLang();
  const {
    accounts,
    budgetCategories,
    displayCurrencySymbol: currencySymbol,
  } = useAppData();

  const [paymentAccountId, setPaymentAccountId] = useState<string | null>(
    bulkDraft.paymentAccountId,
  );
  const [rows, setRows] = useState<BulkRow[]>(
    bulkDraft.rows.length > 0
      ? bulkDraft.rows
      : [
          {
            type: "expense",
            date: new Date(),
            itemName: "",
            qty: 1,
            price: 0,
            expenseAccountId: null,
          } satisfies BulkExpenseRow,
        ],
  );
  const [billingRows, setBillingRows] = useState<BillingRow[]>(
    bulkDraft.billingRows.length > 0
      ? bulkDraft.billingRows
      : [{ ...DEFAULT_BILLING_ROW }],
  );
  const initLen =
    bulkDraft.billingRows.length > 0 ? bulkDraft.billingRows.length : 1;
  const [billingChecked, setBillingChecked] = useState<boolean[]>(() =>
    Array(initLen).fill(false),
  );
  const [posting, setPosting] = useState(false);
  const [copyLastDate, setCopyLastDate] = useState(
    () => localStorage.getItem("bulkCopyLastDate") === "true",
  );
  const [
    skipConfirmOpened,
    { open: openSkipConfirm, close: closeSkipConfirm },
  ] = useDisclosure(false);
  const pendingEntries = useRef<CreateJournalInput[]>([]);
  const pendingSkipCount = useRef(0);

  useEffect(() => {
    setBulkDraft({ paymentAccountId, rows, billingRows });
  }, [paymentAccountId, rows, billingRows]);

  const paymentOptions = [
    ...buildGroupedAssetOptions(accounts, t("groupAssetAccounts")),
    ...buildGroupedLiabilityOptions(accounts, t("groupLiabilityAccounts")),
  ];

  const expenseOpts = buildGroupedExpenseOptions(
    accounts,
    t("groupExpenseAccounts"),
    t("catLending"),
  );
  const loanItems = accounts
    .filter((a) => a.type === "liability" && a.category === "loan")
    .map((a) => ({ value: String(a.id), label: a.name }));
  const shortTermLoanItems = accounts
    .filter((a) => a.type === "liability" && a.category === "short_term_loan")
    .map((a) => ({ value: String(a.id), label: a.name }));
  const expenseAndRepaymentOpts = [
    ...expenseOpts,
    ...(loanItems.length > 0
      ? [{ group: t("catLoan"), items: loanItems }]
      : []),
    ...(shortTermLoanItems.length > 0
      ? [{ group: t("catShortTermLoan"), items: shortTermLoanItems }]
      : []),
  ];
  const incomeOpts = buildGroupedIncomeOptions(
    accounts,
    t("groupIncomeAccounts"),
  );
  const catOpts = budgetCategories.map((c) => ({
    value: String(c.id),
    label: c.name,
  }));

  function getNewDate(prev: BulkRow[]): Date {
    if (copyLastDate && prev.length > 0) {
      return new Date(prev[prev.length - 1]!.date);
    }
    return new Date();
  }

  function addExpenseRow() {
    setRows((prev) => [
      ...prev,
      {
        type: "expense",
        date: getNewDate(prev),
        itemName: "",
        qty: 1,
        price: 0,
        expenseAccountId: null,
      } satisfies BulkExpenseRow,
    ]);
  }

  function addDiscountRow() {
    setRows((prev) => [
      ...prev,
      {
        type: "discount",
        date: getNewDate(prev),
        discountType: "",
        amount: 0,
        incomeAccountId: null,
        budgetCategoryId: null,
      } satisfies BulkDiscountRow,
    ]);
  }

  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateRow(idx: number, patch: Partial<BulkRow>) {
    setRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx]!, ...patch } as BulkRow;
      return next;
    });
  }

  const expenseTotal = rows
    .filter((r): r is BulkExpenseRow => r.type === "expense")
    .reduce((s, r) => s + r.qty * r.price, 0);

  const discountTotal = rows
    .filter((r): r is BulkDiscountRow => r.type === "discount")
    .reduce((s, r) => s + r.amount, 0);

  const calcTotal = expenseTotal - discountTotal;
  const billingTotal = billingRows.reduce(
    (s, r) => s + (Number(r.amount.replace(/,/g, "")) || 0),
    0,
  );
  const hasBillingInput = billingTotal > 0;
  const diff = calcTotal - billingTotal;

  function buildEntries(payAccId: number): {
    entries: CreateJournalInput[];
    skippedCount: number;
  } {
    const entries: CreateJournalInput[] = [];
    let skippedCount = 0;

    for (const row of rows) {
      if (row.type === "expense") {
        const r = row as BulkExpenseRow;
        if (!r.expenseAccountId || r.price <= 0) {
          if (r.price > 0 && !r.expenseAccountId) skippedCount++;
          continue;
        }
        const expAccId = Number(r.expenseAccountId);
        const amount = r.qty * r.price;
        const expAcc = accounts.find((a) => a.id === expAccId);
        const budget_allocations =
          expAcc?.budget_ratios
            ?.filter((br) => br.ratio > 0)
            .map((br) => ({
              budget_category_id: br.budget_category_id,
              amount: -Math.round(amount * (br.ratio / 100)),
            })) ?? [];
        entries.push({
          date: dayjs(r.date).format("YYYY-MM-DD"),
          description: r.itemName || t("bulkExpenseDefaultExpenseDesc"),
          lines: [
            { account_id: expAccId, debit: amount, credit: 0 },
            { account_id: payAccId, debit: 0, credit: amount },
          ],
          budget_allocations:
            budget_allocations.length > 0 ? budget_allocations : undefined,
          budget_source: "simple",
        });
      } else {
        const r = row as BulkDiscountRow;
        if (!r.incomeAccountId || r.amount <= 0) {
          if (r.amount > 0 && !r.incomeAccountId) skippedCount++;
          continue;
        }
        const incAccId = Number(r.incomeAccountId);
        const budget_allocations = r.budgetCategoryId
          ? [
              {
                budget_category_id: Number(r.budgetCategoryId),
                amount: r.amount,
              },
            ]
          : [];
        entries.push({
          date: dayjs(r.date).format("YYYY-MM-DD"),
          description: r.discountType || t("bulkExpenseDefaultDiscountDesc"),
          lines: [
            { account_id: payAccId, debit: r.amount, credit: 0 },
            { account_id: incAccId, debit: 0, credit: r.amount },
          ],
          income_budget_allocations:
            budget_allocations.length > 0 ? budget_allocations : undefined,
        });
      }
    }

    return { entries, skippedCount };
  }

  async function doPost(entries: CreateJournalInput[]) {
    setPosting(true);
    try {
      await api.journal.batchCreate({ entries });
      showFeedback({ message: t("bulkExpensePosted"), color: "teal" });

      const fresh: BulkExpenseRow = {
        type: "expense",
        date: new Date(),
        itemName: "",
        qty: 1,
        price: 0,
        expenseAccountId: null,
      };
      const freshBilling = [{ ...DEFAULT_BILLING_ROW }];
      setBulkDraft({
        paymentAccountId,
        rows: [fresh],
        billingRows: freshBilling,
      });
      setRows([fresh]);
      setBillingRows(freshBilling);
      setBillingChecked([false]);
      onPosted();
    } catch {
      showFeedback({ message: "記入に失敗しました", color: "red" });
    } finally {
      setPosting(false);
    }
  }

  function handlePostAll() {
    if (!paymentAccountId) {
      showFeedback({
        message: t("bulkExpenseNoPaymentAccount"),
        color: "yellow",
      });
      return;
    }
    const payAccId = Number(paymentAccountId);
    const { entries, skippedCount } = buildEntries(payAccId);

    if (entries.length === 0) {
      showFeedback({
        message: t("bulkExpenseNoRows"),
        color: "yellow",
      });
      return;
    }

    if (skippedCount > 0) {
      pendingEntries.current = entries;
      pendingSkipCount.current = skippedCount;
      openSkipConfirm();
    } else {
      void doPost(entries);
    }
  }

  return (
    <Stack gap="md">
      <Accordion variant="contained" radius="md">
        <Accordion.Item value="amazon-notes">
          <Accordion.Control>Amazon.co.jp記入時の注意</Accordion.Control>
          <Accordion.Panel>
            <List size="sm" spacing="xs">
              <List.Item>
                別の注文番号で、2回同じギフトカードやポイントを使ったことになっている場合があります。2重入力に注意してください。
              </List.Item>
              <List.Item>
                注文履歴には、割引が表示されないことがあります。ズレている場合は「明細書/適格請求書」から正確な金額を確認してください。
              </List.Item>
              <List.Item>
                明細書/適格請求書 は、2ページにまたがっていることがあります。
              </List.Item>
            </List>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>

      <Select
        label={t("bulkExpensePaymentAccount")}
        data={paymentOptions}
        value={paymentAccountId}
        onChange={setPaymentAccountId}
        searchable={false}
        required
        w={300}
      />

      <ScrollArea>
        <Table
          withTableBorder
          striped
          highlightOnHover
          style={{ minWidth: 960 }}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={90}>{t("bulkExpenseColType")}</Table.Th>
              <Table.Th w={120}>{t("bulkExpenseColDate")}</Table.Th>
              <Table.Th style={{ minWidth: 200 }}>
                {t("bulkExpenseColName")}
              </Table.Th>
              <Table.Th w={60}>{t("bulkExpenseColQty")}</Table.Th>
              <Table.Th w={110}>{t("bulkExpenseColAmount")}</Table.Th>
              <Table.Th w={180}>{t("bulkExpenseColAccount")}</Table.Th>
              <Table.Th w={160}>{t("bulkExpenseColBudget")}</Table.Th>
              <Table.Th w={40} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row, idx) =>
              row.type === "expense" ? (
                <Table.Tr key={idx}>
                  <Table.Td>
                    <Badge color="blue" size="sm" variant="light">
                      {t("bulkExpenseRowTypeExpense")}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <DateInput
                      size="xs"
                      valueFormat="MM/DD"
                      value={row.date}
                      onChange={(v) =>
                        updateRow(idx, { date: v ?? new Date() })
                      }
                    />
                  </Table.Td>
                  <Table.Td>
                    <TextInput
                      size="xs"
                      placeholder={t("bulkExpenseItemName")}
                      value={row.itemName}
                      onChange={(e) =>
                        updateRow(idx, { itemName: e.currentTarget.value })
                      }
                    />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput
                      size="xs"
                      min={1}
                      value={row.qty}
                      onChange={(v) => updateRow(idx, { qty: Number(v) || 1 })}
                      hideControls
                    />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput
                      size="xs"
                      min={0}
                      prefix={currencySymbol}
                      thousandSeparator=","
                      value={row.price}
                      onChange={(v) =>
                        updateRow(idx, { price: Number(v) || 0 })
                      }
                      hideControls
                    />
                  </Table.Td>
                  <Table.Td>
                    <Select
                      size="xs"
                      data={expenseAndRepaymentOpts}
                      value={row.expenseAccountId}
                      onChange={(v) => updateRow(idx, { expenseAccountId: v })}
                      searchable={false}
                      clearable
                      placeholder={t("bulkExpenseExpensePlaceholder")}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      —
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      size="sm"
                      onClick={() => removeRow(idx)}
                      disabled={rows.length <= 1}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ) : (
                <Table.Tr key={idx}>
                  <Table.Td>
                    <Badge color="orange" size="sm" variant="light">
                      {t("bulkExpenseRowTypeDiscount")}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <DateInput
                      size="xs"
                      valueFormat="MM/DD"
                      value={row.date}
                      onChange={(v) =>
                        updateRow(idx, { date: v ?? new Date() })
                      }
                    />
                  </Table.Td>
                  <Table.Td>
                    <TextInput
                      size="xs"
                      placeholder={t("bulkExpenseDiscountType")}
                      value={row.discountType}
                      onChange={(e) =>
                        updateRow(idx, { discountType: e.currentTarget.value })
                      }
                    />
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      —
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <NumberInput
                      size="xs"
                      min={0}
                      prefix={currencySymbol}
                      thousandSeparator=","
                      value={row.amount}
                      onChange={(v) =>
                        updateRow(idx, { amount: Number(v) || 0 })
                      }
                      hideControls
                    />
                  </Table.Td>
                  <Table.Td>
                    <Select
                      size="xs"
                      data={incomeOpts}
                      value={row.incomeAccountId}
                      onChange={(v) => updateRow(idx, { incomeAccountId: v })}
                      searchable={false}
                      clearable
                      placeholder={t("bulkExpenseIncomePlaceholder")}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Select
                      size="xs"
                      data={catOpts}
                      value={row.budgetCategoryId}
                      onChange={(v) => updateRow(idx, { budgetCategoryId: v })}
                      searchable={false}
                      clearable
                      placeholder={t("bulkExpenseBudgetPlaceholder")}
                    />
                  </Table.Td>
                  <Table.Td>
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      size="sm"
                      onClick={() => removeRow(idx)}
                      disabled={rows.length <= 1}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ),
            )}
          </Table.Tbody>
        </Table>
      </ScrollArea>

      <Group gap="xs">
        <Button
          variant="light"
          size="xs"
          leftSection={<IconPlus size={14} />}
          onClick={addExpenseRow}
        >
          {t("bulkExpenseAddExpenseRow")}
        </Button>
        <Button
          variant="light"
          color="orange"
          size="xs"
          leftSection={<IconPlus size={14} />}
          onClick={addDiscountRow}
        >
          {t("bulkExpenseAddDiscountRow")}
        </Button>
        <Switch
          size="xs"
          label={t("bulkExpenseCopyLastDate")}
          checked={copyLastDate}
          onChange={(e) => {
            const v = e.currentTarget.checked;
            setCopyLastDate(v);
            localStorage.setItem("bulkCopyLastDate", String(v));
          }}
        />
      </Group>

      <Divider />

      <Paper withBorder p="md" radius="md">
        <Stack gap="xs">
          <Group justify="space-between">
            <Text size="sm">{t("bulkExpenseCalcTotal")}</Text>
            <Text fw={700} size="sm">
              ¥{calcTotal.toLocaleString()}
            </Text>
          </Group>
          <Divider />
          {billingRows.map((br, i) => (
            <Group key={i} gap="xs" align="center">
              <Checkbox
                size="xs"
                checked={billingChecked[i] ?? false}
                onChange={(e) =>
                  setBillingChecked((prev) => {
                    const next = [...prev];
                    next[i] = e.currentTarget.checked;
                    return next;
                  })
                }
              />
              <TextInput
                size="xs"
                flex={1}
                placeholder={t("bulkExpenseBillingLabel")}
                value={br.label}
                onChange={(e) =>
                  setBillingRows((prev) =>
                    prev.map((r, j) =>
                      j === i ? { ...r, label: e.currentTarget.value } : r,
                    ),
                  )
                }
              />
              <NumberInput
                size="xs"
                w={120}
                prefix={currencySymbol}
                thousandSeparator=","
                value={br.amount}
                onChange={(v) =>
                  setBillingRows((prev) =>
                    prev.map((r, j) =>
                      j === i ? { ...r, amount: String(v) } : r,
                    ),
                  )
                }
                hideControls
                placeholder="0"
              />
              <ActionIcon
                size="xs"
                variant="subtle"
                color="gray"
                onClick={() => {
                  setBillingRows((prev) => prev.filter((_, j) => j !== i));
                  setBillingChecked((prev) => prev.filter((_, j) => j !== i));
                }}
                disabled={billingRows.length === 1}
              >
                <IconTrash size={12} />
              </ActionIcon>
            </Group>
          ))}
          <Button
            variant="subtle"
            size="xs"
            leftSection={<IconPlus size={12} />}
            onClick={() => {
              setBillingRows((prev) => [...prev, { ...DEFAULT_BILLING_ROW }]);
              setBillingChecked((prev) => [...prev, false]);
            }}
          >
            {t("bulkExpenseAddBillingRow")}
          </Button>
          {hasBillingInput && (
            <>
              {billingRows.length > 1 && (
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">
                    {t("bulkExpenseBillingTotal")}
                  </Text>
                  <Text size="sm" c="dimmed">
                    ¥{billingTotal.toLocaleString()}
                  </Text>
                </Group>
              )}
              <Group justify="space-between">
                <Text size="sm">{t("bulkExpenseDiff")}</Text>
                <Text
                  fw={700}
                  size="sm"
                  c={Math.abs(diff) < 1 ? "teal" : "red"}
                >
                  ¥{diff.toLocaleString()}
                </Text>
              </Group>
            </>
          )}
        </Stack>
      </Paper>

      <Group justify="flex-end">
        <Button
          leftSection={<IconDeviceFloppy size={16} />}
          onClick={handlePostAll}
          loading={posting}
          disabled={!paymentAccountId}
        >
          {t("bulkExpensePostAll")}
        </Button>
      </Group>

      <ConfirmModal
        opened={skipConfirmOpened}
        onClose={closeSkipConfirm}
        onConfirm={() => void doPost(pendingEntries.current)}
        title={t("bulkExpenseSkippedTitle")}
        message={t("bulkExpenseSkippedRows").replace(
          "{n}",
          String(pendingSkipCount.current),
        )}
        confirmLabel={t("bulkExpensePostAll")}
        confirmColor="blue"
      />
    </Stack>
  );
}
