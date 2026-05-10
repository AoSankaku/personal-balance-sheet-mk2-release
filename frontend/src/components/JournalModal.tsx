import { Alert, Button, Group, Modal, Stack, Tabs, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import {
  type Account,
  type CreateJournalInput,
  type DepreciationSchedule,
  type JournalEntry,
  isAnyLendingCategory,
  isBusinessAdvanceCategory,
  isShortTermBorrowingCategory,
  isLongTermBorrowingCategory,
} from "@balance-sheet/shared";
import { api } from "../api/client";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import {
  SimpleEntryForm,
  type HouseholdForm,
  type BudgetDistributionItem,
  type SimpleEntryMeta,
  type SimpleFormDraft,
} from "./SimpleEntryForm";
import {
  MultiLineEntryForm,
  type MultiLineInitialValues,
} from "./MultiLineEntryForm";

interface Props {
  opened: boolean;
  accounts: Account[];
  editEntry?: JournalEntry;
  onClose: () => void;
  onSubmit: (
    values: CreateJournalInput,
    meta?: SimpleEntryMeta,
  ) => Promise<void>;
}

function detectBusinessAdvanceEntry(
  entry: JournalEntry,
  accounts: Account[],
): Partial<HouseholdForm> | null {
  const advanceLine = entry.lines.find((l) => {
    const acct = accounts.find((a) => a.id === l.account_id);
    return acct && isBusinessAdvanceCategory(acct.category) && l.debit > 0;
  });
  if (!advanceLine) return null;

  const advanceAcct = accounts.find((a) => a.id === advanceLine.account_id)!;
  const date = dayjs(entry.date).toDate();
  const description = entry.description;

  if (entry.lines.length === 2) {
    const paymentLine = entry.lines.find(
      (l) => l.account_id !== advanceLine.account_id,
    );
    if (!paymentLine) return null;
    return {
      date,
      description,
      entryType: "business_advance",
      amount: advanceLine.debit,
      businessAdvanceAccountId: advanceAcct.id,
      expensePaidFromId: paymentLine.account_id,
      businessRatio: 100,
      creditCardStatementOffsetMonths:
        paymentLine.credit_card_billing_offset_months ?? 0,
    };
  }

  if (entry.lines.length === 3) {
    const expenseLine = entry.lines.find((l) => {
      const acct = accounts.find((a) => a.id === l.account_id);
      return acct?.type === "expense" && l.debit > 0;
    });
    const paymentLine = entry.lines.find((l) => l.credit > 0);
    if (!expenseLine || !paymentLine) return null;
    const expenseAcct = accounts.find((a) => a.id === expenseLine.account_id);
    if (!expenseAcct) return null;

    const totalAmount = paymentLine.credit;
    const businessAmount = advanceLine.debit;
    const businessRatio =
      totalAmount > 0 ? Math.round((businessAmount / totalAmount) * 100) : 0;

    return {
      date,
      description,
      entryType: "business_advance",
      amount: totalAmount,
      businessAdvanceAccountId: advanceAcct.id,
      expensePaidFromId: paymentLine.account_id,
      expenseCategoryId: expenseAcct.id,
      businessRatio,
      creditCardStatementOffsetMonths:
        paymentLine.credit_card_billing_offset_months ?? 0,
    };
  }

  return null;
}

function detectSimpleEntry(
  entry: JournalEntry,
  accounts: Account[],
): Partial<HouseholdForm> | null {
  const baResult = detectBusinessAdvanceEntry(entry, accounts);
  if (baResult) return baResult;

  // 3-line entries (non-business-advance) always open in multi-line tab to prevent data loss
  if (entry.lines.length !== 2) return null;
  const debitLine = entry.lines.find((l) => l.debit > 0 && l.credit === 0);
  const creditLine = entry.lines.find((l) => l.credit > 0 && l.debit === 0);
  if (!debitLine || !creditLine) return null;
  if (Math.abs(debitLine.debit - creditLine.credit) > 0.001) return null;

  const debitAcct = accounts.find((a) => a.id === debitLine.account_id);
  const creditAcct = accounts.find((a) => a.id === creditLine.account_id);
  if (!debitAcct || !creditAcct) return null;

  const amount = debitLine.debit;
  const date = dayjs(entry.date).toDate();
  const description = entry.description;
  const base = {
    date,
    description,
    amount,
    creditCardStatementOffsetMonths: 0,
  };

  // Loan "lend": DR lending-asset(loan) / CR any-counter (including non-cc liability).
  // Must be checked before the generic "increase" check — otherwise
  // "DR lending-asset / CR non-cc-liability" would be misdetected as "increase".
  if (isAnyLendingCategory(debitAcct.category)) {
    return {
      ...base,
      entryType: "loan",
      loanDirection: "lend",
      loanAccountId: debitAcct.id,
      loanCounterAccountId: creditAcct.id,
    };
  }

  // Loan "increase" (borrow): DR asset/expense / CR non-credit-card liability
  // Must be checked before the generic expense check to avoid misclassifying
  // "DR expense / CR loan-liability" as a regular expense entry.
  if (
    (debitAcct.type === "asset" || debitAcct.type === "expense") &&
    creditAcct.type === "liability" &&
    creditAcct.category !== "credit_card"
  ) {
    return {
      ...base,
      entryType: "loan",
      loanDirection: "increase",
      loanCounterAccountId: debitAcct.id,
      loanAccountId: creditAcct.id,
    };
  }
  // Loan "increase" (borrow via liability transfer): DR liability-counter / CR non-cc-liability-main
  if (
    debitAcct.type === "liability" &&
    creditAcct.type === "liability" &&
    creditAcct.category !== "credit_card"
  ) {
    return {
      ...base,
      entryType: "loan",
      loanDirection: "increase",
      loanCounterAccountId: debitAcct.id,
      loanAccountId: creditAcct.id,
    };
  }

  // Loan "collect" with expense counter: DR expense(counter) / CR lending-asset(loan).
  // Must be checked before the generic expense check.
  if (
    debitAcct.type === "expense" &&
    isAnyLendingCategory(creditAcct.category)
  ) {
    return {
      ...base,
      entryType: "loan",
      loanDirection: "collect",
      loanAccountId: creditAcct.id,
      loanCounterAccountId: debitAcct.id,
    };
  }

  // Loan "decrease" with income counter (e.g. debt forgiveness):
  // DR loan-liability(main) / CR income(counter).
  // Must be checked before the generic income check.
  if (
    debitAcct.type === "liability" &&
    (isShortTermBorrowingCategory(debitAcct.category) ||
      isLongTermBorrowingCategory(debitAcct.category)) &&
    creditAcct.type === "income"
  ) {
    return {
      ...base,
      entryType: "loan",
      loanDirection: "decrease",
      loanAccountId: debitAcct.id,
      loanCounterAccountId: creditAcct.id,
    };
  }

  if (
    debitAcct.type === "expense" &&
    (creditAcct.type === "asset" ||
      (creditAcct.type === "liability" &&
        creditAcct.category === "credit_card"))
  ) {
    return {
      ...base,
      entryType: "expense",
      expenseCategoryId: debitAcct.id,
      expensePaidFromId: creditAcct.id,
      creditCardStatementOffsetMonths:
        creditLine.credit_card_billing_offset_months ?? 0,
    };
  }
  if (
    (debitAcct.type === "asset" || debitAcct.type === "liability") &&
    creditAcct.type === "income"
  ) {
    return {
      ...base,
      entryType: "income",
      incomeDepositedToId: debitAcct.id,
      incomeTypeId: creditAcct.id,
    };
  }
  if (debitAcct.type === "asset" && creditAcct.type === "asset") {
    // lend: DR lending-account / CR cash-account
    if (isAnyLendingCategory(debitAcct.category)) {
      return {
        ...base,
        entryType: "loan",
        loanDirection: "lend",
        loanAccountId: debitAcct.id,
        loanCounterAccountId: creditAcct.id,
      };
    }
    // collect: DR cash-account / CR lending-account
    if (isAnyLendingCategory(creditAcct.category)) {
      return {
        ...base,
        entryType: "loan",
        loanDirection: "collect",
        loanAccountId: creditAcct.id,
        loanCounterAccountId: debitAcct.id,
      };
    }
    return {
      ...base,
      entryType: "transfer",
      transferToId: debitAcct.id,
      transferFromId: creditAcct.id,
    };
  }
  // Loan "decrease" (repay): DR non-cc-liability-main / CR asset counter
  if (debitAcct.type === "liability" && creditAcct.type === "asset") {
    return {
      ...base,
      entryType: "loan",
      loanDirection: "decrease",
      loanAccountId: debitAcct.id,
      loanCounterAccountId: creditAcct.id,
    };
  }
  // Loan "decrease" (repay via liability transfer): DR non-cc-liability-main / CR liability-counter
  if (
    debitAcct.type === "liability" &&
    debitAcct.category !== "credit_card" &&
    creditAcct.type === "liability"
  ) {
    return {
      ...base,
      entryType: "loan",
      loanDirection: "decrease",
      loanAccountId: debitAcct.id,
      loanCounterAccountId: creditAcct.id,
    };
  }
  // Opening balance (元入金): DR asset / CR equity(opening_balance)
  if (
    debitAcct.type === "asset" &&
    creditAcct.type === "equity" &&
    creditAcct.category === "opening_balance"
  ) {
    return {
      ...base,
      entryType: "transfer",
      transferToId: debitAcct.id,
      transferFromId: creditAcct.id,
    };
  }
  return null;
}

function buildBudgetDist(
  entry: JournalEntry,
  expenseAccount: Account,
  budgetCategories: { id: number; name: string }[],
  amount: number,
): BudgetDistributionItem[] {
  const storedAllocs = entry.budget_allocations ?? [];
  if (storedAllocs.length > 0) {
    const configuredIds = new Set(
      storedAllocs.map((a) => a.budget_category_id),
    );
    const configured: BudgetDistributionItem[] = storedAllocs.map((alloc) => {
      const cat = budgetCategories.find(
        (c) => c.id === alloc.budget_category_id,
      );
      return {
        budget_category_id: alloc.budget_category_id,
        name: cat?.name ?? `#${alloc.budget_category_id}`,
        ratio: amount > 0 ? Math.round((-alloc.amount / amount) * 100) : 0,
        isDefault: false,
      };
    });
    const unconfigured: BudgetDistributionItem[] = budgetCategories
      .filter((c) => !configuredIds.has(c.id))
      .map((c) => ({
        budget_category_id: c.id,
        name: c.name,
        ratio: 0,
        isDefault: true,
      }));
    return [...configured, ...unconfigured];
  }
  const ratios = expenseAccount.budget_ratios ?? [];
  const configuredIds = new Set(ratios.map((r) => r.budget_category_id));
  const configured: BudgetDistributionItem[] = ratios.map((r) => ({
    budget_category_id: r.budget_category_id,
    name: r.budget_category_name ?? `#${r.budget_category_id}`,
    ratio: r.ratio,
    isDefault: r.ratio === 0,
  }));
  const unconfigured: BudgetDistributionItem[] = budgetCategories
    .filter((c) => !configuredIds.has(c.id))
    .map((c) => ({
      budget_category_id: c.id,
      name: c.name,
      ratio: 0,
      isDefault: true,
    }));
  return [...configured, ...unconfigured];
}

function buildDepreciationDraft(
  entry: JournalEntry,
  schedule: DepreciationSchedule,
): SimpleFormDraft {
  const amount =
    entry.lines.find((line) => line.debit > 0)?.debit ?? schedule.total_amount;
  const paymentLine = entry.lines.find((line) => line.credit > 0);

  return {
    formValues: {
      date: dayjs(entry.date).toDate(),
      description: schedule.description,
      amount,
      entryType: "expense",
      expensePaidFromId: paymentLine?.account_id ?? null,
    },
    budgetDist: [],
    showZeroCategories: false,
    depreciation: {
      enabled: true,
      scheduleId: schedule.id,
      assetAccountId: schedule.asset_account_id,
      expenseAccountId: schedule.expense_account_id,
      inputMode: "months",
      months: schedule.months,
      monthlyAmount:
        schedule.months > 0
          ? Math.round(schedule.total_amount / schedule.months)
          : "",
    },
  };
}

export function JournalModal({
  opened,
  accounts,
  editEntry,
  onClose,
  onSubmit,
}: Props) {
  const { t } = useLang();
  const { budgetCategories, budgetFilters, budgetSettings } = useAppData();
  const [activeTab, setActiveTab] = useState<string>("simple");
  const [depreciationSchedule, setDepreciationSchedule] =
    useState<DepreciationSchedule | null>(null);
  const [convertWarnOpen, setConvertWarnOpen] = useState(false);

  const { simpleInitDraft, nonConvertibleReason } = useMemo(() => {
    if (!opened || !editEntry) {
      return { simpleInitDraft: null, nonConvertibleReason: null };
    }
    if (
      editEntry.depreciation_entry_kind === "source" &&
      editEntry.depreciation_schedule_id != null
    ) {
      return {
        simpleInitDraft: depreciationSchedule
          ? buildDepreciationDraft(editEntry, depreciationSchedule)
          : null,
        nonConvertibleReason: null,
      };
    }
    const isMultilineSource =
      editEntry.budget_allocations?.[0]?.source === "multiline";
    const simpleValues = detectSimpleEntry(editEntry, accounts);

    if (!simpleValues) {
      return {
        simpleInitDraft: null,
        nonConvertibleReason: "type_mismatch" as const,
      };
    }
    if (isMultilineSource) {
      return {
        simpleInitDraft: null,
        nonConvertibleReason: "multiline_source" as const,
      };
    }

    let budgetDist: BudgetDistributionItem[] = [];
    if (
      simpleValues.entryType === "expense" &&
      simpleValues.expenseCategoryId != null
    ) {
      const expAcct = accounts.find(
        (a) => a.id === simpleValues.expenseCategoryId,
      );
      if (expAcct) {
        budgetDist = buildBudgetDist(
          editEntry,
          expAcct,
          budgetCategories,
          simpleValues.amount ?? 0,
        );
      }
    }

    // Restore personal budget distribution for split business_advance entries
    if (
      simpleValues.entryType === "business_advance" &&
      simpleValues.expenseCategoryId != null &&
      (simpleValues.businessRatio ?? 100) < 100
    ) {
      const expAcct = accounts.find(
        (a) => a.id === simpleValues.expenseCategoryId,
      );
      if (expAcct) {
        const personalAmount =
          (simpleValues.amount ?? 0) *
          (1 - (simpleValues.businessRatio ?? 0) / 100);
        const advBudgetCatId =
          budgetSettings?.business_advance_budget_category_id;
        const entryWithPersonalAllocs = {
          ...editEntry,
          budget_allocations: (editEntry.budget_allocations ?? []).filter(
            (a) => a.budget_category_id !== advBudgetCatId,
          ),
        };
        budgetDist = buildBudgetDist(
          entryWithPersonalAllocs,
          expAcct,
          budgetCategories,
          personalAmount,
        );
      }
    }

    let incomeDist: {
      budget_category_id: number;
      name: string;
      amount: number;
    }[] = [];
    if (simpleValues.entryType === "income") {
      incomeDist = (editEntry.income_budget_allocations ?? []).map((alloc) => {
        const cat = budgetCategories.find(
          (c) => c.id === alloc.budget_category_id,
        );
        return {
          budget_category_id: alloc.budget_category_id,
          name: cat?.name ?? `#${alloc.budget_category_id}`,
          amount: alloc.amount,
        };
      });
    }

    if (simpleValues.entryType === "transfer") {
      const transferBudgetAllocs = (
        editEntry.income_budget_allocations ?? []
      ).filter((alloc) => alloc.adjustment_type === "transfer");
      const sourceAlloc = transferBudgetAllocs.find(
        (alloc) => alloc.amount < 0,
      );
      const destinationAlloc = transferBudgetAllocs.find(
        (alloc) => alloc.amount > 0,
      );
      simpleValues.transferBudgetSourceCategoryId =
        sourceAlloc?.budget_category_id ?? null;
      simpleValues.transferBudgetDestinationCategoryId =
        destinationAlloc?.budget_category_id ?? null;
    }

    return {
      simpleInitDraft: {
        formValues: simpleValues,
        budgetDist,
        showZeroCategories: false,
        incomeDist,
      },
      nonConvertibleReason: null,
    };
  }, [
    opened,
    editEntry,
    accounts,
    budgetCategories,
    budgetSettings,
    depreciationSchedule,
  ]);

  const multiInitialValues = useMemo((): MultiLineInitialValues | undefined => {
    if (!opened || !editEntry) return undefined;
    const budgetAllocs: Record<number, number> = {};
    for (const a of editEntry.budget_allocations ?? []) {
      budgetAllocs[a.budget_category_id] = a.amount;
    }
    return {
      date: dayjs(editEntry.date).toDate(),
      description: editEntry.description,
      rows: editEntry.lines.map((l) => ({
        account_id: l.account_id,
        debit: l.debit,
        credit: l.credit,
        creditCardStatementOffsetMonths:
          l.credit_card_billing_offset_months ?? 0,
      })),
      budgetAllocs,
    };
  }, [opened, editEntry?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;

    async function loadDepreciationSchedule() {
      if (
        !opened ||
        !editEntry ||
        editEntry.depreciation_entry_kind !== "source" ||
        editEntry.depreciation_schedule_id == null
      ) {
        setDepreciationSchedule(null);
        return;
      }

      try {
        const schedules = await api.depreciation.list();
        if (cancelled) return;
        setDepreciationSchedule(
          schedules.find(
            (schedule) => schedule.id === editEntry.depreciation_schedule_id,
          ) ?? null,
        );
      } catch {
        if (!cancelled) setDepreciationSchedule(null);
      }
    }

    void loadDepreciationSchedule();
    return () => {
      cancelled = true;
    };
  }, [
    opened,
    editEntry?.id,
    editEntry?.depreciation_entry_kind,
    editEntry?.depreciation_schedule_id,
  ]);

  useEffect(() => {
    if (!opened) {
      setActiveTab("simple");
      setDepreciationSchedule(null);
      setConvertWarnOpen(false);
      return;
    }

    if (!editEntry) return;

    const canUseSimple =
      editEntry.depreciation_entry_kind === "source" ||
      (editEntry.budget_allocations?.[0]?.source !== "multiline" &&
        detectSimpleEntry(editEntry, accounts) != null);
    setActiveTab(canUseSimple ? "simple" : "multi");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, editEntry?.id]);

  async function handleSimpleSubmit(
    values: CreateJournalInput,
    meta?: SimpleEntryMeta,
  ) {
    await onSubmit(values, meta);
  }

  function handleClose() {
    setActiveTab("simple");
    setConvertWarnOpen(false);
    onClose();
  }

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={editEntry ? t("editTransactionTitle") : t("addTransactionTitle")}
      centered
      size="lg"
    >
      {editEntry?.depreciation_entry_kind === "monthly" && (
        <Alert color="yellow" mb="md" icon={<IconAlertTriangle size={16} />}>
          {t("depreciationEntryEditWarning")}
        </Alert>
      )}

      <Tabs
        value={activeTab}
        onChange={(v) => {
          if (
            editEntry?.depreciation_entry_kind === "source" &&
            v === "multi"
          ) {
            return;
          }
          if (v === "simple" && editEntry && nonConvertibleReason) {
            setConvertWarnOpen(true);
            return;
          }
          setActiveTab(v ?? "simple");
        }}
      >
        <Tabs.List mb="md">
          <Tabs.Tab value="simple">{t("tabSimple")}</Tabs.Tab>
          <Tabs.Tab
            value="multi"
            disabled={editEntry?.depreciation_entry_kind === "source"}
          >
            {t("tabMultiLine")}
          </Tabs.Tab>
        </Tabs.List>

        {/* ── Household simple tab ── */}
        <Tabs.Panel value="simple">
          <SimpleEntryForm
            key={
              editEntry
                ? `edit-${editEntry.id}-${editEntry.depreciation_entry_kind ?? "normal"}-${
                    depreciationSchedule?.id ?? 0
                  }`
                : "new"
            }
            accounts={accounts}
            budgetFilters={budgetFilters}
            onSubmit={handleSimpleSubmit}
            onCancel={handleClose}
            isEditing={!!editEntry && !!simpleInitDraft}
            editEntryId={editEntry?.id}
            initialDraft={simpleInitDraft ?? undefined}
            submitLabel={editEntry && simpleInitDraft ? t("save") : undefined}
          />
        </Tabs.Panel>

        {/* ── Multi-line tab ── */}
        <Tabs.Panel value="multi">
          <MultiLineEntryForm
            key={editEntry ? `edit-${editEntry.id}` : "new"}
            onSubmit={async (values) => {
              await onSubmit(values);
            }}
            onCancel={handleClose}
            initialValues={multiInitialValues}
            submitLabel={editEntry ? t("save") : undefined}
            editEntryId={editEntry?.id}
          />
        </Tabs.Panel>
      </Tabs>

      <Modal
        opened={convertWarnOpen}
        onClose={() => setConvertWarnOpen(false)}
        title={t("simpleConvertWarningTitle")}
        centered
        size="sm"
      >
        <Stack>
          <Text size="sm">
            {nonConvertibleReason === "multiline_source"
              ? t("simpleConvertMultilineSourceMsg")
              : t("simpleConvertTypeMismatchMsg")}
          </Text>
          <Group justify="flex-end">
            <Button onClick={() => setConvertWarnOpen(false)}>
              {t("cancel")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Modal>
  );
}
