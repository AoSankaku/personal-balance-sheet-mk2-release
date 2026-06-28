import {
  Button,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useForm } from "@mantine/form";
import {
  IconBolt,
  IconBriefcase,
  IconBuilding,
  IconBuildingBank,
  IconCar,
  IconCreditCard,
  IconCurrencyBitcoin,
  IconDeviceGamepad2,
  IconDoor,
  IconDots,
  IconHandStop,
  IconHome,
  IconLock,
  IconReceipt,
  IconSalad,
  IconScale,
  IconShoppingCart,
  IconTrendingDown,
  IconTrendingUp,
  IconUsers,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMediaQuery } from "@mantine/hooks";
import dayjs from "dayjs";
import {
  type Account,
  type BudgetFilter,
  type CreateDepreciationInput,
  type CreateJournalInput,
  type UpdateDepreciationInput,
  type UnsettledLoanEntry,
  isAnyLendingCategory,
  isShortTermLoanCategory,
  isLongTermBorrowingCategory,
  isBusinessAdvanceCategory,
} from "@balance-sheet/shared";
import {
  type StepPreview,
  computeFilterSteps,
  computeFilterPreview,
  getIncomeDescriptionForSubmit,
} from "../lib/simpleEntryUtils";
import {
  buildTransferBudgetAdjustments,
  getTransferBudgetCategoryOptions,
} from "../lib/transferBudgetMovement";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import { showFeedback } from "../lib/feedback";
import { api, ApiError } from "../api/client";
import {
  categoryIndex,
  CATEGORY_TRANSLATION_KEY,
  systemAccountTranslationKey,
} from "../lib/accountUtils";
import { ExpenseSection } from "./entry/ExpenseSection";
import { IncomeSection } from "./entry/IncomeSection";
import { LoanSection } from "./entry/LoanSection";

type EntryType =
  | "expense"
  | "income"
  | "transfer"
  | "loan"
  | "business_advance";
/** increase=borrow, decrease=repay (liability); lend=lend, collect=collect (asset) */
type LoanDirection = "increase" | "decrease" | "lend" | "collect";

interface HouseholdForm {
  date: Date;
  description: string;
  entryType: EntryType;
  expenseCategoryId: number | null;
  expensePaidFromId: number | null;
  incomeTypeId: number | null;
  incomeDepositedToId: number | null;
  transferFromId: number | null;
  transferToId: number | null;
  transferBudgetSourceCategoryId: number | null;
  transferBudgetDestinationCategoryId: number | null;
  loanDirection: LoanDirection;
  /** Holds the liability account (borrow/repay) or lending asset account (lend/collect) */
  loanAccountId: number | null;
  loanCounterAccountId: number | null;
  /** Income or expense account for the settlement difference (optional) */
  loanDifferenceAccountId: number | null;
  amount: number;
  // business_advance fields
  businessAdvanceAccountId: number | null;
  businessRatio: number; // 0–100 (%) of the amount that is a business expense
  creditCardStatementOffsetMonths: number;
}

export type { HouseholdForm };

export interface SimpleEntryMeta {
  // kept for backward compatibility; no longer used for filter application
  budgetFilterId?: number;
  depreciationUpdate?: {
    scheduleId: number;
    input: UpdateDepreciationInput;
  };
}

export interface BudgetDistributionItem {
  budget_category_id: number;
  name: string;
  ratio: number;
  /** True if this category had ratio=0 when the expense account was selected */
  isDefault: boolean;
}

export interface SimpleFormDraft {
  formValues: Partial<HouseholdForm>;
  budgetDist: BudgetDistributionItem[];
  showZeroCategories: boolean;
  incomeDist?: { budget_category_id: number; name: string; amount: number }[];
  isRegularIncome?: boolean;
  selectedFilterId?: string | null;
  filterStepPreview?: StepPreview[];
  settledEntryIds?: number[];
  diffBudgetDist?: BudgetDistributionItem[];
  loanCounterBudgetDist?: BudgetDistributionItem[];
  depreciation?: {
    enabled: boolean;
    scheduleId?: number;
    assetAccountId: number | null;
    expenseAccountId: number | null;
    inputMode: "months" | "monthly_amount";
    months: number | string;
    monthlyAmount: number | string;
  };
}

interface Props {
  accounts: Account[];
  budgetFilters?: BudgetFilter[];
  onSubmit: (
    values: CreateJournalInput,
    meta?: SimpleEntryMeta,
  ) => Promise<void>;
  onDepreciationSubmit?: (input: CreateDepreciationInput) => Promise<void>;
  onCancel?: () => void;
  onReset?: () => void;
  submitLabel?: string;
  initialDraft?: SimpleFormDraft;
  onDraftChange?: (draft: SimpleFormDraft) => void;
  isEditing?: boolean;
  editEntryId?: number;
}

export type { StepPreview };

export function getAccountIcon(
  category: string | undefined,
  isSystem?: boolean,
) {
  const size = 14;
  if (isSystem) return <IconLock size={size} />;
  switch (category) {
    case "cash":
      return <IconBuildingBank size={size} />;
    case "lending":
    case "short_term_lending":
    case "short_term_loan":
      return <IconHandStop size={size} />;
    case "long_term_lending":
    case "loan":
    case "long_term_loan":
      return <IconReceipt size={size} />;
    case "business_advance":
      return <IconBriefcase size={size} />;
    case "investment":
      return <IconTrendingUp size={size} />;
    case "crypto":
      return <IconCurrencyBitcoin size={size} />;
    case "property":
      return <IconHome size={size} />;
    case "credit_card":
      return <IconCreditCard size={size} />;
    case "opening_balance":
      return <IconScale size={size} />;
    case "salary":
      return <IconBriefcase size={size} />;
    case "business":
      return <IconBuilding size={size} />;
    case "food":
      return <IconSalad size={size} />;
    case "rent":
      return <IconDoor size={size} />;
    case "transport":
      return <IconCar size={size} />;
    case "utilities":
      return <IconBolt size={size} />;
    case "entertainment":
      return <IconDeviceGamepad2 size={size} />;
    case "daily_goods":
      return <IconShoppingCart size={size} />;
    case "social":
      return <IconUsers size={size} />;
    case "investment_loss":
      return <IconTrendingDown size={size} />;
    default:
      return <IconDots size={size} />;
  }
}

export type AccountOption = {
  value: string;
  label: string;
  category?: string;
  is_system?: boolean;
};

export function renderAccountOption({
  option,
}: {
  option: AccountOption;
  checked?: boolean;
}) {
  return (
    <Group gap={6} wrap="nowrap">
      <Text c="dimmed" style={{ flexShrink: 0, lineHeight: 1 }}>
        {getAccountIcon(option.category, option.is_system)}
      </Text>
      <Text size="sm" truncate>
        {option.label}
      </Text>
    </Group>
  );
}

