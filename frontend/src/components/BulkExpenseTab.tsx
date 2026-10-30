import {
  Accordion,
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  List,
  Modal,
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
import {
  IconCheck,
  IconDeviceFloppy,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type {
  CompleteCreditCardStatementInput,
  CreateJournalInput,
} from "@balance-sheet/shared";
import {
  isAnyLendingCategory,
  isLongTermBorrowingCategory,
  isShortTermBorrowingCategory,
} from "@balance-sheet/shared";
import { api } from "../api/client";
import { canAllocateIncomeBudget } from "../lib/incomeBudgetScope";
import { buildBulkJournalEntries, BulkEntrySubmissionError } from "../lib/bulkEntrySubmission";
import { resolveIncomeTransferAccounts } from "../lib/incomeTransferAccounts";
import { formatCurrency } from "../lib/numberFormat";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import { captureFeedbackContext, showFeedback } from "../lib/feedback";
import { ConfirmModal } from "./ConfirmModal";
import {
  buildGroupedAssetOptions,
  buildGroupedExpenseOptions,
  buildGroupedIncomeOptions,
  buildGroupedLiabilityOptions,
} from "../utils/csvInputUtils";
import {
  isUserSelectableAccount,
  toAccountSelectOption,
  accountDisplayNameFromName,
} from "../lib/accountUtils";
import { renderAccountOption } from "../lib/accountSelect";
import {
  bulkDraft,
  setBulkDraft,
  DEFAULT_BILLING_ROW,
  type BulkExpenseRow,
  type BulkDiscountRow,
  type BulkLoanRow,
  type BulkRow,
  type BillingRow,
} from "../utils/inputDrafts";
import { SimpleEntryForm, type SimpleFormDraft } from "./SimpleEntryForm";
import {
  BULK_COPY_LAST_DATE_STORAGE_KEY,
  shouldCopyLastDateByDefault,
} from "../utils/bulkExpensePreferences";

export { buildBulkJournalEntries } from "../lib/bulkEntrySubmission";

export function BulkExpenseTab({ onPosted }: { onPosted: () => void }) {
  const { t, locale } = useLang();
  const {
    accounts,
    budgetCategories,
    budgetFilters,
    displayCurrency,
    displayCurrencySymbol: currencySymbol,
    enabledCurrencies,
    refreshCreditCardStatementCompletions,
  } = useAppData();
  const selectedCurrency = displayCurrency || "JPY";
  const currencyDecimalPlaces = enabledCurrencies.find(
    (currency) => currency.code === selectedCurrency,
  )?.decimal_places ?? 0;

  const [paymentAccountId, setPaymentAccountId] = useState<string | null>(
    bulkDraft.paymentAccountId,
  );
  const paymentAccount = accounts.find(
    (account) => account.id === Number(paymentAccountId),
  );
  const canAllocateDiscountIncome = canAllocateIncomeBudget(paymentAccount);
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
  const [loanModalOpened, setLoanModalOpened] = useState(false);
  const [loanEditorKey, setLoanEditorKey] = useState(0);
  const [editingLoanRowIndex, setEditingLoanRowIndex] = useState<number | null>(null);
  const [loanDraft, setLoanDraft] = useState<SimpleFormDraft | null>(null);
  const loanDraftRef = useRef<SimpleFormDraft | null>(null);
  const ignoreFirstLoanDraftChange = useRef(false);
  const [statementCompletion, setStatementCompletion] =
    useState<CompleteCreditCardStatementInput | null>(
      bulkDraft.statementCompletion,
    );
  const [completionPosting, setCompletionPosting] = useState(false);
  const [copyLastDate, setCopyLastDate] = useState(
    () =>
      shouldCopyLastDateByDefault(
        localStorage.getItem(BULK_COPY_LAST_DATE_STORAGE_KEY),
      ),
  );
  const [
    skipConfirmOpened,
    { open: openSkipConfirm, close: closeSkipConfirm },
  ] = useDisclosure(false);
  const [
    completionConfirmOpened,
    { open: openCompletionConfirm, close: closeCompletionConfirm },
  ] = useDisclosure(false);
  const pendingEntries = useRef<CreateJournalInput[]>([]);
  const pendingSkipCount = useRef(0);

  function submissionErrorMessage(error: unknown): string {
    if (!(error instanceof BulkEntrySubmissionError)) return t("saveFailed");
    const messages: Record<string, string> = {
      bulk_payment_account_required: t("bulkExpenseNoPaymentAccount"),
      bulk_invalid_amount: t("bulkSubmissionInvalidAmount"),
      bulk_currency_changed: t("bulkSubmissionCurrencyChanged"),
      bulk_loan_configuration_required: t("bulkLoanConfigurationRequired"),
      bulk_payment_account_changed: t("bulkLoanPaymentAccountChanged"),
      bulk_duplicate_settlement: t("bulkLoanDuplicateSettlement"),
      bulk_invalid_date: t("bulkSubmissionInvalidDate"),
      bulk_invalid_account: t("bulkSubmissionInvalidAccount"),
      income_transfer_destination_required: t("bulkIncomeTransferTargetRequired"),
    };
    const message = messages[error.code] ?? t("saveFailed");
    return error.rowIndex >= 0
      ? message.replace("{n}", String(error.rowIndex + 1))
      : message;
  }

  useEffect(() => {
    setBulkDraft({
      paymentAccountId,
      rows,
      billingRows,
      statementCompletion,
    });
  }, [paymentAccountId, rows, billingRows, statementCompletion]);

  useEffect(() => {
    if (!paymentAccount) return;
    if (canAllocateDiscountIncome) return;
    setRows((previous) => {
      let changed = false;
      const next = previous.map((row) => {
        if (row.type !== "discount" || row.budgetCategoryId == null) {
          if (row.type === "discount" && row.transferAccountId != null) {
            changed = true;
            return { ...row, transferAccountId: null };
          }
          return row;
        }
        changed = true;
        return {
          ...row,
          budgetCategoryId: null,
          transferAccountId: null,
          deferTransfer: undefined,
        };
      });
      return changed ? next : previous;
    });
  }, [paymentAccount, canAllocateDiscountIncome]);

  useEffect(() => {
    const expectedPaymentAccountId = paymentAccountId ?? "";
    const nextRows = rows.map((row) => {
      if (row.type !== "loan") return row;
      if (
        row.currency.toUpperCase() === selectedCurrency.toUpperCase() &&
        row.paymentAccountId === expectedPaymentAccountId
      ) return row;
      return invalidateLoanRow(row, selectedCurrency, expectedPaymentAccountId);
    });
    if (nextRows.some((row, index) => row !== rows[index])) {
      setRows(nextRows);
      if (editingLoanRowIndex != null) {
        const activeRow = nextRows[editingLoanRowIndex];
        if (activeRow?.type === "loan" && activeRow !== rows[editingLoanRowIndex]) {
          loanDraftRef.current = activeRow.draft;
          setLoanDraft(activeRow.draft);
          setLoanModalOpened(false);
          setEditingLoanRowIndex(null);
        }
      }
    }
  }, [selectedCurrency, paymentAccountId]);

  useEffect(() => {
    const legacyIndex = rows.findIndex((row) => {
      if (row.type !== "expense" || !row.expenseAccountId) return false;
      const account = accounts.find((candidate) => candidate.id === Number(row.expenseAccountId));
      return Boolean(account && (
        (account.type === "liability" && (
          isShortTermBorrowingCategory(account.category) ||
          isLongTermBorrowingCategory(account.category)
        )) ||
        (account.type === "asset" && isAnyLendingCategory(account.category))
      ));
    });
    if (legacyIndex < 0) return;
    const legacyRow = rows[legacyIndex]! as BulkExpenseRow;
    const account = accounts.find((candidate) => candidate.id === Number(legacyRow.expenseAccountId))!;
    const draft = makeLoanDraft({
      date: legacyRow.date,
      description: legacyRow.itemName,
      direction: account.type === "asset" ? "lend" : "decrease",
      loanAccountId: account.id,
      paymentAccountId,
      amount: legacyRow.qty * legacyRow.price,
    });
    const converted: BulkLoanRow = {
      type: "loan",
      input: null,
      draft,
      currency: selectedCurrency,
      paymentAccountId: paymentAccountId ?? "",
    };
    setRows((previous) => previous.map((row, index) => index === legacyIndex ? converted : row));
    if (paymentAccountId) openLoanEditor(legacyIndex, draft);
    // Runs only while an old draft still contains a loan account in an expense row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, accounts, paymentAccountId, selectedCurrency]);

  const statementMonthLabel = statementCompletion
    ? new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "long",
      }).format(
        new Date(`${statementCompletion.statement_month}-01T00:00:00`),
      )
    : "";

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
    .filter(
      (a) =>
        a.type === "liability" &&
        a.category === "loan" &&
        isUserSelectableAccount(a),
    )
    .map((a) => toAccountSelectOption(a, t));
  const shortTermLoanItems = accounts
    .filter(
      (a) =>
        a.type === "liability" &&
        a.category === "short_term_loan" &&
        isUserSelectableAccount(a),
    )
    .map((a) => toAccountSelectOption(a, t));
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

  function rowDate(row: BulkRow): Date {
    if (row.type !== "loan") return row.date;
    if (row.input?.date) return new Date(`${row.input.date}T00:00:00`);
    const draftDate = row.draft.formValues.date;
    return draftDate instanceof Date ? draftDate : new Date();
  }

  function getNewDate(prev: BulkRow[]): Date {
    if (copyLastDate && prev.length > 0) {
      return new Date(rowDate(prev[prev.length - 1]!));
    }
    return new Date();
  }

  function makeLoanDraft(input: {
    date: Date;
    description: string;
    direction: "increase" | "decrease" | "lend" | "collect";
    loanAccountId: number | null;
    paymentAccountId: string | null;
    amount: number;
  }): SimpleFormDraft {
    return {
      formValues: {
        date: input.date,
        description: input.description,
        entryType: "loan",
        loanDirection: input.direction,
        loanAccountId: input.loanAccountId,
        loanCounterAccountId: input.paymentAccountId
          ? Number(input.paymentAccountId)
          : null,
        amount: input.amount,
      },
      budgetDist: [],
      showZeroCategories: false,
    };
  }

  function invalidateLoanRow(
    row: BulkLoanRow,
    currency: string,
    nextPaymentAccountId: string,
  ): BulkLoanRow {
    return {
      ...row,
      input: null,
      currency,
      paymentAccountId: nextPaymentAccountId,
      draft: {
        ...row.draft,
        formValues: {
          ...row.draft.formValues,
          loanCounterAccountId: nextPaymentAccountId
            ? Number(nextPaymentAccountId)
            : null,
        },
        settledEntryIds: [],
        diffBudgetDist: [],
        loanCounterBudgetDist: [],
        loanFundingCategoryAmounts: {},
      },
    };
  }

  function openLoanEditor(index: number, draft: SimpleFormDraft) {
    if (!paymentAccountId) {
      showFeedback({ message: t("bulkExpenseNoPaymentAccount"), color: "yellow" });
      return;
    }
    setEditingLoanRowIndex(index);
    loanDraftRef.current = draft;
    setLoanDraft(draft);
    setLoanEditorKey((previous) => previous + 1);
    ignoreFirstLoanDraftChange.current = true;
    setLoanModalOpened(true);
  }

  function handleLoanDraftChange(draft: SimpleFormDraft) {
    loanDraftRef.current = draft;
    setLoanDraft(draft);
    if (ignoreFirstLoanDraftChange.current) {
      ignoreFirstLoanDraftChange.current = false;
      return;
    }
    if (editingLoanRowIndex == null) return;
    setRows((previous) => previous.map((row, index) => {
      if (index !== editingLoanRowIndex || row.type !== "loan") return row;
      return { ...row, input: null, draft };
    }));
  }

  function addLoanRow() {
    if (!paymentAccountId) {
      showFeedback({ message: t("bulkExpenseNoPaymentAccount"), color: "yellow" });
      return;
    }
    const date = getNewDate(rows);
    const draft = makeLoanDraft({
      date,
      description: "",
      direction: "decrease",
      loanAccountId: null,
      paymentAccountId,
      amount: 0,
    });
    const row: BulkLoanRow = {
      type: "loan",
      input: null,
      draft,
      currency: selectedCurrency,
      paymentAccountId,
    };
    const index = rows.length;
    setRows((previous) => [...previous, row]);
    openLoanEditor(index, draft);
  }

  function selectExpenseAccount(index: number, value: string | null) {
    const account = accounts.find((candidate) => candidate.id === Number(value));
    const isLoanAccount = Boolean(account && (
      (account.type === "liability" && (
        isShortTermBorrowingCategory(account.category) ||
        isLongTermBorrowingCategory(account.category)
      )) ||
      (account.type === "asset" && isAnyLendingCategory(account.category))
    ));
    if (!isLoanAccount || !account) {
      updateRow(index, { expenseAccountId: value });
      return;
    }
    if (!paymentAccountId) {
      showFeedback({ message: t("bulkExpenseNoPaymentAccount"), color: "yellow" });
      return;
    }
    const oldRow = rows[index];
    if (!oldRow || oldRow.type !== "expense") return;
    const date = oldRow.date;
    const direction = account.type === "asset" ? "lend" : "decrease";
    const draft = makeLoanDraft({
      date,
      description: oldRow.itemName,
      direction,
      loanAccountId: account.id,
      paymentAccountId,
      amount: oldRow.qty * oldRow.price,
    });
    const loanRow: BulkLoanRow = {
      type: "loan",
      input: null,
      draft,
      currency: selectedCurrency,
      paymentAccountId,
    };
    setRows((previous) => previous.map((row, rowIndex) => rowIndex === index ? loanRow : row));
    openLoanEditor(index, draft);
  }

  function handleLoanSubmit(input: CreateJournalInput) {
    if (editingLoanRowIndex == null || !paymentAccountId) return;
    const currentDraft = loanDraftRef.current ?? loanDraft;
    if (!currentDraft) return;
    const loanRow: BulkLoanRow = {
      type: "loan",
      input,
      draft: currentDraft,
      currency: selectedCurrency,
      paymentAccountId,
    };
    setRows((previous) => previous.map((row, index) =>
      index === editingLoanRowIndex ? loanRow : row,
    ));
    setLoanModalOpened(false);
    setEditingLoanRowIndex(null);
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
        transferAccountId: null,
        deferTransfer: undefined,
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

  function handlePaymentAccountChange(next: string | null) {
    setPaymentAccountId(next);
    const nextPaymentAccount = accounts.find((account) => account.id === Number(next));
    const canAllocateNext = canAllocateIncomeBudget(nextPaymentAccount);
    setRows((previous) => previous.map((row) => {
      if (row.type === "discount") {
        return {
          ...row,
          budgetCategoryId: canAllocateNext ? row.budgetCategoryId : null,
          transferAccountId: null,
          deferTransfer: canAllocateNext ? row.deferTransfer : undefined,
        };
      }
      if (row.type === "loan") {
        return invalidateLoanRow(row, selectedCurrency, next ?? "");
      }
      return row;
    }));
  }

  function getDiscountTransferNeed(row: BulkDiscountRow) {
    if (
      !paymentAccount ||
      paymentAccount.type !== "asset" ||
      paymentAccount.category !== "cash" ||
      paymentAccount.include_in_allocatable === false ||
      row.budgetCategoryId == null
    ) return null;
    return resolveIncomeTransferAccounts({
      categoryId: Number(row.budgetCategoryId),
      depositAccountId: paymentAccount.id,
      categories: budgetCategories,
      accounts,
    });
  }

  const expenseTotal = rows
    .filter((r): r is BulkExpenseRow => r.type === "expense")
    .reduce((s, r) => s + r.qty * r.price, 0);

  const discountTotal = rows
    .filter((r): r is BulkDiscountRow => r.type === "discount")
    .reduce((s, r) => s + r.amount, 0);

  const loanCashFlow = rows
    .filter((row): row is BulkLoanRow => row.type === "loan")
    .reduce((sum, row) => {
      if (row.input) {
        return sum + row.input.lines
          .filter((line) => line.account_id === Number(paymentAccountId))
          .reduce((lineSum, line) => lineSum + line.credit - line.debit, 0);
      }
      const amount = Number(row.draft.formValues.amount) || 0;
      const direction = row.draft.formValues.loanDirection;
      return sum + (direction === "increase" || direction === "collect" ? -amount : amount);
    }, 0);

  const calcTotal = expenseTotal - discountTotal + loanCashFlow;
  const billingTotal = billingRows.reduce(
    (s, r) => s + (Number(r.amount.replace(/,/g, "")) || 0),
    0,
  );
  const hasBillingInput = billingTotal > 0;
  const diff = calcTotal - billingTotal;

  function resetBulkForm() {
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
      statementCompletion: null,
    });
    setRows([fresh]);
    setBillingRows(freshBilling);
    setBillingChecked([false]);
    setStatementCompletion(null);
  }

  function clearPostedRows(keepStatement: boolean) {
    const fresh: BulkExpenseRow = {
      type: "expense",
      date: new Date(),
      itemName: "",
      qty: 1,
      price: 0,
      expenseAccountId: null,
    };
    const freshBilling = [{ ...DEFAULT_BILLING_ROW }];
    setRows([fresh]);
    setBillingRows(freshBilling);
    setBillingChecked([false]);
    setLoanModalOpened(false);
    setEditingLoanRowIndex(null);
    setLoanDraft(null);
    loanDraftRef.current = null;
    setBulkDraft({
      paymentAccountId,
      rows: [fresh],
      billingRows: freshBilling,
      statementCompletion: keepStatement ? statementCompletion : null,
    });
  }

  async function doPost(entries: CreateJournalInput[]) {
    const context = captureFeedbackContext({
      action: [t("tabBulkExpense"), accountDisplayNameFromName(paymentAccount?.name, t),
        statementCompletion ? `${t("creditCardStatementCompleteAction")} / ${statementMonthLabel}` : "",
      ].filter(Boolean).join(" / "),
    });
    setPosting(true);
    try {
      await api.journal.batchCreate({ entries });
      if (statementCompletion) {
        clearPostedRows(true);
        try {
          await api.creditCardStatements.complete(statementCompletion);
        } catch (error) {
          showFeedback({
            message: t("bulkExpenseSavedButStatementPending"),
            color: "yellow",
            context: { ...context, details: error instanceof Error ? error.message : String(error) },
          });
          onPosted();
          return;
        }
        setStatementCompletion(null);
        setLoanDraft(null);
        loanDraftRef.current = null;
        setBulkDraft({
          paymentAccountId,
          rows: [
            {
              type: "expense",
              date: new Date(),
              itemName: "",
              qty: 1,
              price: 0,
              expenseAccountId: null,
            },
          ],
          billingRows: [{ ...DEFAULT_BILLING_ROW }],
          statementCompletion: null,
        });
        try {
          await refreshCreditCardStatementCompletions();
        } catch (error) {
          showFeedback({
            message: t("bulkExpenseSavedButRefreshFailed"),
            color: "yellow",
            context: { ...context, details: error instanceof Error ? error.message : String(error) },
          });
          onPosted();
          return;
        }
      } else {
        clearPostedRows(false);
      }
      showFeedback({ message: t("bulkExpensePosted"), color: "teal", context });
      onPosted();
    } catch (error) {
      showFeedback({ message: t("saveFailed"), color: "red", context: {
        ...context, details: error instanceof Error ? error.message : String(error),
      } });
    } finally {
      setPosting(false);
    }
  }

  async function completeStatementWithoutPosting() {
    if (!statementCompletion) return;
    const context = captureFeedbackContext({ action: [
      t("creditCardStatementCompleteAction"), accountDisplayNameFromName(paymentAccount?.name, t), statementMonthLabel,
    ].filter(Boolean).join(" / ") });
    setCompletionPosting(true);
    try {
      await api.creditCardStatements.complete(statementCompletion);
      resetBulkForm();
      closeCompletionConfirm();
      try {
        await refreshCreditCardStatementCompletions();
      } catch (error) {
        showFeedback({
          message: t("bulkExpenseSavedButRefreshFailed"),
          color: "yellow",
          context: { ...context, details: error instanceof Error ? error.message : String(error) },
        });
        onPosted();
        return;
      }
      showFeedback({
        message: t("creditCardStatementCompleted").replace(
          "{month}",
          statementMonthLabel,
        ),
        color: "teal",
        context,
      });
      onPosted();
    } catch (error) {
      showFeedback({ message: t("saveFailed"), color: "red", context: {
        ...context, details: error instanceof Error ? error.message : String(error),
      } });
    } finally {
      setCompletionPosting(false);
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
    let built: { entries: CreateJournalInput[]; skippedCount: number };
    try {
      built = buildBulkJournalEntries({
        rows,
        paymentAccount,
        accounts,
        budgetCategories,
        currency: selectedCurrency,
        decimalPlaces: currencyDecimalPlaces,
        defaultExpenseDescription: t("bulkExpenseDefaultExpenseDesc"),
        defaultDiscountDescription: t("bulkExpenseDefaultDiscountDesc"),
      });
    } catch (error) {
      showFeedback({ message: submissionErrorMessage(error), color: "red" });
      return;
    }
    const { entries, skippedCount } = built;

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
      {statementCompletion && (
        <Alert color="teal" title={t("creditCardStatementCompleteTitle")}>
          <Stack gap="sm">
            <Text size="sm">
              {t("creditCardStatementCompleteHint").replace(
                "{month}",
                statementMonthLabel,
              )}
            </Text>
            <Group justify="flex-end">
              <Button
                size="xs"
                color="teal"
                variant="light"
                onClick={openCompletionConfirm}
              >
                {t("creditCardStatementMarkComplete").replace(
                  "{month}",
                  statementMonthLabel,
                )}
              </Button>
            </Group>
          </Stack>
        </Alert>
      )}

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
        renderOption={renderAccountOption as never}
        value={paymentAccountId}
        onChange={handlePaymentAccountChange}
        searchable={false}
        required
        w={300}
      />
      {rows.some((row) => row.type === "discount") &&
        paymentAccountId != null &&
        !canAllocateDiscountIncome && (
          <Alert color="gray" variant="light">
            {t("incomeOutsideBudgetHint")}
          </Alert>
        )}

      <ScrollArea>
        <Table
          withTableBorder
          striped
          highlightOnHover
          style={{ minWidth: 1120 }}
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
                      decimalScale={currencyDecimalPlaces}
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
                      renderOption={renderAccountOption as never}
                      value={row.expenseAccountId}
                      onChange={(v) => selectExpenseAccount(idx, v)}
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
              ) : row.type === "discount" ? (
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
                      decimalScale={currencyDecimalPlaces}
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
                      renderOption={renderAccountOption as never}
                      value={row.incomeAccountId}
                      onChange={(v) => updateRow(idx, { incomeAccountId: v })}
                      searchable={false}
                      clearable
                      placeholder={t("bulkExpenseIncomePlaceholder")}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Stack gap={4}>
                      {canAllocateDiscountIncome ? (
                        <Select
                          size="xs"
                          data={catOpts}
                          value={row.budgetCategoryId}
                          onChange={(v) => updateRow(idx, {
                            budgetCategoryId: v,
                            transferAccountId: null,
                            deferTransfer: undefined,
                          })}
                          searchable={false}
                          clearable
                          placeholder={t("bulkExpenseBudgetPlaceholder")}
                        />
                      ) : (
                        <Text size="xs" c="dimmed">—</Text>
                      )}
                      {(() => {
                        const need = getDiscountTransferNeed(row);
                        if (!need?.required || need.accountIds.length === 0) return null;
                        const targetOptions = need.accountIds
                          .map((accountId) => accounts.find((account) => account.id === accountId))
                          .filter((account): account is NonNullable<typeof account> => !!account)
                          .map((account) => toAccountSelectOption(account, t));
                        return (
                          <>
                            <Select
                              size="xs"
                              label={t("incomeTransferDestination")}
                              data={targetOptions}
                              renderOption={renderAccountOption as never}
                              value={
                                row.transferAccountId ??
                                (need.accountIds.length === 1
                                  ? String(need.accountIds[0])
                                  : null)
                              }
                              onChange={(value) => updateRow(idx, { transferAccountId: value })}
                              searchable={false}
                              required
                            />
                            <Checkbox
                              size="xs"
                              label={t("incomeTransferDeferLabel")}
                              checked={row.deferTransfer === true}
                              onChange={(event) => updateRow(idx, {
                                deferTransfer: event.currentTarget.checked,
                              })}
                            />
                            <Text size="xs" c="dimmed">
                              {t("incomeTransferDeferHint")}
                            </Text>
                          </>
                        );
                      })()}
                    </Stack>
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
                    <Badge color="grape" size="sm" variant="light">
                      {t("bulkExpenseRowTypeLoan")}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{rowDate(row).toLocaleDateString(locale)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" lineClamp={2}>
                      {row.input?.description || row.draft.formValues.description || t("bulkLoanUnnamed")}
                    </Text>
                  </Table.Td>
                  <Table.Td><Text size="xs" c="dimmed">—</Text></Table.Td>
                  <Table.Td>
                    <Text size="xs">
                      {formatCurrency(
                        Number(row.draft.formValues.amount) || 0,
                        locale,
                        selectedCurrency,
                        currencySymbol,
                      )}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" lineClamp={2}>
                      {accounts.find((account) => account.id === row.draft.formValues.loanAccountId)?.name ?? t("selectAccount")}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c={row.input ? "teal" : "orange"}>
                      {row.input ? t("bulkLoanConfigured") : t("bulkLoanNeedsConfiguration")}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <Button
                        size="compact-xs"
                        variant="light"
                        onClick={() => openLoanEditor(idx, row.draft)}
                      >
                        {t("bulkLoanConfigure")}
                      </Button>
                      <ActionIcon
                        color="red"
                        variant="subtle"
                        size="sm"
                        onClick={() => removeRow(idx)}
                        disabled={rows.length <= 1}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Group>
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
        <Button
          variant="light"
          color="grape"
          size="xs"
          leftSection={<IconPlus size={14} />}
          onClick={addLoanRow}
          disabled={!paymentAccountId}
        >
          {t("bulkExpenseAddLoanRow")}
        </Button>
        <Switch
          size="xs"
          label={t("bulkExpenseCopyLastDate")}
          checked={copyLastDate}
          onChange={(e) => {
            const v = e.currentTarget.checked;
            setCopyLastDate(v);
            localStorage.setItem(BULK_COPY_LAST_DATE_STORAGE_KEY, String(v));
          }}
        />
      </Group>

      <Divider />

      <Paper withBorder p="md" radius="md">
        <Stack gap="xs">
          <Group justify="space-between">
            <Text size="sm">{t("bulkExpenseCalcTotal")}</Text>
            <Text fw={700} size="sm">
              {formatCurrency(calcTotal, locale, selectedCurrency, currencySymbol)}
            </Text>
          </Group>
          <Divider />
          {billingRows.map((br, i) => {
            const checked = billingChecked[i] ?? false;

            return (
              <Group key={i} gap="xs" align="center">
                <Checkbox
                  size="xs"
                  checked={checked}
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
                  decimalScale={currencyDecimalPlaces}
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
                  rightSection={
                    checked ? (
                      <IconCheck
                        size={14}
                        color="var(--mantine-color-teal-7)"
                      />
                    ) : null
                  }
                  rightSectionWidth={26}
                  styles={{
                    input: checked
                      ? {
                          color: "var(--mantine-color-teal-7)",
                          fontWeight: 700,
                        }
                      : undefined,
                  }}
                />
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  color="gray"
                  onClick={() => {
                    setBillingRows((prev) => prev.filter((_, j) => j !== i));
                    setBillingChecked((prev) =>
                      prev.filter((_, j) => j !== i),
                    );
                  }}
                  disabled={billingRows.length === 1}
                >
                  <IconTrash size={12} />
                </ActionIcon>
              </Group>
            );
          })}
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
                    {formatCurrency(billingTotal, locale, selectedCurrency, currencySymbol)}
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
                  {formatCurrency(diff, locale, selectedCurrency, currencySymbol)}
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

      <Modal
        opened={loanModalOpened}
        onClose={() => {
          setLoanModalOpened(false);
          setEditingLoanRowIndex(null);
        }}
        title={t("bulkLoanEditorTitle")}
        size="xl"
        centered
      >
        {loanDraft && paymentAccountId && (
          <SimpleEntryForm
            key={loanEditorKey}
            accounts={accounts}
            budgetFilters={budgetFilters}
            fixedEntryType="loan"
            fixedLoanCounterAccountId={Number(paymentAccountId)}
            initialDraft={loanDraft}
            onDraftChange={handleLoanDraftChange}
            onSubmit={async (input) => handleLoanSubmit(input)}
            onCancel={() => {
              setLoanModalOpened(false);
              setEditingLoanRowIndex(null);
            }}
            submitLabel={t("bulkLoanSave")}
          />
        )}
      </Modal>

      <ConfirmModal
        opened={completionConfirmOpened}
        onClose={closeCompletionConfirm}
        onConfirm={() => void completeStatementWithoutPosting()}
        title={t("creditCardStatementCompleteTitle")}
        message={t("creditCardStatementCompleteConfirm").replace(
          "{month}",
          statementMonthLabel,
        )}
        confirmLabel={t("creditCardStatementCompleteAction")}
        confirmColor="teal"
        loading={completionPosting}
      />

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
