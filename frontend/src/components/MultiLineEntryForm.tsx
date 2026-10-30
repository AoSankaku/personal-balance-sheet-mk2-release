import {
  ActionIcon,
  Accordion,
  Alert,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  Modal,
  NumberInput,
  Select,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useForm } from "@mantine/form";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconAlertTriangle,
  IconCalculator,
  IconInfoCircle,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
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
  type MultiLineDraft,
  type MultiLineRow,
} from "../utils/inputDrafts";
import {
  buildFundingComponentInput,
  calculateMultiLineBudgetFundingImpact,
  splitByLargestRemainder,
} from "../lib/multiLineBudgetFunding";
import { shouldUseReferenceBudgetAllocations } from "../lib/budgetConsistency";
import { calculateJournalIncomeBudgetImpact } from "../../../shared/journalIncomeBudget";
import { calculateExpenseTagAmounts } from "../../../shared/expenseTags";
import {
  buildManualTagExpenseSubmission,
  buildTagExpenseAmounts,
  initializeTagExpenseInputState,
  normalizeExpenseTagNames,
  resetTagExpenseInputState,
  parseTagExpenseAmount,
} from "../lib/expenseTagInput";
import { BudgetDistributionCalculator } from "./BudgetDistributionCalculator";
import { ExpenseTagInput } from "./ExpenseTagInput";
import {
  resolveIncomeTransferAccounts,
  splitIncomeAllocationsAcrossSources,
} from "../lib/incomeTransferAccounts";

type IncomeBudgetAllocationInput = NonNullable<CreateJournalInput["income_budget_allocations"]>[number];
type IncomeTransferDestinationInput = NonNullable<CreateJournalInput["income_transfer_destinations"]>[number];

export type { MultiLineRow };

interface MultiForm {
  date: Date;
  description: string;
  rows: MultiLineRow[];
}

export type MultiLineInitialValues = MultiLineDraft;

interface Props {
  onSubmit: (values: CreateJournalInput) => Promise<void>;
  onCancel?: () => void;
  onReset?: () => void;
  initialValues?: MultiLineInitialValues;
  submitLabel?: string;
  editEntryId?: number;
}

function sameBudgetAmounts(
  left: Record<number, number>,
  right: Record<number, number>,
  decimalPlaces: number,
): boolean {
  const scale = 10 ** decimalPlaces;
  const categoryIds = new Set([...Object.keys(left), ...Object.keys(right)].map(Number));
  return [...categoryIds].every((categoryId) =>
    Math.round((left[categoryId] ?? 0) * scale) ===
    Math.round((right[categoryId] ?? 0) * scale),
  );
}