export function SimpleEntryForm({
  accounts,
  budgetFilters = [],
  onSubmit,
  onDepreciationSubmit,
  onCancel,
  onReset,
  submitLabel,
  initialDraft,
  onDraftChange,
  isEditing = false,
  editEntryId,
}: Props) {
  const { t, locale } = useLang();
  const {
    budgetCategories,
    budgetSettings,
    displayCurrency,
    displayCurrencySymbol: currencySymbol,
  } = useAppData();
  const isMobile = useMediaQuery("(max-width: 48em)");
  const selectedCurrency = displayCurrency || "JPY";
  const [selectedFilterId, setSelectedFilterId] = useState<string | null>(
    initialDraft?.selectedFilterId ?? null,
  );
  const [isRegularIncome, setIsRegularIncome] = useState(
    initialDraft?.isRegularIncome ?? false,
  );
  // Editable income budget distribution: amounts that will be stored in budget_adjustment_logs
  const [incomeDist, setIncomeDist] = useState<
    { budget_category_id: number; name: string; amount: number }[]
  >(initialDraft?.incomeDist ?? []);
  // Frozen step-by-step pipeline snapshot — restore from draft to avoid re-capture on mount
  const [filterStepPreview, setFilterStepPreview] = useState<StepPreview[]>(
    initialDraft?.filterStepPreview ?? [],
  );
  // Skip recomputing incomeDist on mount when restoring a draft that already has a filter selected
  const skipFirstIncomeRecompute = useRef(
    initialDraft?.selectedFilterId != null &&
      (initialDraft?.incomeDist?.length ?? 0) > 0,
  );
  // Budget distribution for the currently selected expense account
  const [budgetDist, setBudgetDist] = useState<BudgetDistributionItem[]>(
    initialDraft?.budgetDist ?? [],
  );
  const [showZeroCategories, setShowZeroCategories] = useState(
    initialDraft?.showZeroCategories ?? false,
  );
  const [overBudgetWarnOpen, setOverBudgetWarnOpen] = useState(false);
  const [underBudgetWarnOpen, setUnderBudgetWarnOpen] = useState(false);
  const pendingValues = useRef<HouseholdForm | null>(null);

  // ── Loan settlement state ───────────────────────────────────────────────
  const [unsettledEntries, setUnsettledEntries] = useState<
    UnsettledLoanEntry[]
  >([]);
  const [settledEntryIds, setSettledEntryIds] = useState<number[]>(
    initialDraft?.settledEntryIds ?? [],
  );
  const [isLoadingUnsettled, setIsLoadingUnsettled] = useState(false);
  const [diffBudgetDist, setDiffBudgetDist] = useState<
    BudgetDistributionItem[]
  >(initialDraft?.diffBudgetDist ?? []);
  const [loanCounterBudgetDist, setLoanCounterBudgetDist] = useState<
    BudgetDistributionItem[]
  >(initialDraft?.loanCounterBudgetDist ?? []);

  // ── Depreciation state ──────────────────────────────────────────────────
  const [depreciationEnabled, setDepreciationEnabled] = useState(
    initialDraft?.depreciation?.enabled ?? false,
  );
  const [depreciationAssetAccountId, setDepreciationAssetAccountId] = useState<
    number | null
  >(initialDraft?.depreciation?.assetAccountId ?? null);
  const [depreciationExpenseAccountId, setDepreciationExpenseAccountId] =
    useState<number | null>(
      initialDraft?.depreciation?.expenseAccountId ?? null,
    );
  const [depreciationInputMode, setDepreciationInputMode] = useState<
    "months" | "monthly_amount"
  >(initialDraft?.depreciation?.inputMode ?? "months");
  const [depreciationMonths, setDepreciationMonths] = useState<number | string>(
    initialDraft?.depreciation?.months ?? 12,
  );
  const [depreciationMonthlyAmount, setDepreciationMonthlyAmount] = useState<
    number | string
  >(initialDraft?.depreciation?.monthlyAmount ?? "");
  const depreciationEnabledRef = useRef(false);
  depreciationEnabledRef.current = depreciationEnabled;

  // (business_advance has no extra local state — ratio fields are in the form)

  const preferredFilterIds = budgetSettings?.preferred_filter_ids ?? [];
  const preferredFilterIdSet = new Set(preferredFilterIds.map(String));

  const preferredFilterItems = preferredFilterIds
    .map((id) =>
      budgetFilters.find(
        (f) => f.id === id && f.is_active && f.currency === selectedCurrency,
      ),
    )
    .filter(Boolean)
    .map((f) => ({ value: String(f!.id), label: f!.name }));

  const remainingFilterItems = budgetFilters
    .filter(
      (f) =>
        f.is_active &&
        f.currency === selectedCurrency &&
        !preferredFilterIdSet.has(String(f.id)),
    )
    .map((f) => ({ value: String(f.id), label: f.name }));

  const activeFilterOptions =
    preferredFilterItems.length > 0
      ? [
          { group: "★", items: preferredFilterItems },
          ...(remainingFilterItems.length > 0
            ? [{ group: "", items: remainingFilterItems }]
            : []),
        ]
      : remainingFilterItems;

  useEffect(() => {
    if (!selectedFilterId) return;
    const selectedFilter = budgetFilters.find(
      (f) => f.id === Number(selectedFilterId),
    );
    if (!selectedFilter || selectedFilter.currency === selectedCurrency) return;
    setSelectedFilterId(null);
    setIncomeDist([]);
    setFilterStepPreview([]);
  }, [budgetFilters, selectedCurrency, selectedFilterId]);

  // Helper: resolve human-readable display name for an account (translates __system:*__ names)
  function resolveLabel(a: { name: string; is_system?: boolean }): string {
    if (a.is_system) {
      const key = systemAccountTranslationKey(a.name);
      if (key) return t(key);
    }
    return a.name;
  }

  // Convert an Account to an AccountOption (includes category/is_system for renderOption icons)
  function toOpt(a: Account): AccountOption {
    return {
      value: String(a.id),
      label: resolveLabel(a),
      category: a.category,
      is_system: a.is_system ?? false,
    };
  }

  // Reusable sort comparator by canonical category order
  function sortCmp(
    a: {
      type: Account["type"];
      category: Account["category"];
      is_system?: boolean;
      name: string;
    },
    b: {
      type: Account["type"];
      category: Account["category"];
      is_system?: boolean;
      name: string;
    },
  ) {
    const ai = categoryIndex(a.type, a.category, a.is_system ?? false);
    const bi = categoryIndex(b.type, b.category, b.is_system ?? false);
    return ai !== bi ? ai - bi : a.name.localeCompare(b.name, "ja");
  }

  const assetOptions = [...accounts.filter((a) => a.type === "asset")]
    .sort(sortCmp)
    .map(toOpt);
  // Transfer "from" also allows opening_balance equity accounts (for 元入金 editing)
  const transferFromOptions = [
    ...assetOptions,
    ...[
      ...accounts.filter(
        (a) => a.type === "equity" && a.category === "opening_balance",
      ),
    ]
      .sort(sortCmp)
      .map(toOpt),
  ];
  const depreciableAssetOptions = [
    ...accounts.filter((a) => a.type === "asset" && a.is_depreciable),
  ]
    .sort(sortCmp)
    .map(toOpt);
  // Expense accounts grouped by category (sorted per canonical order; system accounts last)
  const sortedExpenseAccounts = [
    ...accounts.filter((a) => a.type === "expense"),
  ].sort(sortCmp);
  // Flat list (for depreciation selects where grouping isn't needed)
  const expenseOnlyOptions = sortedExpenseAccounts.map(toOpt);
  // Grouped by category (for main expense selector)
  const expenseOptions = (() => {
    const groups = new Map<string, { group: string; items: AccountOption[] }>();
    for (const a of sortedExpenseAccounts) {
      const catKey = a.is_system
        ? "sysAccountBadge"
        : (CATEGORY_TRANSLATION_KEY[a.category] ?? "catOther");
      const groupLabel = a.is_system
        ? t("sysAccountBadge")
        : t(catKey as Parameters<typeof t>[0]);
      const groupId = a.is_system ? "__system__" : a.category;
      if (!groups.has(groupId)) {
        groups.set(groupId, { group: groupLabel, items: [] });
      }
      groups.get(groupId)!.items.push(toOpt(a));
    }
    return [...groups.values()];
  })();
  // Lending asset accounts (all categories) — exclude completed accounts from input
  const lendingOptions = accounts
    .filter(
      (a) =>
        a.type === "asset" &&
        isAnyLendingCategory(a.category) &&
        !a.is_completed,
    )
    .map(toOpt);
  const incomeOptions = [...accounts.filter((a) => a.type === "income")]
    .sort(sortCmp)
    .map(toOpt);
  // Liability accounts for loan tab — short-term first, long-term next, credit cards last
  const liabilityShortTermItems = [
    ...accounts.filter(
      (a) =>
        a.type === "liability" &&
        a.category !== "credit_card" &&
        !isLongTermBorrowingCategory(a.category) &&
        !a.is_completed,
    ),
  ]
    .sort(sortCmp)
    .map(toOpt);
  const liabilityLongTermItems = [
    ...accounts.filter(
      (a) =>
        a.type === "liability" &&
        isLongTermBorrowingCategory(a.category) &&
        !a.is_completed,
    ),
  ]
    .sort(sortCmp)
    .map(toOpt);
  const liabilityCcItems = [
    ...accounts.filter(
      (a) => a.type === "liability" && a.category === "credit_card",
    ),
  ]
    .sort(sortCmp)
    .map(toOpt);
  const liabilityOptions = [
    ...liabilityShortTermItems,
    ...(liabilityLongTermItems.length > 0
      ? [{ group: t("catLongTermLoan"), items: liabilityLongTermItems }]
      : []),
    ...(liabilityCcItems.length > 0
      ? [{ group: t("catCreditCard"), items: liabilityCcItems }]
      : []),
  ];

  // Income accounts (for difference gain) — same sort as incomeOptions
  const incomeOnlyOptions = [...accounts.filter((a) => a.type === "income")]
    .sort(sortCmp)
    .map(toOpt);
  // Income deposit: exclude lending/borrowing accounts (those belong in the loan tab)
  const incomeDepositAssetOptions = [
    ...accounts.filter(
      (a) =>
        a.type === "asset" &&
        !isAnyLendingCategory(a.category) &&
        !isBusinessAdvanceCategory(a.category),
    ),
  ]
    .sort(sortCmp)
    .map(toOpt);
  const incomeDepositLiabilityOptions = [
    ...accounts.filter(
      (a) =>
        a.type === "liability" &&
        !isShortTermLoanCategory(a.category) &&
        !isLongTermBorrowingCategory(a.category),
    ),
  ]
    .sort(sortCmp)
    .map(toOpt);
  const incomeDepositOptions = [
    ...(incomeDepositAssetOptions.length > 0
      ? [{ group: t("typeAsset"), items: incomeDepositAssetOptions }]
      : []),
    ...(incomeDepositLiabilityOptions.length > 0
      ? [{ group: t("typeLiability"), items: incomeDepositLiabilityOptions }]
      : []),
  ];
  const creditCardOptions = accounts
    .filter((a) => a.type === "liability" && a.category === "credit_card")
    .map(toOpt);

  // Preferred payment accounts from global settings (ordered list, can be asset or liability)
  const preferredIds = budgetSettings?.preferred_payment_account_ids ?? [];
  const preferredIdSet = new Set(preferredIds.map(String));

  // Helper: accounts not eligible as "paid from" in expense entry
  const isLoanRelatedAccount = (a: Account) =>
    isAnyLendingCategory(a.category) ||
    isShortTermLoanCategory(a.category) ||
    isLongTermBorrowingCategory(a.category) ||
    isBusinessAdvanceCategory(a.category) ||
    a.category === "crypto" ||
    !!a.is_system;

  // "Paid from": preferred accounts first (in order), then remaining by type
  // Exclude lending/borrowing accounts from all groups
  const preferredItems = preferredIds
    .map((id) => accounts.find((a) => a.id === id))
    .filter((a): a is Account => !!a && !isLoanRelatedAccount(a))
    .map(toOpt);

  const remainingCreditCards = creditCardOptions.filter(
    (o) => !preferredIdSet.has(o.value),
  );
  const remainingAssets = [
    ...accounts.filter(
      (a) =>
        a.type === "asset" &&
        !isLoanRelatedAccount(a) &&
        !preferredIdSet.has(String(a.id)),
    ),
  ]
    .sort(sortCmp)
    .map(toOpt);

  const paidFromOptions = [
    ...(preferredItems.length > 0
      ? [{ group: "★", items: preferredItems }]
      : []),
    ...(remainingCreditCards.length > 0
      ? [{ group: t("catCreditCard"), items: remainingCreditCards }]
      : []),
    ...(remainingAssets.length > 0
      ? [{ group: t("typeAsset"), items: remainingAssets }]
      : []),
  ];

  // Default pre-selection: first preferred account
  const defaultPaymentAccount =
    preferredIds.length > 0
      ? accounts.find((a) => a.id === preferredIds[0])
      : null;

  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  const autoIncomeDescriptionRef = useRef<string | null>(null);

  const form = useForm<HouseholdForm>({
    initialValues: {
      date: new Date(),
      description: "",
      entryType: "expense",
      expenseCategoryId: null,
      expensePaidFromId: defaultPaymentAccount?.id ?? null,
      incomeTypeId: null,
      incomeDepositedToId: null,
      transferFromId: null,
      transferToId: null,
      transferBudgetSourceCategoryId: null,
      transferBudgetDestinationCategoryId: null,
      loanDirection: "increase",
      loanAccountId: null,
      loanCounterAccountId: null,
      loanDifferenceAccountId: null,
      amount: 0,
      businessAdvanceAccountId:
        budgetSettings?.business_advance_account_id ?? null,
      businessRatio: 100,
      creditCardStatementOffsetMonths: 0,
      ...initialDraft?.formValues,
    },
    validate: {
      description: (v, vals) => {
        const incomeAccount =
          vals.entryType === "income"
            ? accounts.find((a) => a.id === vals.incomeTypeId)
            : undefined;
        const description = getIncomeDescriptionForSubmit(v, incomeAccount);
        return description.trim().length === 0
          ? t("descriptionIsRequired")
          : null;
      },
      expenseCategoryId: (v, vals) =>
        (vals.entryType === "expense" ||
          vals.entryType === "business_advance") &&
        !depreciationEnabledRef.current &&
        v == null
          ? t("selectAccount")
          : null,
      expensePaidFromId: (v, vals) =>
        (vals.entryType === "expense" ||
          vals.entryType === "business_advance") &&
        v == null
          ? t("selectAccount")
          : null,
      incomeTypeId: (v, vals) =>
        vals.entryType === "income" && v == null ? t("selectAccount") : null,
      incomeDepositedToId: (v, vals) =>
        vals.entryType === "income" && v == null ? t("selectAccount") : null,
      transferFromId: (v, vals) =>
        vals.entryType === "transfer" && v == null ? t("selectAccount") : null,
      transferToId: (v, vals) =>
        vals.entryType === "transfer" && v == null ? t("selectAccount") : null,
      loanAccountId: (v, vals) =>
        vals.entryType === "loan" && v == null ? t("selectAccount") : null,
      loanCounterAccountId: (v, vals) =>
        vals.entryType === "loan" && v == null ? t("selectAccount") : null,
      businessAdvanceAccountId: (v, vals) =>
        vals.entryType === "business_advance" && v == null
          ? t("selectAccount")
          : null,
      amount: (v) => (v <= 0 ? t("amountMustBePositive") : null),
    },
  });
  const selectedPaymentAccount = accounts.find(
    (account) => account.id === form.values.expensePaidFromId,
  );

  useEffect(() => {
    if (!initialDraft?.depreciation) return;
    setDepreciationEnabled(initialDraft.depreciation.enabled);
    setDepreciationAssetAccountId(initialDraft.depreciation.assetAccountId);
    setDepreciationExpenseAccountId(initialDraft.depreciation.expenseAccountId);
    setDepreciationInputMode(initialDraft.depreciation.inputMode);
    setDepreciationMonths(initialDraft.depreciation.months);
    setDepreciationMonthlyAmount(initialDraft.depreciation.monthlyAmount);
  }, [initialDraft]);

  useEffect(() => {
    onDraftChangeRef.current?.({
      formValues: form.values,
      budgetDist,
      showZeroCategories,
      incomeDist,
      isRegularIncome,
      selectedFilterId,
      filterStepPreview,
      settledEntryIds,
      diffBudgetDist,
      loanCounterBudgetDist,
      depreciation: {
        enabled: depreciationEnabled,
        scheduleId: initialDraft?.depreciation?.scheduleId,
        assetAccountId: depreciationAssetAccountId,
        expenseAccountId: depreciationExpenseAccountId,
        inputMode: depreciationInputMode,
        months: depreciationMonths,
        monthlyAmount: depreciationMonthlyAmount,
      },
    });
  }, [
    form.values,
    budgetDist,
    showZeroCategories,
    incomeDist,
    isRegularIncome,
    selectedFilterId,
    filterStepPreview,
    settledEntryIds,
    diffBudgetDist,
    depreciationEnabled,
    depreciationAssetAccountId,
    depreciationExpenseAccountId,
    depreciationInputMode,
    depreciationMonths,
    depreciationMonthlyAmount,
    initialDraft?.depreciation?.scheduleId,
    loanCounterBudgetDist,
  ]);

  // Load unsettled entries when direction is repay/collect and a short-term account is selected
  const loanAccountId = form.values.loanAccountId;
  const loanDirection = form.values.loanDirection;
  useEffect(() => {
    if (form.values.entryType !== "loan") return;
    if (loanDirection !== "decrease" && loanDirection !== "collect") {
      setUnsettledEntries([]);
      setSettledEntryIds([]);
      return;
    }
    if (loanAccountId == null) {
      setUnsettledEntries([]);
      return;
    }
    const acct = accounts.find((a) => a.id === loanAccountId);
    if (!acct || !isShortTermLoanCategory(acct.category)) {
      setUnsettledEntries([]);
      setSettledEntryIds([]);
      return;
    }
    setIsLoadingUnsettled(true);
    api.loans
      .unsettled(loanAccountId, editEntryId, selectedCurrency)
      .then(({ entries }) => {
        setUnsettledEntries(entries);
        // Pre-select entries already settled by the entry being edited
        const alreadySettled = entries
          .filter((e) => e.already_settled_by_current)
          .map((e) => e.journal_entry_id);
        if (alreadySettled.length > 0) {
          setSettledEntryIds(alreadySettled);
        }
      })
      .catch(() => setUnsettledEntries([]))
      .finally(() => setIsLoadingUnsettled(false));
  }, [
    loanAccountId,
    loanDirection,
    form.values.entryType,
    accounts,
    editEntryId,
    selectedCurrency,
  ]);

  async function doSubmit(values: HouseholdForm) {
    const transactionDate = dayjs(values.date).format("YYYY-MM-DD");
    const incomeAccount =
      values.entryType === "income"
        ? accounts.find((account) => account.id === values.incomeTypeId)
        : undefined;
    const submitDescription = getIncomeDescriptionForSubmit(
      values.description,
      incomeAccount,
    );
    const paymentAccount = accounts.find(
      (account) => account.id === values.expensePaidFromId,
    );
    const paymentOffset =
      paymentAccount?.category === "credit_card"
        ? {
            credit_card_billing_offset_months:
              values.creditCardStatementOffsetMonths,
          }
        : {};
    // ── Depreciation path ──────────────────────────────────────────────
    if (values.entryType === "expense" && depreciationEnabled) {
      if (
        !depreciationAssetAccountId ||
        !depreciationExpenseAccountId ||
        !values.expensePaidFromId
      )
        return;
      const totalAmount = values.amount;
      const months =
        depreciationInputMode === "months"
          ? Number(depreciationMonths) || 1
          : Math.max(
              1,
              Math.ceil(totalAmount / (Number(depreciationMonthlyAmount) || 1)),
            );
      const depreciationInput = {
        purchase_date: transactionDate,
        description: values.description,
        asset_account_id: depreciationAssetAccountId,
        payment_account_id: values.expensePaidFromId,
        expense_account_id: depreciationExpenseAccountId,
        total_amount: totalAmount,
        months,
      };
      if (isEditing && initialDraft?.depreciation?.scheduleId) {
        await onSubmit(
          {
            date: depreciationInput.purchase_date,
            description: depreciationInput.description,
            lines: [
              {
                account_id: depreciationInput.asset_account_id,
                debit: depreciationInput.total_amount,
                credit: 0,
              },
              {
                account_id: depreciationInput.payment_account_id,
                debit: 0,
                credit: depreciationInput.total_amount,
                ...paymentOffset,
              },
            ],
          },
          {
            depreciationUpdate: {
              scheduleId: initialDraft.depreciation.scheduleId,
              input: depreciationInput satisfies UpdateDepreciationInput,
            },
          },
        );
      } else {
        await onDepreciationSubmit?.(
          depreciationInput satisfies CreateDepreciationInput,
        );
      }
      if (!isEditing) {
        setDepreciationEnabled(false);
        setDepreciationAssetAccountId(null);
        setDepreciationExpenseAccountId(null);
        setDepreciationMonths(12);
        setDepreciationMonthlyAmount("");
        form.reset();
        if (defaultPaymentAccount) {
          form.setFieldValue("expensePaidFromId", defaultPaymentAccount.id);
        }
      }
      return;
    }

    // ── Business advance path ───────────────────────────────────────────
    if (values.entryType === "business_advance") {
      const totalAmount = values.amount;
      const businessAmount = Math.round(
        (totalAmount * (values.businessRatio ?? 100)) / 100,
      );
      const personalAmount = totalAmount - businessAmount;
      const advanceAccountId = values.businessAdvanceAccountId!;
      const paymentAccountId = values.expensePaidFromId!;
      const date = transactionDate;

      // ── Depreciation + business advance ──────────────────────────────
      if (depreciationEnabled && personalAmount > 0) {
        if (!depreciationAssetAccountId || !depreciationExpenseAccountId)
          return;
        const months =
          depreciationInputMode === "months"
            ? Number(depreciationMonths) || 1
            : Math.max(
                1,
                Math.ceil(
                  personalAmount / (Number(depreciationMonthlyAmount) || 1),
                ),
              );
        // Journal: DR businessAdvance (businessAmount) + DR assetAccount (personalAmount) / CR payment (total)
        await onSubmit({
          date,
          description: values.description,
          lines: [
            { account_id: advanceAccountId, debit: businessAmount, credit: 0 },
            {
              account_id: depreciationAssetAccountId,
              debit: personalAmount,
              credit: 0,
            },
            {
              account_id: paymentAccountId,
              debit: 0,
              credit: totalAmount,
              ...paymentOffset,
            },
          ],
          budget_source: "simple",
        });
        // Depreciation schedule for the personal portion only
        await onDepreciationSubmit?.({
          purchase_date: date,
          description: values.description,
          asset_account_id: depreciationAssetAccountId,
          payment_account_id: paymentAccountId,
          expense_account_id: depreciationExpenseAccountId,
          total_amount: personalAmount,
          months,
        } satisfies CreateDepreciationInput);
      } else if (businessAmount > 0 && personalAmount > 0) {
        // Split entry: DR advance + DR expense / CR payment
        const advanceBudgetCatId =
          budgetSettings?.business_advance_budget_category_id ?? null;
        const personalBudgetAllocs =
          budgetDist.length > 0 && personalAmount > 0
            ? budgetDist
                .filter((d) => d.ratio > 0)
                .map((d) => ({
                  budget_category_id: d.budget_category_id,
                  amount: -Math.round((personalAmount * d.ratio) / 100),
                }))
            : [];
        const budget_allocations = [
          ...(advanceBudgetCatId
            ? [
                {
                  budget_category_id: advanceBudgetCatId,
                  amount: -businessAmount,
                },
              ]
            : []),
          ...personalBudgetAllocs,
        ];
        await onSubmit({
          date,
          description: values.description,
          lines: [
            { account_id: advanceAccountId, debit: businessAmount, credit: 0 },
            {
              account_id: values.expenseCategoryId!,
              debit: personalAmount,
              credit: 0,
            },
            {
              account_id: paymentAccountId,
              debit: 0,
              credit: totalAmount,
              ...paymentOffset,
            },
          ],
          budget_allocations: budget_allocations.length
            ? budget_allocations
            : undefined,
          budget_source: "simple",
        });
      } else if (businessAmount >= totalAmount) {
        // 100% business — simple 2-line entry to advance account
        const advanceBudgetCatId =
          budgetSettings?.business_advance_budget_category_id ?? null;
        await onSubmit({
          date,
          description: values.description,
          lines: [
            { account_id: advanceAccountId, debit: totalAmount, credit: 0 },
            {
              account_id: paymentAccountId,
              debit: 0,
              credit: totalAmount,
              ...paymentOffset,
            },
          ],
          budget_allocations: advanceBudgetCatId
            ? [
                {
                  budget_category_id: advanceBudgetCatId,
                  amount: -totalAmount,
                },
              ]
            : undefined,
          budget_source: "simple",
        });
      } else {
        // personalAmount >= totalAmount (ratio = 0%) — treat as normal expense
        const budget_allocations =
          budgetDist.length > 0 && totalAmount > 0
            ? budgetDist
                .filter((d) => d.ratio > 0)
                .map((d) => ({
                  budget_category_id: d.budget_category_id,
                  amount: -Math.round((totalAmount * d.ratio) / 100),
                }))
            : undefined;
        await onSubmit({
          date,
          description: values.description,
          lines: [
            {
              account_id: values.expenseCategoryId!,
              debit: totalAmount,
              credit: 0,
            },
            {
              account_id: paymentAccountId,
              debit: 0,
              credit: totalAmount,
              ...paymentOffset,
            },
          ],
          budget_allocations,
          budget_source: "simple",
        });
      }
      if (!isEditing) {
        setDepreciationEnabled(false);
        setDepreciationAssetAccountId(null);
        setDepreciationExpenseAccountId(null);
        setDepreciationMonths(12);
        setDepreciationMonthlyAmount("");
        setBudgetDist([]);
        form.reset();
        if (defaultPaymentAccount) {
          form.setFieldValue("expensePaidFromId", defaultPaymentAccount.id);
        }
        form.setFieldValue(
          "businessAdvanceAccountId",
          budgetSettings?.business_advance_account_id ?? null,
        );
        form.setFieldValue("businessRatio", 100);
      }
      return;
    }

    // ── Loan path (4 directions) ───────────────────────────────────────────
    if (values.entryType === "loan") {
      const acct = accounts.find((a) => a.id === values.loanAccountId);
      const isShortTerm = acct ? isShortTermLoanCategory(acct.category) : false;
      const hasSettlements = settledEntryIds.length > 0;

      // Amounts
      const actualAmount = values.amount; // cash flow
      const selectedTotal = hasSettlements
        ? unsettledEntries
            .filter((e) => settledEntryIds.includes(e.journal_entry_id))
            .reduce((s, e) => s + e.amount, 0)
        : actualAmount; // no settlement = simple 2-line entry

      const loanAmount = hasSettlements ? selectedTotal : actualAmount;
      const diff = actualAmount - loanAmount; // positive = paid/received more, negative = less

      // Determine debit/credit IDs for the loan account line
      let loanDebit: number, loanCredit: number;
      if (values.loanDirection === "increase") {
        // Borrow: DR counter / CR liability
        loanDebit = values.loanCounterAccountId!;
        loanCredit = values.loanAccountId!;
      } else if (values.loanDirection === "decrease") {
        // Repay: DR liability / CR counter
        loanDebit = values.loanAccountId!;
        loanCredit = values.loanCounterAccountId!;
      } else if (values.loanDirection === "lend") {
        // Lend out: DR lending asset / CR counter (cash going out)
        loanDebit = values.loanAccountId!;
        loanCredit = values.loanCounterAccountId!;
      } else {
        // Collect: DR counter (cash coming in) / CR lending asset
        loanDebit = values.loanCounterAccountId!;
        loanCredit = values.loanAccountId!;
      }

      const lines: CreateJournalInput["lines"] = [];

      if (!hasSettlements || Math.abs(diff) < 0.01) {
        // Simple 2-line entry
        lines.push(
          { account_id: loanDebit, debit: loanAmount, credit: 0 },
          { account_id: loanCredit, debit: 0, credit: loanAmount },
        );
      } else if (values.loanDirection === "decrease") {
        // Repay: liability changes by settledTotal; cash changes by actualAmount
        if (diff > 0) {
          // Paid more → loss (expense)
          lines.push(
            { account_id: loanDebit, debit: loanAmount, credit: 0 }, // DR liability (settled)
            ...(values.loanDifferenceAccountId
              ? [
                  {
                    account_id: values.loanDifferenceAccountId,
                    debit: diff,
                    credit: 0,
                  },
                ]
              : []),
            { account_id: loanCredit, debit: 0, credit: actualAmount }, // CR cash
          );
        } else {
          // Paid less → gain (income)
          lines.push(
            { account_id: loanDebit, debit: loanAmount, credit: 0 }, // DR liability (settled)
            { account_id: loanCredit, debit: 0, credit: actualAmount }, // CR cash
            ...(values.loanDifferenceAccountId
              ? [
                  {
                    account_id: values.loanDifferenceAccountId,
                    debit: 0,
                    credit: Math.abs(diff),
                  },
                ]
              : []),
          );
        }
      } else {
        // Collect: lending asset changes by settledTotal; cash changes by actualAmount
        if (diff > 0) {
          // Received more → gain (income)
          lines.push(
            { account_id: loanDebit, debit: actualAmount, credit: 0 }, // DR cash
            { account_id: loanCredit, debit: 0, credit: loanAmount }, // CR lending (settled)
            ...(values.loanDifferenceAccountId
              ? [
                  {
                    account_id: values.loanDifferenceAccountId,
                    debit: 0,
                    credit: diff,
                  },
                ]
              : []),
          );
        } else {
          // Received less → loss (expense)
          lines.push(
            { account_id: loanDebit, debit: actualAmount, credit: 0 }, // DR cash
            ...(values.loanDifferenceAccountId
              ? [
                  {
                    account_id: values.loanDifferenceAccountId,
                    debit: Math.abs(diff),
                    credit: 0,
                  },
                ]
              : []),
            { account_id: loanCredit, debit: 0, credit: loanAmount }, // CR lending (settled)
          );
        }
      }

      // Build budget allocations for difference account (expense) if applicable
      const diffIsExpense =
        values.loanDifferenceAccountId != null &&
        accounts.find((a) => a.id === values.loanDifferenceAccountId)?.type ===
          "expense";
      const diffBudgetAllocs =
        diffIsExpense && diffBudgetDist.length > 0 && Math.abs(diff) > 0
          ? diffBudgetDist
              .filter((d) => d.ratio > 0)
              .map((d) => ({
                budget_category_id: d.budget_category_id,
                amount: -Math.round((Math.abs(diff) * d.ratio) / 100),
              }))
          : undefined;

      // Build budget allocations for counter account (expense) when direction is increase/collect
      const counterIsExpense =
        (values.loanDirection === "increase" ||
          values.loanDirection === "collect") &&
        values.loanCounterAccountId != null &&
        accounts.find((a) => a.id === values.loanCounterAccountId)?.type ===
          "expense";
      const loanCounterBudgetAllocs =
        counterIsExpense && loanCounterBudgetDist.length > 0 && loanAmount > 0
          ? loanCounterBudgetDist
              .filter((d) => d.ratio > 0)
              .map((d) => ({
                budget_category_id: d.budget_category_id,
                amount: -Math.round((loanAmount * d.ratio) / 100),
              }))
          : undefined;

      const combinedBudgetAllocs = [
        ...(loanCounterBudgetAllocs ?? []),
        ...(diffBudgetAllocs ?? []),
      ];

      // Determine if this is an opening event
      const isOpening =
        values.loanDirection === "increase" || values.loanDirection === "lend";

      await onSubmit({
        date: transactionDate,
        description: values.description,
        lines,
        budget_allocations:
          combinedBudgetAllocs.length > 0 ? combinedBudgetAllocs : undefined,
        budget_source: "simple",
        loan_settlement_opening: isOpening && isShortTerm ? true : undefined,
        loan_settlement_journal_entry_ids:
          hasSettlements && isShortTerm ? settledEntryIds : undefined,
      });

      if (!isEditing) {
        setUnsettledEntries([]);
        setSettledEntryIds([]);
        setDiffBudgetDist([]);
        setLoanCounterBudgetDist([]);
        form.reset();
        if (defaultPaymentAccount) {
          form.setFieldValue("expensePaidFromId", defaultPaymentAccount.id);
        }
      }
      return;
    }

    let debitId: number, creditId: number;
    if (values.entryType === "expense") {
      debitId = values.expenseCategoryId!;
      creditId = values.expensePaidFromId!;
    } else if (values.entryType === "income") {
      debitId = values.incomeDepositedToId!;
      creditId = values.incomeTypeId!;
    } else {
      // transfer
      debitId = values.transferToId!;
      creditId = values.transferFromId!;
    }

    // Build per-entry budget allocations from distribution (expense mode only)
    const budget_allocations =
      values.entryType === "expense" &&
      budgetDist.length > 0 &&
      values.amount > 0
        ? budgetDist
            .filter((d) => d.ratio > 0)
            .map((d) => ({
              budget_category_id: d.budget_category_id,
              amount: -Math.round((values.amount * d.ratio) / 100),
            }))
        : undefined;

    const income_budget_allocations =
      values.entryType === "income" && incomeDist.length > 0
        ? incomeDist
            .filter((d) => d.amount > 0)
            .map((d) => ({
              budget_category_id: d.budget_category_id,
              amount: d.amount,
            }))
        : values.entryType === "transfer"
          ? buildTransferBudgetAdjustments({
              amount: values.amount,
              sourceBudgetCategoryId: values.transferBudgetSourceCategoryId,
              destinationBudgetCategoryId:
                values.transferBudgetDestinationCategoryId,
            })
          : undefined;

    await onSubmit({
      date: transactionDate,
      description: submitDescription,
      lines: [
        { account_id: debitId, debit: values.amount, credit: 0 },
        {
          account_id: creditId,
          debit: 0,
          credit: values.amount,
          ...(values.entryType === "expense" &&
          accounts.find((account) => account.id === creditId)?.category ===
            "credit_card"
            ? {
                credit_card_billing_offset_months:
                  values.creditCardStatementOffsetMonths,
              }
            : {}),
        },
      ],
      budget_allocations,
      budget_source: "simple",
      income_budget_allocations,
    });
    if (!isEditing) {
      setSelectedFilterId(null);
      setIncomeDist([]);
      setFilterStepPreview([]);
      setIsRegularIncome(false);
      setBudgetDist([]);
      form.reset();
      // Re-apply default payment source after reset
      if (defaultPaymentAccount) {
        form.setFieldValue("expensePaidFromId", defaultPaymentAccount.id);
      }
    }
  }

  async function handleSubmit(values: HouseholdForm) {
    if (values.entryType === "expense" && totalBudgetRatio > 100) {
      setOverBudgetWarnOpen(true);
      return;
    }
    if (
      values.entryType === "expense" &&
      totalBudgetRatio > 0 &&
      totalBudgetRatio < 100
    ) {
      pendingValues.current = values;
      setUnderBudgetWarnOpen(true);
      return;
    }
    if (
      values.entryType === "income" &&
      incomeDist.length > 0 &&
      totalIncomePct > 100
    ) {
      setOverBudgetWarnOpen(true);
      return;
    }
    if (
      values.entryType === "income" &&
      incomeDist.length > 0 &&
      totalIncomePct > 0 &&
      totalIncomePct < 100
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
      form.setFieldError("amount", msg);
    }
  }

  function handleExpenseAccountChange(v: string | null) {
    const accountId = v ? Number(v) : null;
    form.setFieldValue("expenseCategoryId", accountId);
    setShowZeroCategories(false);

    if (accountId) {
      const account = accounts.find((a) => a.id === accountId);
      const ratios = account?.budget_ratios ?? [];
      const configuredIds = new Set(ratios.map((r) => r.budget_category_id));

      // Configured ratios (non-zero = primary, zero = default)
      const configuredItems: BudgetDistributionItem[] = ratios.map((r) => ({
        budget_category_id: r.budget_category_id,
        name:
          r.budget_category_name ??
          `${t("unknownCategoryPrefix")}${r.budget_category_id}`,
        ratio: r.ratio,
        isDefault: r.ratio === 0,
      }));

      // Unconfigured budget categories (all with ratio=0, shown in collapsible)
      const unconfiguredItems: BudgetDistributionItem[] = budgetCategories
        .filter((c) => !configuredIds.has(c.id))
        .map((c) => ({
          budget_category_id: c.id,
          name: c.name,
          ratio: 0,
          isDefault: true,
        }));

      setBudgetDist([...configuredItems, ...unconfiguredItems]);
    } else {
      setBudgetDist([]);
    }
  }

  function handleIncomeTypeChange(v: string | null) {
    const accountId = v ? Number(v) : null;
    const account = accounts.find((a) => a.id === accountId);
    form.setFieldValue("incomeTypeId", accountId);

    const generated = getIncomeDescriptionForSubmit("", account);
    const currentDescription = form.values.description;
    const previousGenerated = autoIncomeDescriptionRef.current;
    const canReplace =
      currentDescription.trim().length === 0 ||
      (previousGenerated != null && currentDescription === previousGenerated);

    if (generated && canReplace) {
      form.setFieldValue("description", generated);
      autoIncomeDescriptionRef.current = generated;
      return;
    }

    if (
      !generated &&
      previousGenerated &&
      currentDescription === previousGenerated
    ) {
      form.setFieldValue("description", "");
    }
    autoIncomeDescriptionRef.current = null;
  }

  function handleLoanCounterAccountChange(v: string | null) {
    const accountId = v ? Number(v) : null;
    form.setFieldValue("loanCounterAccountId", accountId);
    setLoanCounterBudgetDist([]);
    if (accountId) {
      const acct = accounts.find((a) => a.id === accountId);
      if (acct?.type === "expense") {
        const ratios = acct.budget_ratios ?? [];
        const configuredIds = new Set(ratios.map((r) => r.budget_category_id));
        setLoanCounterBudgetDist([
          ...ratios.map((r) => ({
            budget_category_id: r.budget_category_id,
            name:
              r.budget_category_name ??
              `${t("unknownCategoryPrefix")}${r.budget_category_id}`,
            ratio: r.ratio,
            isDefault: r.ratio === 0,
          })),
          ...budgetCategories
            .filter((c) => !configuredIds.has(c.id))
            .map((c) => ({
              budget_category_id: c.id,
              name: c.name,
              ratio: 0,
              isDefault: true,
            })),
        ]);
      }
    }
  }

  function handleRatioChange(catId: number, newRatio: number) {
    setBudgetDist((prev) =>
      prev.map((d) =>
        d.budget_category_id === catId ? { ...d, ratio: newRatio } : d,
      ),
    );
  }

  function handleIncomeDistChange(catId: number, newAmt: number) {
    setIncomeDist((prev) => {
      const existing = prev.find((d) => d.budget_category_id === catId);
      if (existing) {
        return prev.map((d) =>
          d.budget_category_id === catId ? { ...d, amount: newAmt } : d,
        );
      }
      const cat = budgetCategories.find((c) => c.id === catId);
      return [
        ...prev,
        {
          budget_category_id: catId,
          name: cat?.name ?? `#${catId}`,
          amount: newAmt,
        },
      ];
    });
  }

  const entryType = form.values.entryType;
  const transferBudgetOptions = useMemo(
    () =>
      getTransferBudgetCategoryOptions({
        budgetCategories,
        fromAccountId: form.values.transferFromId,
        toAccountId: form.values.transferToId,
      }),
    [budgetCategories, form.values.transferFromId, form.values.transferToId],
  );
  const selectedIncomeAccount = accounts.find(
    (account) => account.id === form.values.incomeTypeId,
  );
  const canAutoGenerateDescription =
    entryType === "income" && selectedIncomeAccount?.category === "salary";
  const totalBudgetRatio = budgetDist.reduce((s, d) => s + d.ratio, 0);
  const totalIncomeDist = incomeDist.reduce((s, d) => s + d.amount, 0);
  const businessRatio = Math.min(
    100,
    Math.max(0, form.values.businessRatio ?? 0),
  );
  const businessAmount =
    form.values.amount > 0
      ? Math.round((form.values.amount * businessRatio) / 100)
      : 0;
  const personalAmount = Math.max(0, form.values.amount - businessAmount);
  const personalRatio = Math.max(0, 100 - businessRatio);
  // In manual mode (no filter), show all budget categories (filling 0 for unset)
  const showManualIncomeDist = !isRegularIncome || !selectedFilterId;
  const displayIncomeDist = showManualIncomeDist
    ? budgetCategories.map((cat) => {
        const existing = incomeDist.find(
          (d) => d.budget_category_id === cat.id,
        );
        return (
          existing ?? { budget_category_id: cat.id, name: cat.name, amount: 0 }
        );
      })
    : incomeDist;
  const totalIncomePct =
    form.values.amount > 0
      ? Math.round((totalIncomeDist / form.values.amount) * 100)
      : 0;

  useEffect(() => {
    if (entryType !== "transfer") return;

    const sourceIds = new Set(
      transferBudgetOptions.sourceOptions.map((option) => option.value),
    );
    const destinationIds = new Set(
      transferBudgetOptions.destinationOptions.map((option) => option.value),
    );

    const sourceValue = form.values.transferBudgetSourceCategoryId;
    if (sourceValue != null && !sourceIds.has(String(sourceValue))) {
      form.setFieldValue("transferBudgetSourceCategoryId", null);
    }

    const destinationValue = form.values.transferBudgetDestinationCategoryId;
    if (
      destinationValue != null &&
      !destinationIds.has(String(destinationValue))
    ) {
      form.setFieldValue("transferBudgetDestinationCategoryId", null);
    }
  }, [
    entryType,
    form.values.transferBudgetDestinationCategoryId,
    form.values.transferBudgetSourceCategoryId,
    transferBudgetOptions.destinationOptions,
    transferBudgetOptions.sourceOptions,
  ]);

  // When filter or amount changes, recompute income distribution
  useEffect(() => {
    if (entryType !== "income" || !selectedFilterId) return;
    // Skip the first run when restoring from a draft (incomeDist already set)
    if (skipFirstIncomeRecompute.current) {
      skipFirstIncomeRecompute.current = false;
      return;
    }
    if (form.values.amount <= 0) {
      setIncomeDist([]);
      return;
    }
    const filter = budgetFilters.find((f) => f.id === Number(selectedFilterId));
    if (!filter) return;
    const catAmounts = computeFilterPreview(filter.steps, form.values.amount);
    const rows = Object.entries(catAmounts)
      .filter(([, amt]) => amt > 0)
      .map(([catId, amt]) => {
        const cat = budgetCategories.find((c) => c.id === Number(catId));
        return {
          budget_category_id: Number(catId),
          name: cat?.name ?? `${t("unknownCategoryPrefix")}${catId}`,
          amount: amt,
        };
      });
    setIncomeDist(rows);
  }, [
    selectedFilterId,
    entryType,
    budgetFilters,
    budgetCategories,
    form.values.amount,
    t,
  ]);

  // Capture step-by-step pipeline snapshot once when filter changes (frozen — not updated on amount edits)
  // Initialize to draft's filter so the snapshot effect skips re-capture on mount
  const prevFilterForDefaultRef = useRef<string | null>(
    initialDraft?.selectedFilterId ?? null,
  );
  useEffect(() => {
    if (!selectedFilterId || !isRegularIncome) {
      setFilterStepPreview([]);
      prevFilterForDefaultRef.current = null;
      return;
    }
    if (prevFilterForDefaultRef.current === selectedFilterId) return;
    prevFilterForDefaultRef.current = selectedFilterId;
    const filter = budgetFilters.find((f) => f.id === Number(selectedFilterId));
    if (!filter || form.values.amount <= 0) return;
    const getCatName = (id: number) =>
      budgetCategories.find((c) => c.id === id)?.name ??
      `${t("unknownCategoryPrefix")}${id}`;
    setFilterStepPreview(
      computeFilterSteps(filter.steps, form.values.amount, getCatName),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFilterId, isRegularIncome, budgetFilters, budgetCategories, t]);

  // Counter account options for loan: all directions allow asset + liability; borrow also allows expense
  const liabilityCounterGroup =
    liabilityShortTermItems.length > 0 ||
    liabilityLongTermItems.length > 0 ||
    liabilityCcItems.length > 0
      ? [
          {
            group: t("typeLiability"),
            items: [
              ...liabilityShortTermItems,
              ...liabilityLongTermItems,
              ...liabilityCcItems,
            ],
          },
        ]
      : [];
  const loanCounterOptions =
    form.values.loanDirection === "increase"
      ? [
          { group: t("typeAsset"), items: assetOptions },
          { group: t("typeExpense"), items: expenseOnlyOptions },
          ...liabilityCounterGroup,
        ]
      : form.values.loanDirection === "decrease"
        ? [
            { group: t("typeAsset"), items: assetOptions },
            ...liabilityCounterGroup,
            { group: t("typeIncome"), items: incomeOnlyOptions },
          ]
        : form.values.loanDirection === "collect"
          ? [
              { group: t("typeAsset"), items: assetOptions },
              { group: t("typeExpense"), items: expenseOnlyOptions },
            ]
          : [
              // lend
              { group: t("typeAsset"), items: assetOptions },
              ...liabilityCounterGroup,
            ];

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <Stack>
        <SegmentedControl
          data={[
            { value: "expense", label: t("transactionTypeExpense") },
            { value: "income", label: t("transactionTypeIncome") },
            { value: "transfer", label: t("transactionTypeTransfer") },
            { value: "loan", label: t("transactionTypeLoan") },
          ]}
          value={entryType === "business_advance" ? "expense" : entryType}
          onChange={(v) => {
            // When switching away from expense, also clear business_advance mode
            if (v !== "expense" && entryType === "business_advance") {
              form.setFieldValue("entryType", "expense");
            }
            form.setFieldValue("entryType", v as EntryType);
          }}
          fullWidth
        />

        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <DateInput
            label={t("dateLabel")}
            required
            valueFormat="YYYY-MM-DD"
            {...form.getInputProps("date")}
          />
          <TextInput
            label={t("descriptionLabel")}
            placeholder={t("descSimplePlaceholder")}
            required={!canAutoGenerateDescription}
            {...form.getInputProps("description")}
          />
        </SimpleGrid>

        {(entryType === "expense" || entryType === "business_advance") && (
          <ExpenseSection
            form={form}
            isMobile={!!isMobile}
            expenseOptions={expenseOptions}
            expenseOnlyOptions={expenseOnlyOptions}
            paidFromOptions={paidFromOptions}
            assetOptions={assetOptions}
            depreciableAssetOptions={depreciableAssetOptions}
            selectedPaymentAccount={selectedPaymentAccount}
            budgetSettings={budgetSettings}
            budgetDist={budgetDist}
            showZeroCategories={showZeroCategories}
            setShowZeroCategories={setShowZeroCategories}
            totalBudgetRatio={totalBudgetRatio}
            businessRatio={businessRatio}
            businessAmount={businessAmount}
            personalAmount={personalAmount}
            personalRatio={personalRatio}
            depreciationEnabled={depreciationEnabled}
            setDepreciationEnabled={setDepreciationEnabled}
            depreciationAssetAccountId={depreciationAssetAccountId}
            setDepreciationAssetAccountId={setDepreciationAssetAccountId}
            depreciationExpenseAccountId={depreciationExpenseAccountId}
            setDepreciationExpenseAccountId={setDepreciationExpenseAccountId}
            depreciationInputMode={depreciationInputMode}
            setDepreciationInputMode={setDepreciationInputMode}
            depreciationMonths={depreciationMonths}
            setDepreciationMonths={setDepreciationMonths}
            depreciationMonthlyAmount={depreciationMonthlyAmount}
            setDepreciationMonthlyAmount={setDepreciationMonthlyAmount}
            onDepreciationSubmit={onDepreciationSubmit}
            handleExpenseAccountChange={handleExpenseAccountChange}
            handleRatioChange={handleRatioChange}
          />
        )}

        {entryType === "income" && (
          <IncomeSection
            form={form}
            isMobile={!!isMobile}
            incomeOptions={incomeOptions}
            incomeDepositOptions={incomeDepositOptions}
            activeFilterOptions={activeFilterOptions}
            budgetCategories={budgetCategories}
            isRegularIncome={isRegularIncome}
            setIsRegularIncome={setIsRegularIncome}
            selectedFilterId={selectedFilterId}
            setSelectedFilterId={setSelectedFilterId}
            setIncomeDist={setIncomeDist}
            displayIncomeDist={displayIncomeDist}
            filterStepPreview={filterStepPreview}
            totalIncomePct={totalIncomePct}
            totalIncomeDist={totalIncomeDist}
            showManualIncomeDist={showManualIncomeDist}
            handleIncomeDistChange={handleIncomeDistChange}
            handleIncomeTypeChange={handleIncomeTypeChange}
          />
        )}

        {entryType === "transfer" && (
          <>
            <Select
              label={t("fromAccountLabel")}
              placeholder={t("selectAccount")}
              data={transferFromOptions}
              searchable={!isMobile}
              required
              value={
                form.values.transferFromId != null
                  ? String(form.values.transferFromId)
                  : null
              }
              onChange={(v) =>
                form.setValues({
                  transferFromId: v ? Number(v) : null,
                  transferBudgetSourceCategoryId: null,
                })
              }
              error={form.errors.transferFromId}
              renderOption={renderAccountOption as any}
            />
            <Select
              label={t("toAccountLabel")}
              placeholder={t("selectAccount")}
              data={assetOptions}
              searchable={!isMobile}
              required
              value={
                form.values.transferToId != null
                  ? String(form.values.transferToId)
                  : null
              }
              onChange={(v) =>
                form.setValues({
                  transferToId: v ? Number(v) : null,
                  transferBudgetDestinationCategoryId: null,
                })
              }
              error={form.errors.transferToId}
              renderOption={renderAccountOption as any}
            />
            <Select
              label={t("transferBudgetSourceLabel")}
              placeholder={t("transferBudgetNoMovementPlaceholder")}
              data={transferBudgetOptions.sourceOptions}
              searchable={!isMobile}
              clearable
              value={
                form.values.transferBudgetSourceCategoryId != null
                  ? String(form.values.transferBudgetSourceCategoryId)
                  : null
              }
              onChange={(v) =>
                form.setFieldValue(
                  "transferBudgetSourceCategoryId",
                  v ? Number(v) : null,
                )
              }
            />
            <Select
              label={t("transferBudgetDestinationLabel")}
              placeholder={t("transferBudgetDisappearPlaceholder")}
              data={transferBudgetOptions.destinationOptions}
              searchable={!isMobile}
              clearable
              disabled={form.values.transferBudgetSourceCategoryId == null}
              value={
                form.values.transferBudgetDestinationCategoryId != null
                  ? String(form.values.transferBudgetDestinationCategoryId)
                  : null
              }
              onChange={(v) =>
                form.setFieldValue(
                  "transferBudgetDestinationCategoryId",
                  v ? Number(v) : null,
                )
              }
            />
          </>
        )}

        {entryType === "loan" && (
          <LoanSection
            form={form}
            isMobile={!!isMobile}
            loanCounterOptions={loanCounterOptions}
            liabilityOptions={liabilityOptions}
            lendingOptions={lendingOptions}
            expenseOnlyOptions={expenseOnlyOptions}
            incomeOnlyOptions={incomeOnlyOptions}
            accounts={accounts}
            budgetCategories={budgetCategories}
            locale={locale}
            selectedCurrency={selectedCurrency}
            currencySymbol={currencySymbol}
            unsettledEntries={unsettledEntries}
            setUnsettledEntries={setUnsettledEntries}
            settledEntryIds={settledEntryIds}
            setSettledEntryIds={setSettledEntryIds}
            isLoadingUnsettled={isLoadingUnsettled}
            diffBudgetDist={diffBudgetDist}
            setDiffBudgetDist={setDiffBudgetDist}
            loanCounterBudgetDist={loanCounterBudgetDist}
            setLoanCounterBudgetDist={setLoanCounterBudgetDist}
            handleLoanCounterAccountChange={handleLoanCounterAccountChange}
          />
        )}

        {entryType === "transfer" && (
          <NumberInput
            label={t("amountLabel")}
            placeholder="0"
            required
            min={0}
            prefix={currencySymbol}
            thousandSeparator=","
            {...form.getInputProps("amount")}
          />
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
            <Button type="submit">{submitLabel ?? t("add")}</Button>
          </Group>
        </Group>
      </Stack>

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
    </form>
  );
}
