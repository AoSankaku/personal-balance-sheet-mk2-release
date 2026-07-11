import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useForm } from "@mantine/form";
import { useMediaQuery } from "@mantine/hooks";
import { IconAlertTriangle, IconPlus, IconTrash } from "@tabler/icons-react";
import dayjs from "dayjs";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CreateJournalInput,
  UnsettledLoanEntry,
} from "@balance-sheet/shared";
import {
  isShortTermBorrowingCategory,
  isShortTermLendingCategory,
} from "@balance-sheet/shared";
import { api, ApiError } from "../api/client";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import { showFeedback } from "../lib/feedback";
import { formatCurrency } from "../lib/numberFormat";
import {
  accountDisplayName,
  categoryIndex,
} from "../lib/accountUtils";
import {
  renderAccountOption,
  toAccountOption,
  type AccountOption,
} from "../lib/accountSelect";
import {
  multiDraft,
  setMultiDraft,
  type MultiLineRow,
} from "../utils/inputDrafts";

export type { MultiLineRow };

interface MultiForm {
  date: Date;
  description: string;
  rows: MultiLineRow[];
}

export interface MultiLineInitialValues {
  date: Date;
  description: string;
  rows: MultiLineRow[];
  budgetAllocs: Record<number, number>;
}

interface Props {
  onSubmit: (values: CreateJournalInput) => Promise<void>;
  onCancel?: () => void;
  onReset?: () => void;
  initialValues?: MultiLineInitialValues;
  submitLabel?: string;
  editEntryId?: number;
}