function sameJournalLines(
  left: MultiLineRow[],
  right: MultiLineRow[],
  decimalPlaces: number,
): boolean {
  const scale = 10 ** decimalPlaces;
  const key = (rows: MultiLineRow[]) => rows
    .filter((row) => row.account_id != null && ((row.debit ?? 0) !== 0 || (row.credit ?? 0) !== 0))
    .map((row) => `${row.account_id}:${Math.round((row.debit ?? 0) * scale)}:${Math.round((row.credit ?? 0) * scale)}`)
    .sort()
    .join("|");
  return key(left) === key(right);
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
    budgetFilters,
    journal,
    enabledCurrencies,
    displayCurrency,
    displayCurrencySymbol: currencySymbol,
  } = useAppData();
  const selectedCurrency = displayCurrency || "JPY";
  const accountMap = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );
  const isMobile = useMediaQuery("(max-width: 48em)");
  const isControlled = initialValues != null;
  const draftInitialValues: MultiLineDraft | undefined = initialValues ?? multiDraft ?? undefined;

  const currencyDecimalPlaces =
    enabledCurrencies.find((currency) => currency.code === selectedCurrency)
      ?.decimal_places ?? 0;
  const initialIncomeLines = (draftInitialValues?.rows ?? [])
    .filter((row) => row.account_id != null)
    .map((row) => ({
      account_id: row.account_id!,
      debit: row.debit ?? 0,
      credit: row.credit ?? 0,
      currency: selectedCurrency,
    }));
  const initialIncomeImpact = draftInitialValues
    ? calculateJournalIncomeBudgetImpact({
        lines: initialIncomeLines,
        accounts,
        currency: selectedCurrency,
        decimalPlaces: currencyDecimalPlaces,
      })
    : null;
  const initialHasIncome = initialIncomeLines.some((line) =>
    accounts.find((account) => account.id === line.account_id)?.type === "income",
  );
  const initialHasExpense = initialIncomeLines.some((line) =>
    accounts.find((account) => account.id === line.account_id)?.type === "expense",
  );
  const hasLegacyIncomeAllocation =
    !draftInitialValues?.incomeBudgetAllocs &&
    (draftInitialValues?.incomeBudgetAllocations?.length ?? 0) === 0 &&
    (initialIncomeImpact?.totalCapacity ?? 0) > 0 &&
    (initialIncomeImpact?.isInvestmentSale || (initialHasIncome && !initialHasExpense)) &&
    Object.values(draftInitialValues?.budgetAllocs ?? {}).some((amount) => amount > 0);
  const legacyIncomeAllocations = hasLegacyIncomeAllocation
    ? Object.fromEntries(
        Object.entries(draftInitialValues?.budgetAllocs ?? {}).filter(([, amount]) => amount > 0),
      )
    : {};
  const legacyExpenseAllocations = hasLegacyIncomeAllocation
    ? Object.fromEntries(
        Object.entries(draftInitialValues?.budgetAllocs ?? {}).filter(([, amount]) => amount <= 0),
      )
    : draftInitialValues?.budgetAllocs ?? {};
  const initialIncomeBudgetTotals = draftInitialValues?.incomeBudgetAllocs ?? (draftInitialValues?.incomeBudgetAllocations?.length
    ? Object.fromEntries(
        draftInitialValues.incomeBudgetAllocations.reduce((totals, allocation) => {
          totals.set(
            allocation.budget_category_id,
            (totals.get(allocation.budget_category_id) ?? 0) + allocation.amount,
          );
          return totals;
        }, new Map<number, number>()),
      )
    : legacyIncomeAllocations);

  const [budgetAllocs, setBudgetAllocs] = useState<Record<number, number>>(
    legacyExpenseAllocations,
  );
  const [incomeBudgetAllocs, setIncomeBudgetAllocs] = useState<Record<number, number>>(
    initialIncomeBudgetTotals,
  );
  const [incomeTransferTargets, setIncomeTransferTargets] = useState<Record<number, number | null>>(() =>
    draftInitialValues?.incomeTransferTargets ?? Object.fromEntries((draftInitialValues?.incomeTransferDestinations ?? []).map((destination) => [destination.budget_category_id, destination.to_account_id])),
  );
  const [deferIncomeTransfers, setDeferIncomeTransfers] = useState<boolean | null | undefined>(() => {
    if (draftInitialValues?.deferIncomeTransfers !== undefined) return draftInitialValues.deferIncomeTransfers;
    const values = (draftInitialValues?.incomeTransferDestinations ?? []).map((destination) => destination.is_deferred);
    if (values.length === 0) return undefined;
    const distinct = new Set(values.map((value) => value ?? null));
    return distinct.size === 1 ? [...distinct][0] : undefined;
  });
  const [deferIncomeTransfersTouched, setDeferIncomeTransfersTouched] = useState(false);
  const [saleSourceAccountId, setSaleSourceAccountId] = useState<number | null>(() =>
    accounts.find((account) => account.type === "asset" && account.category === "investment")?.id ?? null,
  );
  const [saleReceivingAccountId, setSaleReceivingAccountId] = useState<number | null>(() =>
    accounts.find((account) => account.type === "asset" && account.category === "cash" && account.include_in_allocatable !== false && !account.is_depreciable)?.id ?? null,
  );
  const [saleProceeds, setSaleProceeds] = useState<number | string>(0);
  const [saleBookValue, setSaleBookValue] = useState<number | string>(0);
  const [saleGainAccountId, setSaleGainAccountId] = useState<number | null>(() =>
    accounts.find((account) => account.type === "income" && account.category === "investment")?.id ??
      accounts.find((account) => account.type === "income")?.id ?? null,
  );
  const [saleLossAccountId, setSaleLossAccountId] = useState<number | null>(() =>
    accounts.find((account) => account.type === "expense" && account.category === "investment_loss")?.id ?? null,
  );
  const initialFundingCategoryAmounts = useMemo(
    () =>
      Object.fromEntries(
        (initialValues?.budgetFundingComponents ?? []).map((component) => [
          component.kind,
          Object.fromEntries(
            budgetCategories.map((category) => [
              category.id,
              component.allocations
                .filter(
                  (allocation) =>
                    allocation.budget_category_id === category.id,
                )
                .reduce((sum, allocation) => sum + allocation.amount, 0),
            ]),
          ),
        ]),
      ) as Record<string, Record<number, number>>,
    [initialValues?.budgetFundingComponents, budgetCategories],
  );
  const [fundingCategoryAmounts, setFundingCategoryAmounts] = useState<
    Record<string, Record<number, number>>
  >(initialFundingCategoryAmounts);
  const [overBudgetWarnOpen, setOverBudgetWarnOpen] = useState(false);
  const [underBudgetWarnOpen, setUnderBudgetWarnOpen] = useState(false);
  const [budgetCalculatorOpen, setBudgetCalculatorOpen] = useState(false);
  const [expenseTags, setExpenseTags] = useState<string[]>(
    draftInitialValues?.expenseTags ?? [],
  );
  const initialTagExpenseState = initializeTagExpenseInputState(
    draftInitialValues?.tagExpenseMode ?? "auto",
    draftInitialValues?.tagExpenseAmounts ?? [],
    selectedCurrency,
  );
  const [tagExpenseMode, setTagExpenseMode] = useState(initialTagExpenseState.mode);
  const [tagExpenseAmounts, setTagExpenseAmounts] = useState(initialTagExpenseState.amounts);
  const [manualTagExpenseInputs, setManualTagExpenseInputs] = useState(initialTagExpenseState.manualInputs);
  const [tagExpenseCurrency, setTagExpenseCurrency] = useState(selectedCurrency);
  const [catalogExpenseTags, setCatalogExpenseTags] = useState<string[]>([]);
  const pendingValues = useRef<MultiForm | null>(null);

  useEffect(() => {
    if (tagExpenseCurrency === selectedCurrency) return;
    const reset = resetTagExpenseInputState();
    setTagExpenseCurrency(selectedCurrency);
    setTagExpenseMode(reset.mode);
    setTagExpenseAmounts(reset.amounts);
    setManualTagExpenseInputs(reset.manualInputs);
  }, [tagExpenseCurrency, selectedCurrency]);

  useEffect(() => {
    let cancelled = false;
    void api.expenseTags.list().then((tags) => {
      if (!cancelled) setCatalogExpenseTags(tags.map((tag) => tag.name));
    }).catch(() => {
      // Existing journal tags remain available when the catalog cannot be loaded.
    });
    return () => { cancelled = true; };
  }, []);

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
    initialValues: draftInitialValues ?? {
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
      setMultiDraft({
        ...form.values,
        expenseTags,
        tagExpenseMode,
        tagExpenseAmounts,
        budgetAllocs,
        incomeBudgetAllocs,
        incomeTransferTargets,
        deferIncomeTransfers,
      });
    }
  }, [form.values, expenseTags, tagExpenseMode, tagExpenseAmounts, budgetAllocs, incomeBudgetAllocs, incomeTransferTargets, deferIncomeTransfers, isControlled]);

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
  const budgetLines = form.values.rows
    .filter((row) => row.account_id != null)
    .map((row) => ({
      account_id: row.account_id!,
      debit: row.debit ?? 0,
      credit: row.credit ?? 0,
      currency: selectedCurrency,
    }));
  const incomeImpact = useMemo(
    () => calculateJournalIncomeBudgetImpact({
      lines: budgetLines,
      accounts,
      currency: selectedCurrency,
      decimalPlaces: currencyDecimalPlaces,
    }),
    [budgetLines.map((line) => `${line.account_id}:${line.debit}:${line.credit}`).join("|"), accounts, selectedCurrency, currencyDecimalPlaces],
  );
  const incomeBudgetCapacity = incomeImpact.isInvestmentSale
    ? incomeImpact.totalCapacity
    : incomeImpact.incomeCapacity;
  const totalIncomeBudgetAlloc = Object.values(incomeBudgetAllocs).reduce((sum, amount) => sum + Math.abs(amount), 0);
  const totalIncomeBudgetPct = incomeBudgetCapacity > 0
    ? Math.round((totalIncomeBudgetAlloc / incomeBudgetCapacity) * 1000) / 10
    : 0;
  const hasExpenseRow = form.values.rows.some(
    (r) =>
      r.account_id != null &&
      accounts.find((a) => a.id === r.account_id)?.type === "expense",
  );
  const tagExpenseStateMatchesCurrency = tagExpenseCurrency === selectedCurrency;
  const activeTagExpenseMode = tagExpenseStateMatchesCurrency ? tagExpenseMode : "auto";
  const activeTagExpenseAmounts = tagExpenseStateMatchesCurrency ? tagExpenseAmounts : [];
  const activeManualTagExpenseInputs = tagExpenseStateMatchesCurrency ? manualTagExpenseInputs : {};
  const tagExpenseCalculatedAmounts = useMemo(
    () => calculateExpenseTagAmounts(budgetLines, accounts),
    [
      budgetLines.map((line) => `${line.account_id}:${line.debit}:${line.credit}:${line.currency}`).join("|"),
      accounts,
    ],
  );
  const calculatedTagExpenseAmount =
    tagExpenseCalculatedAmounts.find((item) => item.currency === selectedCurrency)?.amount ?? 0;
  const manualTagExpenseAmount = activeTagExpenseAmounts.find(
    (item) => item.currency === selectedCurrency,
  )?.amount;
  const manualTagExpenseInput = activeManualTagExpenseInputs[selectedCurrency] ??
    manualTagExpenseAmount ?? calculatedTagExpenseAmount;
  const isManualTagExpenseInputValid =
    parseTagExpenseAmount(manualTagExpenseInput) != null;
  const expenseTagOptions = useMemo(
    () => [...new Set([
      ...catalogExpenseTags,
      ...(journal ?? []).flatMap((entry) => entry.expense_tags?.map((tag) => tag.name) ?? []),
    ])],
    [catalogExpenseTags, journal],
  );
  const hasIncomeRow = form.values.rows.some(
    (r) => r.account_id != null && accounts.find((a) => a.id === r.account_id)?.type === "income",
  );
  const showExpenseBudgetPanel = !incomeImpact.isInvestmentSale &&
    (hasExpenseRow || !hasIncomeRow || totalBudgetAlloc !== 0) ||
    (incomeImpact.isInvestmentSale && Object.values(budgetAllocs).some((amount) => amount < 0));
  const actualCashSources = Object.entries(incomeImpact.trackedCashInflowByAccount)
    .filter(([, amount]) => amount > 0)
    .map(([accountId, amount]) => ({ accountId: Number(accountId), amount }))
    .sort((left, right) => left.accountId - right.accountId);
  const incomeTransferNeeds = useMemo(
    () => {
      const sourceAllocations = splitIncomeAllocationsAcrossSources({
        allocations: budgetCategories.map((category) => ({
          budgetCategoryId: category.id,
          amount: incomeBudgetAllocs[category.id] ?? 0,
        })),
        sources: actualCashSources,
        decimalPlaces: currencyDecimalPlaces,
      });
      return budgetCategories.flatMap((category) => {
      const amount = incomeBudgetAllocs[category.id] ?? 0;
      if (amount <= 0 || actualCashSources.length === 0) return [];
      const sourcePlans = actualCashSources.map((source) => {
        const sourceResolution = resolveIncomeTransferAccounts({
          categoryId: category.id,
          depositAccountId: source.accountId,
          categories: budgetCategories,
          accounts,
        });
        return {
          accountId: source.accountId,
          receivedAmount: source.amount,
          amount: sourceAllocations[category.id]?.[source.accountId] ?? 0,
          required: sourceResolution.required,
          targetAccountIds: sourceResolution.accountIds,
        };
      }).filter((source) => source.amount > 0);
      const routedAmount = sourcePlans
        .filter((source) => source.required)
        .reduce((sum, source) => sum + source.amount, 0);
      return [{
        category,
        amount,
        sources: sourcePlans,
        routedAmount,
        targetAccountIds: sourcePlans[0]?.targetAccountIds ?? [],
        required: sourcePlans.some((source) => source.required),
      }];
      });
    },
    [budgetCategories, incomeBudgetAllocs, actualCashSources.map((source) => `${source.accountId}:${source.amount}`).join(","), accounts, currencyDecimalPlaces],
  );
  const hasCompletedIncomeTransfer = (journal ?? [])
    .find((entry) => entry.id === editEntryId)
    ?.income_transfer_requirements?.some((requirement) => requirement.completion_source != null) ?? false;
  useEffect(() => {
    setIncomeTransferTargets((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const need of incomeTransferNeeds) {
        const selected = previous[need.category.id];
        if (need.required && need.targetAccountIds.length === 1 && selected == null) {
          next[need.category.id] = need.targetAccountIds[0]!;
          changed = true;
        } else if (selected != null && !need.targetAccountIds.includes(selected)) {
          next[need.category.id] = null;
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [incomeTransferNeeds]);
  const fundingImpact = useMemo(
    () =>
      calculateMultiLineBudgetFundingImpact({
        lines: form.values.rows
          .filter((row) => row.account_id != null)
          .map((row) => ({
            account_id: row.account_id!,
            debit: row.debit ?? 0,
            credit: row.credit ?? 0,
            currency: selectedCurrency,
          })),
        accounts,
        currency: selectedCurrency,
        decimalPlaces: currencyDecimalPlaces,
      }),
    [form.values.rows, accounts, selectedCurrency, currencyDecimalPlaces],
  );
  const amountStep = 10 ** -currencyDecimalPlaces;
  const usesReferenceBudgetAllocations = shouldUseReferenceBudgetAllocations(
    form.values.rows
      .filter((row) => row.account_id != null)
      .map((row) => ({
        account_id: row.account_id!,
        debit: row.debit ?? 0,
        credit: row.credit ?? 0,
        currency: selectedCurrency,
      })),
    accountMap,
    selectedCurrency,
  );

  async function doSubmit(values: MultiForm) {
    const manualTagExpenseSubmission = activeTagExpenseMode === "manual" && expenseTags.length > 0
      ? buildManualTagExpenseSubmission(
          activeTagExpenseAmounts,
          selectedCurrency,
          activeManualTagExpenseInputs[selectedCurrency] ?? manualTagExpenseAmount,
          calculatedTagExpenseAmount,
        )
      : undefined;
    if (activeTagExpenseMode === "manual" && expenseTags.length > 0 && manualTagExpenseSubmission == null) {
      showFeedback({ message: t("tagExpenseAmountRequired"), color: "red" });
      return;
    }
    const validLines = values.rows.filter(
      (r) => r.account_id != null && (r.debit > 0 || r.credit > 0),
    );
    const referenceAllocations = shouldUseReferenceBudgetAllocations(
      validLines.map((row) => ({
        account_id: row.account_id!,
        debit: row.debit ?? 0,
        credit: row.credit ?? 0,
        currency: selectedCurrency,
      })),
      accountMap,
      selectedCurrency,
    );
    const budget_allocations = Object.entries(budgetAllocs)
      .filter(([, amt]) => incomeImpact.isInvestmentSale ? amt < 0 : amt !== 0)
      .map(([catId, amount]) => ({
        budget_category_id: Number(catId),
        amount,
        is_reference: referenceAllocations,
      }));
    const incomeAllocationsUnchanged = sameBudgetAmounts(
      incomeBudgetAllocs,
      initialIncomeBudgetTotals,
      currencyDecimalPlaces,
    );
    const journalLinesUnchanged = initialValues != null &&
      sameJournalLines(initialValues.rows, values.rows, currencyDecimalPlaces);
    const income_budget_allocations: IncomeBudgetAllocationInput[] =
      initialValues?.incomeBudgetAllocations?.length && incomeAllocationsUnchanged && journalLinesUnchanged
        ? initialValues.incomeBudgetAllocations
        : incomeImpact.isInvestmentSale
          ? (() => {
              const entries = Object.entries(incomeBudgetAllocs)
                .map(([categoryId, amount]) => ({ categoryId: Number(categoryId), amount: Math.max(0, amount) }))
                .filter((entry) => entry.amount > 0);
              const incomeParts = splitByLargestRemainder(
                Math.min(incomeImpact.incomeCapacity, entries.reduce((sum, entry) => sum + entry.amount, 0)),
                entries.map((entry) => entry.amount),
                currencyDecimalPlaces,
              );
              return entries.flatMap((entry, index) => {
                const incomeAmount = incomeParts[index] ?? 0;
                const principalAmount = entry.amount - incomeAmount;
                return [
                  ...(incomeAmount > 0 ? [{ budget_category_id: entry.categoryId, amount: incomeAmount, currency: selectedCurrency, adjustment_type: "allocation" as const }] : []),
                  ...(principalAmount > 0 ? [{ budget_category_id: entry.categoryId, amount: principalAmount, currency: selectedCurrency, adjustment_type: "transfer" as const }] : []),
                ];
              });
            })()
          : Object.entries(incomeBudgetAllocs)
              .filter(([, amount]) => amount !== 0)
              .map(([categoryId, amount]) => ({
                budget_category_id: Number(categoryId),
                amount,
                currency: selectedCurrency,
                adjustment_type: "allocation" as const,
              }));
    const savedDestinations = initialValues?.incomeTransferDestinations;
    const plannedTransferDestinations = incomeTransferNeeds.flatMap((need) => {
      if (!need.required) return [];
      const toAccountId = incomeTransferTargets[need.category.id];
      if (toAccountId == null) return [];
      return need.sources.filter((source) => source.required && source.amount > 0).map((source) => ({
        budget_category_id: need.category.id,
        from_account_id: source.accountId,
        to_account_id: toAccountId,
        amount: source.amount,
        currency: selectedCurrency,
      }));
    });
    const routeKey = (destination: Pick<IncomeTransferDestinationInput, "budget_category_id" | "from_account_id" | "to_account_id">) =>
      `${destination.budget_category_id}:${destination.from_account_id}:${destination.to_account_id}`;
    const savedRouteKeys = (savedDestinations ?? []).map(routeKey).sort();
    const plannedRouteKeys = plannedTransferDestinations.map(routeKey).sort();
    const incomeTransferRoutesUnchanged =
      savedDestinations != null &&
      savedRouteKeys.length === plannedRouteKeys.length &&
      savedRouteKeys.every((key, index) => key === plannedRouteKeys[index]);
    const income_transfer_destinations: IncomeTransferDestinationInput[] =
      incomeAllocationsUnchanged && journalLinesUnchanged && incomeTransferRoutesUnchanged && !deferIncomeTransfersTouched
        ? savedDestinations
        : plannedTransferDestinations.map((destination) => {
            const saved = savedDestinations?.find((candidate) => routeKey(candidate) === routeKey(destination));
            const deferred = deferIncomeTransfersTouched
              ? deferIncomeTransfers
              : saved ? saved.is_deferred : deferIncomeTransfers;
            return {
              ...destination,
              ...(deferred === undefined ? {} : { is_deferred: deferred }),
            };
          });
    const allSettledIds = Object.values(settledIdsByAccount).flat();
    const sourceEntries =
      allSettledIds.length === 0
        ? []
        : await Promise.all(
            [...new Set(allSettledIds)].map((sourceId) =>
              api.journal.get(sourceId),
            ),
          );
    const sourceEntryMap = new Map(
      sourceEntries.map((entry) => [entry.id, entry]),
    );
    const budget_funding_components = fundingImpact.components.map(
      (component) => {
        const appliedAmount = component.applied_amount;
        if (component.kind !== "repay" && component.kind !== "collect") {
          return buildFundingComponentInput({
            component,
            appliedAmount,
            categoryAmounts:
              fundingCategoryAmounts[component.kind] ?? {},
            currency: selectedCurrency,
            decimalPlaces: currencyDecimalPlaces,
          });
        }

        const sourceIds = Object.entries(settledIdsByAccount).flatMap(
          ([accountIdText, ids]) => {
            const account = accounts.find(
              (candidate) => candidate.id === Number(accountIdText),
            );
            const matches =
              component.kind === "repay"
                ? account &&
                  isShortTermBorrowingCategory(account.category)
                : account &&
                  isShortTermLendingCategory(account.category);
            return matches ? ids : [];
          },
        );
        const openingKind = component.kind === "repay" ? "borrow" : "lend";
        const sourceAllocations = sourceIds.flatMap((sourceId) => {
          const sourceEntry = sourceEntryMap.get(sourceId);
          const saved = (
            sourceEntry?.budget_funding_components
              ?.filter((savedComponent) => savedComponent.kind === openingKind)
              .flatMap((savedComponent) => savedComponent.allocations) ??
            (sourceEntry?.budget_funding?.kind === openingKind
              ? sourceEntry.budget_funding.allocations
              : [])
          ).filter((allocation) => allocation.amount > 0);
          const savedTotal = saved.reduce(
            (sum, allocation) => sum + allocation.amount,
            0,
          );
          const sourcePrincipal =
            Object.values(unsettledByAccount)
              .flat()
              .find((entry) => entry.journal_entry_id === sourceId)?.amount ??
            savedTotal;
          return [
            ...saved.map((allocation) => ({
              budget_category_id: allocation.budget_category_id,
              amount: allocation.amount,
              source_journal_entry_id: sourceId,
            })),
            ...(sourcePrincipal - savedTotal > 0
              ? [{
                  budget_category_id: null,
                  amount: sourcePrincipal - savedTotal,
                  source_journal_entry_id: sourceId,
                }]
              : []),
          ];
        });
        if (sourceAllocations.length === 0) {
          return buildFundingComponentInput({
            component,
            appliedAmount,
            categoryAmounts:
              fundingCategoryAmounts[component.kind] ?? {},
            currency: selectedCurrency,
            decimalPlaces: currencyDecimalPlaces,
            sourceJournalEntryIds: sourceIds,
          });
        }
        const principalParts = splitByLargestRemainder(
          component.principal_amount,
          sourceAllocations.map((allocation) => allocation.amount),
          currencyDecimalPlaces,
        );
        const appliedParts = splitByLargestRemainder(
          appliedAmount,
          principalParts,
          currencyDecimalPlaces,
        );
        const allocations = sourceAllocations.flatMap((allocation, index) => {
          const principalPart = principalParts[index] ?? 0;
          const appliedPart = Math.min(
            principalPart,
            appliedParts[index] ?? 0,
          );
          return [
            ...(appliedPart > 0
              ? [{
                  ...allocation,
                  amount: appliedPart,
                  currency: selectedCurrency,
                  effect: "apply" as const,
                }]
              : []),
            ...(principalPart - appliedPart > 0
              ? [{
                  ...allocation,
                  amount: principalPart - appliedPart,
                  currency: selectedCurrency,
                  effect: "component_only" as const,
                }]
              : []),
          ];
        });
        const scale = 10 ** currencyDecimalPlaces;
        const roundedApplied =
          Math.round(appliedAmount * scale) / scale;
        return {
          kind: component.kind,
          principal_amount: component.principal_amount,
          applied_amount: roundedApplied,
          component_only_amount:
            Math.round(
              (component.principal_amount - roundedApplied) * scale,
            ) / scale,
          allocations,
          source_journal_entry_ids: sourceIds,
        };
      },
    );
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
      income_budget_allocations:
        income_budget_allocations.length > 0 ? income_budget_allocations : undefined,
      income_transfer_destinations:
        income_transfer_destinations.length > 0 ? income_transfer_destinations :
          initialValues?.incomeTransferDestinations ? [] : undefined,
      budget_source: "multiline",
      expense_tags: normalizeExpenseTagNames(expenseTags),
      tag_expense_mode: expenseTags.length > 0 ? activeTagExpenseMode : "auto",
      ...(expenseTags.length > 0 && activeTagExpenseMode === "manual"
        ? { tag_expense_amounts: manualTagExpenseSubmission! }
        : {}),
      loan_settlement_opening: openingAccountIds.length > 0 || undefined,
      loan_settlement_journal_entry_ids:
        allSettledIds.length > 0 ? allSettledIds : undefined,
      budget_funding_components:
        budget_funding_components.length > 0
          ? budget_funding_components
          : undefined,
    });
    if (!isControlled) {
      setMultiDraft(null);
      form.reset();
      setBudgetAllocs({});
      setIncomeBudgetAllocs({});
      setExpenseTags([]);
      const resetTagExpense = resetTagExpenseInputState();
      setTagExpenseCurrency(selectedCurrency);
      setTagExpenseMode(resetTagExpense.mode);
      setTagExpenseAmounts(resetTagExpense.amounts);
      setManualTagExpenseInputs(resetTagExpense.manualInputs);
      setSettledIdsByAccount({});
      setFundingCategoryAmounts({});
    }
  }

  async function handleSubmit(values: MultiForm) {
    if (expenseTags.length > 0 && activeTagExpenseMode === "manual" && !isManualTagExpenseInputValid) {
      showFeedback({ message: t("tagExpenseAmountRequired"), color: "red" });
      return;
    }
    if (budgetCategories.length > 0 && (totalBudgetPct > 100 || totalIncomeBudgetPct > 100)) {
      setOverBudgetWarnOpen(true);
      return;
    }
    if (totalIncomeBudgetAlloc > incomeBudgetCapacity + 10 ** -currencyDecimalPlaces / 2) {
      showFeedback({ message: t("incomeBudgetCapacityError"), color: "red" });
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
    const incomeLineTotal = budgetLines.reduce((sum, line) => {
      const account = accountMap.get(line.account_id);
      return account?.type === "income" ? sum + line.credit - line.debit : sum;
    }, 0);
    const expectedDirection = incomeLineTotal < 0 ? -1 : 1;
    if (!incomeImpact.isInvestmentSale && Object.values(incomeBudgetAllocs).some((amount) => amount !== 0 && Math.sign(amount) !== expectedDirection)) {
      showFeedback({ message: t("incomeBudgetDirectionError"), color: "red" });
      return;
    }
    for (const need of incomeTransferNeeds) {
      if (!need.required) continue;
      if (!need.sources.some((source) => source.required && source.amount > 0) || incomeTransferTargets[need.category.id] == null) {
        showFeedback({ message: t("incomeTransferRequiredHint"), color: "red" });
        return;
      }
    }
    const plannedTransfersBySource = new Map<number, number>();
    for (const need of incomeTransferNeeds) {
      if (!need.required) continue;
      for (const source of need.sources) {
        if (!source.required) continue;
        plannedTransfersBySource.set(source.accountId, (plannedTransfersBySource.get(source.accountId) ?? 0) + source.amount);
      }
    }
    if ([...plannedTransfersBySource].some(([sourceId, amount]) =>
      amount > (incomeImpact.trackedCashInflowByAccount[sourceId] ?? 0) + 10 ** -currencyDecimalPlaces / 2,
    )) {
      showFeedback({ message: t("incomeTransferSourceAmountError"), color: "red" });
      return;
    }
    try {
      await doSubmit(values);
    } catch (e) {
      const msg =
        e instanceof ApiError &&
        e.body.error === "income_transfer_completed_conflict"
          ? t("incomeTransferEditConflict")
          : e instanceof ApiError
            ? e.message
            : String(e);
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

  function createInvestmentSaleRows() {
    const proceeds = Number(saleProceeds) || 0;
    const bookValue = Number(saleBookValue) || 0;
    if (saleSourceAccountId == null || saleReceivingAccountId == null || proceeds <= 0 || bookValue < 0) return;
    const difference = proceeds - bookValue;
    if (difference > 0 && saleGainAccountId == null) return;
    if (difference < 0 && saleLossAccountId == null) return;
    const rows: MultiLineRow[] = [
      { account_id: saleReceivingAccountId, debit: proceeds, credit: 0, creditCardStatementOffsetMonths: 0 },
    ];
    if (bookValue > 0) rows.push({ account_id: saleSourceAccountId, debit: 0, credit: bookValue, creditCardStatementOffsetMonths: 0 });
    if (difference > 0 && saleGainAccountId != null) rows.push({ account_id: saleGainAccountId, debit: 0, credit: difference, creditCardStatementOffsetMonths: 0 });
    if (difference < 0 && saleLossAccountId != null) rows.push({ account_id: saleLossAccountId, debit: -difference, credit: 0, creditCardStatementOffsetMonths: 0 });
    while (rows.length < 2) rows.push({ account_id: null, debit: 0, credit: 0, creditCardStatementOffsetMonths: 0 });
    form.setValues({
      ...form.values,
      description: form.values.description || t("investmentSaleInputTitle"),
      rows,
    });
    setBudgetAllocs({});
    setIncomeBudgetAllocs({});
  }

  return (
    <>
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack>
          <Group justify="flex-end">
            <Button type="button" variant="light" leftSection={<IconCalculator size={16} />}
              onClick={() => setBudgetCalculatorOpen(true)}>{t("budgetCalculatorTitle")}</Button>
          </Group>
          <Accordion variant="separated" data-testid="investment-sale-assist">
            <Accordion.Item value="investment-sale">
              <Accordion.Control>{t("investmentSaleInputTitle")}</Accordion.Control>
              <Accordion.Panel>
                <Stack gap="xs">
                  <SimpleGrid cols={{ base: 1, sm: 2 }}>
                    <Select
                      label={t("investmentSaleSourceAccount")}
                      data={accounts.filter((account) => account.type === "asset" && account.category === "investment").map((account) => toAccountOption(account, t))}
                      renderOption={renderAccountOption}
                      value={saleSourceAccountId == null ? null : String(saleSourceAccountId)}
                      onChange={(value) => setSaleSourceAccountId(value ? Number(value) : null)}
                    />
                    <Select
                      label={t("investmentSaleReceivingAccount")}
                      data={accounts.filter((account) => account.type === "asset" && account.category === "cash" && account.include_in_allocatable !== false && !account.is_depreciable).map((account) => toAccountOption(account, t))}
                      renderOption={renderAccountOption}
                      value={saleReceivingAccountId == null ? null : String(saleReceivingAccountId)}
                      onChange={(value) => setSaleReceivingAccountId(value ? Number(value) : null)}
                    />
                    <NumberInput
                      label={t("investmentSaleProceeds")}
                      min={0}
                      step={amountStep}
                      decimalScale={currencyDecimalPlaces}
                      prefix={currencySymbol}
                      thousandSeparator=","
                      value={saleProceeds}
                      onChange={setSaleProceeds}
                    />
                    <NumberInput
                      label={t("investmentSaleBookValue")}
                      min={0}
                      step={amountStep}
                      decimalScale={currencyDecimalPlaces}
                      prefix={currencySymbol}
                      thousandSeparator=","
                      value={saleBookValue}
                      onChange={setSaleBookValue}
                    />
                    {Number(saleProceeds) > Number(saleBookValue) && (
                      <Select
                        label={t("investmentSaleGainAccount")}
                        data={accounts.filter((account) => account.type === "income").map((account) => toAccountOption(account, t))}
                        renderOption={renderAccountOption}
                        value={saleGainAccountId == null ? null : String(saleGainAccountId)}
                        onChange={(value) => setSaleGainAccountId(value ? Number(value) : null)}
                      />
                    )}
                    {Number(saleBookValue) > Number(saleProceeds) && (
                      <Select
                        label={t("investmentSaleLossAccount")}
                        data={accounts.filter((account) => account.type === "expense" && account.category === "investment_loss").map((account) => toAccountOption(account, t))}
                        renderOption={renderAccountOption}
                        value={saleLossAccountId == null ? null : String(saleLossAccountId)}
                        onChange={(value) => setSaleLossAccountId(value ? Number(value) : null)}
                      />
                    )}
                  </SimpleGrid>
                  {Number(saleProceeds) !== Number(saleBookValue) && Number(saleProceeds) > 0 && (
                    <Text size="sm" c={Number(saleProceeds) > Number(saleBookValue) ? "teal" : "red"}>
                      {Number(saleProceeds) > Number(saleBookValue) ? t("investmentSaleProfit") : t("investmentSaleLoss")}: {formatCurrency(Math.abs(Number(saleProceeds) - Number(saleBookValue)), locale, selectedCurrency, currencySymbol)}
                    </Text>
                  )}
                  <Text size="xs" c="dimmed">{t("investmentSaleInputHint")}</Text>
                  <Group justify="flex-end">
                    <Button
                      variant="light"
                      disabled={Number(saleProceeds) <= 0 || saleSourceAccountId == null || saleReceivingAccountId == null || (Number(saleProceeds) > Number(saleBookValue) && saleGainAccountId == null) || (Number(saleBookValue) > Number(saleProceeds) && saleLossAccountId == null)}
                      onClick={createInvestmentSaleRows}
                    >
                      {t("investmentSaleCreate")}
                    </Button>
                  </Group>
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
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

          <Stack gap="xs">
            <ExpenseTagInput
              label={t("expenseTagsLabel")}
              placeholder={t("expenseTagsPlaceholder")}
              options={expenseTagOptions}
              value={expenseTags}
              onChange={(next) => {
                const normalized = normalizeExpenseTagNames(next);
                setExpenseTags(normalized);
                if (normalized.length === 0) {
                  const reset = resetTagExpenseInputState();
                  setTagExpenseCurrency(selectedCurrency);
                  setTagExpenseMode(reset.mode);
                  setTagExpenseAmounts(reset.amounts);
                  setManualTagExpenseInputs(reset.manualInputs);
                }
              }}
            />
            {expenseTags.length > 0 && (
              <Stack gap={4}>
                <SegmentedControl
                  data-testid="tag-expense-mode"
                  fullWidth
                  value={activeTagExpenseMode}
                  onChange={(value) => {
                    const nextMode = value as "auto" | "manual";
                    setTagExpenseMode(nextMode);
                    if (nextMode === "auto") {
                      const reset = resetTagExpenseInputState();
                      setTagExpenseCurrency(selectedCurrency);
                      setTagExpenseAmounts(reset.amounts);
                      setManualTagExpenseInputs(reset.manualInputs);
                    } else if (manualTagExpenseAmount == null) {
                      setTagExpenseCurrency(selectedCurrency);
                      setManualTagExpenseInputs((previous) => ({
                        ...previous,
                        [selectedCurrency]: calculatedTagExpenseAmount,
                      }));
                      setTagExpenseAmounts(buildTagExpenseAmounts(
                        activeTagExpenseAmounts,
                        selectedCurrency,
                        calculatedTagExpenseAmount,
                      ));
                    }
                  }}
                  data={[
                    { value: "auto", label: t("tagExpenseAuto") },
                    { value: "manual", label: t("tagExpenseManual") },
                  ]}
                />
                {activeTagExpenseMode === "manual" ? (
                  <>
                    <NumberInput
                      data-testid="tag-expense-amount"
                      label={t("tagExpenseAmount")}
                      value={manualTagExpenseInput}
                      error={isManualTagExpenseInputValid ? undefined : t("tagExpenseAmountRequired")}
                      onChange={(value) => {
                        setManualTagExpenseInputs((previous) => ({ ...previous, [selectedCurrency]: value }));
                        setTagExpenseAmounts((previous) =>
                          buildTagExpenseAmounts(previous, selectedCurrency, value),
                        );
                      }}
                      decimalScale={currencyDecimalPlaces}
                      thousandSeparator
                      allowNegative
                      leftSection={currencySymbol}
                    />
                    <Text size="xs" c="dimmed">{t("tagExpenseAmountHint")}</Text>
                  </>
                ) : (
                  <Text size="sm" c="dimmed">
                    <span data-testid="tag-expense-auto-value">
                      {t("tagExpenseAuto")}: {formatCurrency(calculatedTagExpenseAmount, locale, selectedCurrency, currencySymbol)}
                    </span>
                  </Text>
                )}
              </Stack>
            )}
          </Stack>

          {form.values.rows.map((row, i) =>
            isMobile ? (
              <Stack
                key={i}
                data-testid={`multiline-entry-row-${i}`}
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
              <Group key={i} data-testid={`multiline-entry-row-${i}`} align="flex-end">
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

          {fundingImpact.components.length > 0 && (
            <>
              <Divider
                label={t("multiLineFundingTitle")}
                labelPosition="left"
              />
              <Text size="xs" c="dimmed">
                {t("multiLineFundingHint")}
              </Text>
              {fundingImpact.components.map((component) => {
                const applied = component.applied_amount;
                const componentOnly = Math.max(
                  0,
                  component.principal_amount - applied,
                );
                const categoryAmounts =
                  fundingCategoryAmounts[component.kind] ?? {};
                const allocated = Object.values(categoryAmounts).reduce(
                  (sum, amount) => sum + amount,
                  0,
                );
                return (
                  <Stack
                    key={component.kind}
                    gap={6}
                    p="sm"
                    style={{
                      border: "1px solid var(--mantine-color-default-border)",
                      borderRadius: "var(--mantine-radius-sm)",
                    }}
                  >
                    <Group justify="space-between">
                      <Text fw={600} size="sm">
                        {t(
                          component.kind === "borrow"
                            ? "fundingKindBorrow"
                            : component.kind === "repay"
                              ? "fundingKindRepay"
                              : component.kind === "lend"
                                ? "fundingKindLend"
                                : "fundingKindCollect",
                        )}
                      </Text>
                      <Badge variant="light">
                        {t("fundingPrincipal")}:{" "}
                        {formatCurrency(
                          component.principal_amount,
                          locale,
                          selectedCurrency,
                          currencySymbol,
                        )}
                      </Badge>
                    </Group>
                    <SimpleGrid cols={{ base: 1, sm: 2 }}>
                      <NumberInput
                        label={t("fundingApplied")}
                        min={0}
                        max={component.principal_amount}
                        step={amountStep}
                        decimalScale={currencyDecimalPlaces}
                        prefix={currencySymbol}
                        thousandSeparator=","
                        value={applied}
                        readOnly
                      />
                      <NumberInput
                        label={
                          component.kind === "collect"
                            ? t("fundingDiscarded")
                            : component.kind === "repay"
                              ? t("fundingConvertedToOwn")
                              : t("fundingNotApplied")
                        }
                        value={componentOnly}
                        prefix={currencySymbol}
                        thousandSeparator=","
                        readOnly
                      />
                    </SimpleGrid>
                    <Text size="xs" fw={500}>
                      {t("fundingCategoryBreakdown")}
                    </Text>
                    {budgetCategories.map((category) => (
                      <Group key={category.id} gap="xs">
                        <Text size="sm" flex={1}>
                          {category.name}
                        </Text>
                        <NumberInput
                          w={150}
                          min={0}
                          max={component.principal_amount}
                          step={amountStep}
                          decimalScale={currencyDecimalPlaces}
                          prefix={currencySymbol}
                          thousandSeparator=","
                          value={categoryAmounts[category.id] ?? 0}
                          onChange={(value) =>
                            setFundingCategoryAmounts((previous) => ({
                              ...previous,
                              [component.kind]: {
                                ...(previous[component.kind] ?? {}),
                                [category.id]: Number(value) || 0,
                              },
                            }))
                          }
                        />
                      </Group>
                    ))}
                    <Text
                      size="xs"
                      c={
                        allocated > component.principal_amount
                          ? "red"
                          : "dimmed"
                      }
                    >
                      {t("loanFundingUnallocated")}:{" "}
                      {formatCurrency(
                        component.principal_amount - allocated,
                        locale,
                        selectedCurrency,
                        currencySymbol,
                      )}
                    </Text>
                    <Text size="xs" c="dimmed" display="none">
                      {component.component_only_amount}
                    </Text>
                  </Stack>
                );
              })}
            </>
          )}

          {budgetCategories.length > 0 && showExpenseBudgetPanel && (
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
              {usesReferenceBudgetAllocations && totalBudgetAlloc !== 0 && (
                <Alert
                  color="blue"
                  variant="light"
                  icon={<IconInfoCircle size={18} />}
                  title={t("budgetReferenceAllocationTitle")}
                >
                  {t("budgetReferenceAllocationHint")}
                </Alert>
              )}
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
                        aria-label={cat.name}
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

          {budgetCategories.length > 0 && (incomeImpact.isInvestmentSale || incomeImpact.incomeCapacity > 0 || totalIncomeBudgetAlloc > 0) && (
            <Stack gap="xs" data-testid="multiline-income-budget">
              <Divider label={t("multiLineIncomeBudgetTitle")} labelPosition="left" />
              <Group justify="space-between">
                <Text size="xs" c="dimmed">{t("multiLineIncomeBudgetAllocHint")}</Text>
                <Badge size="xs" variant="light" color={totalIncomeBudgetPct > 100 ? "red" : "teal"}>
                  {t("budgetDistributionTotal")}: {totalIncomeBudgetPct}%
                </Badge>
              </Group>
              {incomeImpact.isInvestmentSale && (
                <Alert color="blue" variant="light" icon={<IconInfoCircle size={18} />}>
                  {t("multiLineInvestmentReturnHint")}
                </Alert>
              )}
              {!incomeImpact.isInvestmentSale && incomeImpact.incomeCapacity <= 0 && totalIncomeBudgetAlloc > 0 && (
                <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={18} />}>
                  {t("incomeBudgetCapacityError")}
                </Alert>
              )}
              <Stack gap={6}>
                {budgetCategories.map((category) => {
                  const amount = incomeBudgetAllocs[category.id] ?? 0;
                  const percentage = incomeBudgetCapacity > 0
                    ? Math.round((amount / incomeBudgetCapacity) * 1000) / 10
                    : 0;
                  return (
                    <Group key={category.id} align="center" gap="xs">
                      <Text size="sm" flex={1}>{category.name}</Text>
                      <NumberInput
                        w={90}
                        size="sm"
                        aria-label={`${category.name} %`}
                        min={incomeImpact.isInvestmentSale ? 0 : undefined}
                        allowNegative={!incomeImpact.isInvestmentSale}
                        suffix="%"
                        decimalScale={1}
                        placeholder="0"
                        hideControls={isMobile}
                        disabled={incomeBudgetCapacity <= 0}
                        value={percentage}
                        onChange={(value) => {
                          const next = incomeBudgetCapacity > 0
                            ? Math.round((incomeBudgetCapacity * (Number(value) || 0) / 100) * 10 ** currencyDecimalPlaces) / 10 ** currencyDecimalPlaces
                            : 0;
                          setIncomeBudgetAllocs((previous) => ({ ...previous, [category.id]: next }));
                        }}
                      />
                      <NumberInput
                        w={130}
                        size="sm"
                        aria-label={category.name}
                        min={incomeImpact.isInvestmentSale ? 0 : undefined}
                        allowNegative={!incomeImpact.isInvestmentSale}
                        prefix={currencySymbol}
                        thousandSeparator=","
                        step={amountStep}
                        decimalScale={currencyDecimalPlaces}
                        placeholder="0"
                        hideControls={isMobile}
                        value={amount}
                        onChange={(value) => setIncomeBudgetAllocs((previous) => ({ ...previous, [category.id]: Number(value) || 0 }))}
                      />
                    </Group>
                  );
                })}
              </Stack>
              {incomeTransferNeeds.some((need) => need.required) && (
                <Stack gap="xs">
                  <Checkbox
                    label={t("incomeTransferDeferLabel")}
                    checked={deferIncomeTransfers === true}
                    indeterminate={editEntryId != null && deferIncomeTransfers === undefined}
                    disabled={hasCompletedIncomeTransfer}
                    onChange={(event) => {
                      setDeferIncomeTransfers(event.currentTarget.checked);
                      setDeferIncomeTransfersTouched(true);
                    }}
                  />
                  <Text size="xs" c="dimmed">{t("incomeTransferDeferHint")}</Text>
                  {incomeTransferNeeds.filter((need) => need.required).map((need) => {
                    return (
                      <Stack key={need.category.id} gap={4} p="xs" style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: "var(--mantine-radius-sm)" }}>
                        <Text size="xs" fw={600}>
                          {t("incomeTransferRequiredTitle")}: {need.category.name}・{formatCurrency(need.routedAmount, locale, selectedCurrency, currencySymbol)}
                        </Text>
                        {need.sources.filter((source) => source.required).length > 1 && (
                          <Stack gap={2}>
                            <Text size="xs" c="dimmed">{t("incomeTransferSourceAccount")}</Text>
                            {need.sources.filter((source) => source.required).map((source) => {
                              const account = accounts.find((candidate) => candidate.id === source.accountId);
                              if (!account) return null;
                              return (
                                <Text key={source.accountId} size="xs">
                                  {accountDisplayName(account, t)}: {formatCurrency(source.amount, locale, selectedCurrency, currencySymbol)}
                                </Text>
                              );
                            })}
                          </Stack>
                        )}
                        {need.targetAccountIds.length === 0 ? (
                          <Text size="xs" c="yellow">{t("incomeTransferNoTarget")}</Text>
                        ) : (
                          <Select
                            label={t("incomeTransferDestination")}
                            required
                            data={need.targetAccountIds.map((accountId) => accounts.find((account) => account.id === accountId)).filter((account): account is (typeof accounts)[number] => !!account).map((account) => toAccountOption(account, t))}
                            renderOption={renderAccountOption}
                            value={incomeTransferTargets[need.category.id] == null ? null : String(incomeTransferTargets[need.category.id])}
                            disabled={hasCompletedIncomeTransfer}
                            onChange={(value) => setIncomeTransferTargets((previous) => ({ ...previous, [need.category.id]: value ? Number(value) : null }))}
                          />
                        )}
                      </Stack>
                    );
                  })}
                </Stack>
              )}
            </Stack>
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

      <Modal opened={budgetCalculatorOpen} onClose={() => setBudgetCalculatorOpen(false)}
        title={t("budgetCalculatorTitle")} size="lg" centered>
        {budgetCalculatorOpen && <BudgetDistributionCalculator
          key={selectedCurrency}
          accounts={accounts} categories={budgetCategories} filters={budgetFilters ?? []}
          lines={form.values.rows.filter(row => row.account_id != null || row.debit !== 0 || row.credit !== 0).map(row => ({
            account_id: row.account_id ?? -1, debit: row.debit ?? 0, credit: row.credit ?? 0, currency: selectedCurrency,
          }))}
          currency={selectedCurrency} decimalPlaces={currencyDecimalPlaces} currencySymbol={currencySymbol}
          incomeLocked={hasCompletedIncomeTransfer}
          onClose={() => setBudgetCalculatorOpen(false)}
          onApply={values => {
            if (values.income !== undefined && hasCompletedIncomeTransfer) return;
            if (values.expense !== undefined) setBudgetAllocs({ ...values.expense });
            if (values.income !== undefined) setIncomeBudgetAllocs({ ...values.income });
            setBudgetCalculatorOpen(false);
          }}
        />}
      </Modal>

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