export function MultiLineEntryForm({
  onSubmit,
  onCancel,
  onReset,
  initialValues,
  submitLabel,
  editEntryId,
}: Props) {
  const { t, locale } = useLang();
  const {
    accounts,
    budgetCategories,
    displayCurrency,
    displayCurrencySymbol: currencySymbol,
  } = useAppData();
  const selectedCurrency = displayCurrency || "JPY";
  const isMobile = useMediaQuery("(max-width: 48em)");
  const isControlled = initialValues != null;

  const [budgetAllocs, setBudgetAllocs] = useState<Record<number, number>>(
    initialValues?.budgetAllocs ?? {},
  );
  const [overBudgetWarnOpen, setOverBudgetWarnOpen] = useState(false);
  const [underBudgetWarnOpen, setUnderBudgetWarnOpen] = useState(false);
  const pendingValues = useRef<MultiForm | null>(null);

  const [unsettledByAccount, setUnsettledByAccount] = useState<
    Record<number, UnsettledLoanEntry[]>
  >({});
  const [settledIdsByAccount, setSettledIdsByAccount] = useState<
    Record<number, number[]>
  >({});
  const [loadingUnsettled, setLoadingUnsettled] = useState(false);

  const defaultRows: MultiLineRow[] = [
    {
      account_id: null,
      debit: 0,
      credit: 0,
      creditCardStatementOffsetMonths: 0,
    },
    {
      account_id: null,
      debit: 0,
      credit: 0,
      creditCardStatementOffsetMonths: 0,
    },
  ];

  const form = useForm<MultiForm>({
    initialValues: initialValues ??
      multiDraft ?? {
        date: new Date(),
        description: "",
        rows: defaultRows,
      },
    validate: {
      description: (v) =>
        v.trim().length === 0 ? t("descriptionIsRequired") : null,
    },
  });

  useEffect(() => {
    if (!isControlled) {
      setMultiDraft(form.values);
    }
  }, [form.values, isControlled]);

  // Accounts in "settlement direction": debit of short_term_loan (repayment)
  // or credit of short_term_lending (collection)
  const settlementAccountIds = useMemo(() => {
    const ids: number[] = [];
    for (const row of form.values.rows) {
      if (!row.account_id) continue;
      const acct = accounts.find((a) => a.id === row.account_id);
      if (!acct) continue;
      if (isShortTermBorrowingCategory(acct.category) && row.debit > 0)
        ids.push(acct.id);
      if (isShortTermLendingCategory(acct.category) && row.credit > 0)
        ids.push(acct.id);
    }
    return [...new Set(ids)];
  }, [form.values.rows, accounts]);

  // Accounts in "opening direction": credit of short_term_loan (new borrow)
  // or debit of short_term_lending (new lend)
  const openingAccountIds = useMemo(() => {
    const ids: number[] = [];
    for (const row of form.values.rows) {
      if (!row.account_id) continue;
      const acct = accounts.find((a) => a.id === row.account_id);
      if (!acct) continue;
      if (isShortTermBorrowingCategory(acct.category) && row.credit > 0)
        ids.push(acct.id);
      if (isShortTermLendingCategory(acct.category) && row.debit > 0)
        ids.push(acct.id);
    }
    return [...new Set(ids)];
  }, [form.values.rows, accounts]);

  // Stable string key — avoids re-running the effect when only the array reference changes
  // (e.g. when a new row with null account_id is added to the form)
  const settlementKey = settlementAccountIds.join(",");

  // Load unsettled entries for each settlement-direction account
  useEffect(() => {
    if (settlementAccountIds.length === 0) {
      setUnsettledByAccount({});
      setSettledIdsByAccount({});
      return;
    }

    let cancelled = false;
    setLoadingUnsettled(true);

    void (async () => {
      try {
        const results = await Promise.all(
          settlementAccountIds.map((id) =>
            api.loans.unsettled(id, editEntryId, selectedCurrency),
          ),
        );
        if (cancelled) return;

        const byAccount: Record<number, UnsettledLoanEntry[]> = {};
        const defaultSettledIds: Record<number, number[]> = {};
        results.forEach((r, i) => {
          const accountId = settlementAccountIds[i];
          byAccount[accountId] = r.entries;
          defaultSettledIds[accountId] = r.entries
            .filter((e) => e.already_settled_by_current)
            .map((e) => e.journal_entry_id);
        });

        setUnsettledByAccount(byAccount);
        // Preserve user's existing checkbox selections; only initialize defaults for newly-added accounts
        setSettledIdsByAccount((prev) => {
          const merged: Record<number, number[]> = {};
          for (const [key, defaultVal] of Object.entries(defaultSettledIds)) {
            const id = Number(key);
            merged[id] = id in prev ? prev[id] : defaultVal;
          }
          return merged;
        });
      } catch {
        // silently ignore
      } finally {
        if (!cancelled) setLoadingUnsettled(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [settlementKey, editEntryId, selectedCurrency]); // eslint-disable-line react-hooks/exhaustive-deps

  const allOptions = useMemo(() => {
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

  const totalDebit = form.values.rows.reduce((s, r) => s + (r.debit ?? 0), 0);
  const totalCredit = form.values.rows.reduce((s, r) => s + (r.credit ?? 0), 0);
  const totalDifference = Math.abs(totalDebit - totalCredit);
  const isBalanced =
    Math.abs(totalDebit - totalCredit) < 0.001 && totalDebit > 0;
  const totalBudgetAlloc = Object.values(budgetAllocs).reduce(
    (s, v) => s + v,
    0,
  );
  const totalBudgetPct =
    totalDebit > 0
      ? Math.round((totalBudgetAlloc / totalDebit) * 1000) / 10
      : 0;
  const hasExpenseRow = form.values.rows.some(
    (r) =>
      r.account_id != null &&
      accounts.find((a) => a.id === r.account_id)?.type === "expense",
  );

  async function doSubmit(values: MultiForm) {
    const validLines = values.rows.filter(
      (r) => r.account_id != null && (r.debit > 0 || r.credit > 0),
    );
    const budget_allocations = Object.entries(budgetAllocs)
      .filter(([, amt]) => amt !== 0)
      .map(([catId, amount]) => ({
        budget_category_id: Number(catId),
        amount,
      }));
    const allSettledIds = Object.values(settledIdsByAccount).flat();
    await onSubmit({
      date: dayjs(values.date).format("YYYY-MM-DD"),
      description: values.description,
      lines: validLines.map((r) => ({
        account_id: r.account_id!,
        debit: r.debit ?? 0,
        credit: r.credit ?? 0,
        ...(accounts.find((a) => a.id === r.account_id)?.category ===
        "credit_card"
          ? {
              credit_card_billing_offset_months:
                r.creditCardStatementOffsetMonths,
            }
          : {}),
      })),
      budget_allocations:
        budget_allocations.length > 0 ? budget_allocations : undefined,
      budget_source: "multiline",
      loan_settlement_opening: openingAccountIds.length > 0 || undefined,
      loan_settlement_journal_entry_ids:
        allSettledIds.length > 0 ? allSettledIds : undefined,
    });
    if (!isControlled) {
      setMultiDraft(null);
      form.reset();
      setBudgetAllocs({});
      setSettledIdsByAccount({});
    }
  }

  async function handleSubmit(values: MultiForm) {
    if (budgetCategories.length > 0 && totalBudgetPct > 100) {
      setOverBudgetWarnOpen(true);
      return;
    }
    if (
      budgetCategories.length > 0 &&
      hasExpenseRow &&
      totalBudgetPct > 0 &&
      totalBudgetPct < 100
    ) {
      pendingValues.current = values;
      setUnderBudgetWarnOpen(true);
      return;
    }
    try {
      await doSubmit(values);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : String(e);
      showFeedback({ message: msg, color: "red" });
    }
  }

  function handleAccountChange(i: number, v: string | null) {
    form.setFieldValue(`rows.${i}.account_id`, v ? Number(v) : null);
    if (
      !v ||
      accounts.find((a) => a.id === Number(v))?.category !== "credit_card"
    ) {
      form.setFieldValue(`rows.${i}.creditCardStatementOffsetMonths`, 0);
    }
  }

  return (
    <>
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <DateInput
              label={t("dateLabel")}
              required
              valueFormat="YYYY-MM-DD"
              {...form.getInputProps("date")}
            />
            <TextInput
              label={t("descriptionLabel")}
              placeholder={t("descMultiPlaceholder")}
              required
              {...form.getInputProps("description")}
            />
          </SimpleGrid>

          {form.values.rows.map((row, i) =>
            isMobile ? (
              <Stack
                key={i}
                gap={6}
                style={
                  i > 0
                    ? {
                        borderTop:
                          "1px solid var(--mantine-color-default-border)",
                        paddingTop: 8,
                      }
                    : undefined
                }
              >
                <Select
                  placeholder={t("selectAccount")}
                  data={allOptions}
                  searchable={false}
                  renderOption={renderAccountOption}
                  value={row.account_id != null ? String(row.account_id) : null}
                  onChange={(v) => handleAccountChange(i, v)}
                />
                <Group gap="xs" align="center">
                  <NumberInput
                    placeholder={t("debitColHeader")}
                    min={0}
                    prefix={currencySymbol}
                    thousandSeparator=","
                    hideControls
                    style={{ flex: 1 }}
                    value={row.debit}
                    onChange={(v) =>
                      form.setFieldValue(`rows.${i}.debit`, Number(v) || 0)
                    }
                  />
                  <NumberInput
                    placeholder={t("creditColHeader")}
                    min={0}
                    prefix={currencySymbol}
                    thousandSeparator=","
                    hideControls
                    style={{ flex: 1 }}
                    value={row.credit}
                    onChange={(v) =>
                      form.setFieldValue(`rows.${i}.credit`, Number(v) || 0)
                    }
                  />
                  <ActionIcon
                    color="red"
                    variant="subtle"
                    onClick={() => form.removeListItem("rows", i)}
                    disabled={form.values.rows.length <= 2}
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
                {accounts.find((a) => a.id === row.account_id)?.category ===
                  "credit_card" && (
                  <NumberInput
                    label={t("creditCardStatementOffsetLabel")}
                    description={t("creditCardStatementOffsetHint")}
                    min={0}
                    max={12}
                    allowDecimal={false}
                    value={row.creditCardStatementOffsetMonths}
                    onChange={(v) =>
                      form.setFieldValue(
                        `rows.${i}.creditCardStatementOffsetMonths`,
                        Number(v) || 0,
                      )
                    }
                  />
                )}
              </Stack>
            ) : (
              <Group key={i} align="flex-end">
                <Select
                  label={i === 0 ? t("multiAccountColHeader") : undefined}
                  placeholder={t("selectAccount")}
                  data={allOptions}
                  searchable={false}
                  renderOption={renderAccountOption}
                  style={{ flex: 2 }}
                  value={row.account_id != null ? String(row.account_id) : null}
                  onChange={(v) => handleAccountChange(i, v)}
                />
                <NumberInput
                  label={i === 0 ? t("debitColHeader") : undefined}
                  placeholder="0"
                  min={0}
                  prefix={currencySymbol}
                  thousandSeparator=","
                  style={{ flex: 1 }}
                  value={row.debit}
                  onChange={(v) =>
                    form.setFieldValue(`rows.${i}.debit`, Number(v) || 0)
                  }
                />
                <NumberInput
                  label={i === 0 ? t("creditColHeader") : undefined}
                  placeholder="0"
                  min={0}
                  prefix={currencySymbol}
                  thousandSeparator=","
                  style={{ flex: 1 }}
                  value={row.credit}
                  onChange={(v) =>
                    form.setFieldValue(`rows.${i}.credit`, Number(v) || 0)
                  }
                />
                {accounts.find((a) => a.id === row.account_id)?.category ===
                "credit_card" ? (
                  <NumberInput
                    label={
                      i === 0 ? t("creditCardStatementOffsetShort") : undefined
                    }
                    placeholder="0"
                    min={0}
                    max={12}
                    allowDecimal={false}
                    style={{ width: 120 }}
                    value={row.creditCardStatementOffsetMonths}
                    onChange={(v) =>
                      form.setFieldValue(
                        `rows.${i}.creditCardStatementOffsetMonths`,
                        Number(v) || 0,
                      )
                    }
                  />
                ) : (
                  <div style={{ width: 120 }} />
                )}
                <ActionIcon
                  color="red"
                  variant="subtle"
                  mb={4}
                  onClick={() => form.removeListItem("rows", i)}
                  disabled={form.values.rows.length <= 2}
                >
                  <IconTrash size={14} />
                </ActionIcon>
              </Group>
            ),
          )}

          <Button
            variant="light"
            leftSection={<IconPlus size={14} />}
            onClick={() =>
              form.insertListItem("rows", {
                account_id: null,
                debit: 0,
                credit: 0,
                creditCardStatementOffsetMonths: 0,
              })
            }
            size="xs"
          >
            {t("addRow")}
          </Button>

          <Group>
            <Text size="sm">
              {t("totalDebit")}{" "}
              <Text span fw={600} c={isBalanced ? "teal" : "red"}>
                {totalDebit.toLocaleString()}
              </Text>
            </Text>
            <Text size="sm">
              {t("totalCredit")}{" "}
              <Text span fw={600} c={isBalanced ? "teal" : "red"}>
                {totalCredit.toLocaleString()}
              </Text>
            </Text>
            <Text size="sm">
              {t("totalDifference")}{" "}
              <Text span fw={600} c={isBalanced ? "teal" : "red"}>
                {totalDifference.toLocaleString()}
              </Text>
            </Text>
            {!isBalanced && (
              <Text size="xs" c="red">
                {t("unbalanced")}
              </Text>
            )}
          </Group>

          {(settlementAccountIds.length > 0 ||
            openingAccountIds.length > 0) && (
            <>
              <Divider label={t("loanSettlementEntry")} labelPosition="left" />
              {openingAccountIds.length > 0 && (
                <Text size="xs" c="teal">
                  {t("multiLineLoanOpeningNotice")}
                </Text>
              )}
              {settlementAccountIds.map((accountId) => {
                const acct = accounts.find((a) => a.id === accountId);
                if (!acct) return null;
                const entries = unsettledByAccount[accountId] ?? [];
                const selectedIds = settledIdsByAccount[accountId] ?? [];
                const selectedTotal = entries
                  .filter((e) => selectedIds.includes(e.journal_entry_id))
                  .reduce((s, e) => s + e.amount, 0);
                return (
                  <Stack key={accountId} gap={4}>
                    <Text size="xs" fw={500}>
                      {acct.name}: {t("selectSettlementEntries")}
                    </Text>
                    {loadingUnsettled ? (
                      <Text size="xs" c="dimmed">
                        …
                      </Text>
                    ) : entries.length === 0 ? (
                      <Text size="xs" c="dimmed">
                        {t("noUnsettledEntries")}
                      </Text>
                    ) : (
                      <>
                        {entries.map((entry) => (
                          <Group
                            key={entry.journal_entry_id}
                            gap="xs"
                            align="center"
                          >
                            <Checkbox
                              size="sm"
                              checked={selectedIds.includes(
                                entry.journal_entry_id,
                              )}
                              onChange={(e) => {
                                setSettledIdsByAccount((prev) => ({
                                  ...prev,
                                  [accountId]: e.currentTarget.checked
                                    ? [
                                        ...(prev[accountId] ?? []),
                                        entry.journal_entry_id,
                                      ]
                                    : (prev[accountId] ?? []).filter(
                                        (id) => id !== entry.journal_entry_id,
                                      ),
                                }));
                              }}
                            />
                            <Text size="sm" flex={1}>
                              {entry.description}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {entry.date}
                            </Text>
                            <Badge size="xs" variant="light">
                              {entry.currency}
                            </Badge>
                            <Text size="sm" fw={500}>
                              {formatCurrency(
                                entry.amount,
                                locale,
                                entry.currency,
                                entry.currency === selectedCurrency
                                  ? currencySymbol
                                  : undefined,
                              )}
                            </Text>
                          </Group>
                        ))}
                        {selectedIds.length > 0 && (
                          <Group justify="flex-end" gap="xs">
                            <Text size="xs" c="dimmed">
                              {t("settlementSelectedTotal")}:
                            </Text>
                            <Text size="sm" fw={500}>
                              {formatCurrency(
                                selectedTotal,
                                locale,
                                selectedCurrency,
                                currencySymbol,
                              )}
                            </Text>
                          </Group>
                        )}
                      </>
                    )}
                  </Stack>
                );
              })}
            </>
          )}

          {budgetCategories.length > 0 && (
            <>
              <Divider
                label={t("multiLineBudgetRatios")}
                labelPosition="left"
              />
              <Group justify="space-between" mt={-8}>
                <Text size="xs" c="dimmed">
                  {t("multiLineBudgetAllocHint")}
                </Text>
                <Badge
                  size="xs"
                  variant="light"
                  color={
                    totalBudgetPct > 100
                      ? "red"
                      : hasExpenseRow &&
                          totalBudgetPct > 0 &&
                          totalBudgetPct < 100
                        ? "yellow"
                        : "teal"
                  }
                  leftSection={
                    hasExpenseRow &&
                    totalBudgetPct > 0 &&
                    totalBudgetPct < 100 ? (
                      <IconAlertTriangle size={10} />
                    ) : undefined
                  }
                >
                  {t("budgetDistributionTotal")}: {totalBudgetPct}%
                </Badge>
              </Group>
              <Stack gap={6}>
                {budgetCategories.map((cat) => {
                  const val = budgetAllocs[cat.id] ?? 0;
                  const color = val > 0 ? "teal" : val < 0 ? "red" : undefined;
                  const pct =
                    totalDebit > 0
                      ? Math.round((val / totalDebit) * 1000) / 10
                      : 0;
                  return (
                    <Group key={cat.id} align="center" gap="xs">
                      <Text size="sm" flex={1}>
                        {cat.name}
                      </Text>
                      <NumberInput
                        w={90}
                        size="sm"
                        allowNegative
                        suffix="%"
                        decimalScale={1}
                        placeholder="0"
                        hideControls={isMobile}
                        disabled={totalDebit === 0}
                        value={pct}
                        onChange={(v) => {
                          const amt =
                            totalDebit > 0
                              ? Math.round(
                                  (totalDebit * (Number(v) || 0)) / 100,
                                )
                              : 0;
                          setBudgetAllocs((prev) => ({
                            ...prev,
                            [cat.id]: amt,
                          }));
                        }}
                        styles={(theme) => ({
                          input: {
                            color: color ? theme.colors[color][6] : undefined,
                            fontWeight: color ? 600 : undefined,
                          },
                        })}
                      />
                      <NumberInput
                        w={130}
                        size="sm"
                        allowNegative
                        prefix={currencySymbol}
                        thousandSeparator=","
                        placeholder="0"
                        hideControls={isMobile}
                        value={val}
                        onChange={(v) =>
                          setBudgetAllocs((prev) => ({
                            ...prev,
                            [cat.id]: Number(v) || 0,
                          }))
                        }
                        styles={(theme) => ({
                          input: {
                            color: color ? theme.colors[color][6] : undefined,
                            fontWeight: color ? 600 : undefined,
                          },
                        })}
                      />
                    </Group>
                  );
                })}
              </Stack>
            </>
          )}

          <Group justify="space-between">
            <Group>
              {onReset && (
                <Button variant="light" color="gray" onClick={onReset}>
                  {t("reset")}
                </Button>
              )}
            </Group>
            <Group>
              {onCancel && (
                <Button variant="default" onClick={onCancel}>
                  {t("cancel")}
                </Button>
              )}
              <Button type="submit" disabled={!isBalanced}>
                {submitLabel ?? t("add")}
              </Button>
            </Group>
          </Group>
        </Stack>
      </form>

      <Modal
        opened={underBudgetWarnOpen}
        onClose={() => setUnderBudgetWarnOpen(false)}
        title={t("underBudgetWarningTitle")}
        centered
        size="sm"
      >
        <Stack>
          <Text size="sm">{t("underBudgetWarningMsg")}</Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => setUnderBudgetWarnOpen(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={async () => {
                setUnderBudgetWarnOpen(false);
                if (pendingValues.current) {
                  await doSubmit(pendingValues.current);
                  pendingValues.current = null;
                }
              }}
            >
              {t("save")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={overBudgetWarnOpen}
        onClose={() => setOverBudgetWarnOpen(false)}
        title={t("overBudgetWarningTitle")}
        centered
        size="sm"
      >
        <Stack>
          <Text size="sm">{t("overBudgetWarningMsg")}</Text>
          <Group justify="flex-end">
            <Button onClick={() => setOverBudgetWarnOpen(false)}>
              {t("ok")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
