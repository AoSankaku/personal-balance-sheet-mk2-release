import {
  Alert,
  Box,
  Button,
  Group,
  ScrollArea,
  Skeleton,
  Stack,
  Tabs,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconCoin,
  IconCurrencyDollar,
  IconFileSpreadsheet,
  IconLayoutGrid,
  IconPencil,
  IconShoppingCart,
  IconWifiOff,
} from "@tabler/icons-react";
import {
  useSearchParams,
  useLocation,
  useNavigate,
  Link,
} from "react-router-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CreateJournalInput } from "@balance-sheet/shared";
import { api, ApiError } from "../api/client";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import {
  SimpleEntryForm,
  type HouseholdForm,
  type SimpleEntryMeta,
  type SimpleFormDraft,
} from "../components/SimpleEntryForm";
import { ConfirmModal } from "../components/ConfirmModal";
import { MultiLineEntryForm } from "../components/MultiLineEntryForm";
import { BudgetAdjustForm } from "../components/BudgetAdjustForm";
import { CsvImportTab } from "../components/CsvImportTab";
import { BusinessAdvanceProcessTab } from "../components/BusinessAdvanceProcessTab";
import { BulkExpenseTab } from "../components/BulkExpenseTab";
import { ForeignExchangeForm } from "../components/ForeignExchangeForm";
import { AppDataErrorAlert } from "../components/AppDataErrorAlert";
import { showFeedback } from "../lib/feedback";
import { refreshAfterBudgetAdjustment } from "../lib/budgetAdjustmentRefresh";
import { usePrivacy } from "../context/PrivacyContext";
import { PrivacyModeBlocked } from "../components/PrivacyModeBlocked";
import type { PlannedExpenseEntrySource } from "../types/plannedExpenseInput";
import {
  plannedExpenseCompletionFeedbackKey,
  type PlannedExpenseCompletionResult,
} from "../lib/plannedExpenseForm";
import { plannedExpenseJournalCurrency } from "../lib/plannedExpenseCurrency";
import {
  savedTab,
  setSavedTab,
  simpleDraft,
  setSimpleDraft,
  setMultiDraft,
  setBudgetDraft,
} from "../utils/inputDrafts";
import {
  addOfflineDraft,
  getOfflineDrafts,
  removeOfflineDraft,
} from "../lib/offlineDrafts";
import { useOnlineStatus } from "../hooks/useOnlineStatus";

// ─── InputPage ────────────────────────────────────────────────────────────────

export default function InputPage() {
  const { t } = useLang();
  const { privacyMode } = usePrivacy();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const locationState = location.state as {
    loanDraft?: Partial<HouseholdForm>;
    plannedExpenseEntry?: PlannedExpenseEntrySource;
    settledEntryIds?: number[];
    tab?: string;
    offlineDraftId?: string;
  } | null;
  const locationLoanDraft = locationState?.loanDraft;
  const locationPlannedExpenseEntry = locationState?.plannedExpenseEntry;
  const locationSettledEntryIds = locationState?.settledEntryIds;
  const fromTt = searchParams.get("from") === "tt";
  const isOnline = useOnlineStatus();
  const locationOfflineDraft = locationState?.offlineDraftId
    ? getOfflineDrafts().find(
        (item) => item.id === locationState.offlineDraftId,
      ) ?? null
    : null;
  const typeParam = searchParams.get("type"); // e.g. "loan" from /fs/db
  const {
    accounts,
    budgetFilters,
    budgetSettings,
    enabledCurrencies,
    displayCurrency,
    setDisplayCurrency,
    loading,
    error,
    refresh,
    refreshBudget,
    refreshAllocatable,
  } = useAppData();

  useEffect(() => {
    const sourceCurrency =
      locationPlannedExpenseEntry?.inputCurrency ??
      locationPlannedExpenseEntry?.currency;
    if (sourceCurrency && sourceCurrency !== displayCurrency) {
      setDisplayCurrency(sourceCurrency);
    }
  }, [
    displayCurrency,
    locationPlannedExpenseEntry?.currency,
    locationPlannedExpenseEntry?.inputCurrency,
    setDisplayCurrency,
  ]);

  const hasFx = enabledCurrencies.length >= 2;
  const [activeTab, setActiveTab] = useState(
    locationLoanDraft != null || locationPlannedExpenseEntry != null
      ? "simple"
      : (locationState?.tab ?? savedTab),
  );
  useEffect(() => {
    if (!isOnline) setActiveTab("simple");
  }, [isOnline]);
  const [pendingPlannedExpenseCompletion, setPendingPlannedExpenseCompletion] =
    useState<{
      source: PlannedExpenseEntrySource;
      input: CreateJournalInput;
    } | null>(null);
  const [resetKeys, setResetKeys] = useState({
    simple: 0,
    multi: 0,
    budget: 0,
  });
  const [
    resetConfirmOpened,
    { open: openResetConfirm, close: closeResetConfirm },
  ] = useDisclosure(false);
  const pendingResetTab = useRef<keyof typeof resetKeys | null>(null);
  const currentSimpleDraftRef = useRef<SimpleFormDraft | null>(
    locationOfflineDraft?.draft ?? null,
  );

  function handleTabChange(tab: string | null) {
    const next = tab ?? "simple";
    setActiveTab(next);
    setSavedTab(next);
  }

  function resetForm(tab: keyof typeof resetKeys) {
    pendingResetTab.current = tab;
    openResetConfirm();
  }

  function confirmReset() {
    const tab = pendingResetTab.current;
    if (!tab) return;
    if (tab === "simple") setSimpleDraft(null);
    if (tab === "multi") setMultiDraft(null);
    if (tab === "budget") setBudgetDraft(null);
    setResetKeys((k) => ({ ...k, [tab]: k[tab] + 1 }));
  }

  const handleSimpleDraftChange = useCallback((draft: SimpleFormDraft) => {
    currentSimpleDraftRef.current = draft;
    setSimpleDraft(draft);
  }, []);

  function saveCurrentOfflineDraft() {
    const draft = currentSimpleDraftRef.current;
    if (!draft) return false;
    if (locationState?.offlineDraftId) {
      removeOfflineDraft(locationState.offlineDraftId);
    }
    addOfflineDraft(draft);
    setSimpleDraft(null);
    showFeedback({ message: t("offlineDraftSaved"), color: "yellow" });
    return true;
  }

  function clearOfflineDraftNavigationState() {
    if (!locationState?.offlineDraftId) return;
    const { offlineDraftId: _offlineDraftId, ...rest } = locationState;
    navigate(
      { pathname: location.pathname, search: location.search },
      { replace: true, state: Object.keys(rest).length > 0 ? rest : null },
    );
  }

  const plannedExpenseInitialDraft: SimpleFormDraft | null =
    locationPlannedExpenseEntry != null
      ? {
          formValues: {
            date:
              locationPlannedExpenseEntry.occurrenceDate != null
                ? dateFromInputString(locationPlannedExpenseEntry.occurrenceDate)
                : undefined,
            entryType: "expense",
            description: locationPlannedExpenseEntry.name,
            expenseCategoryId: locationPlannedExpenseEntry.expenseAccountId,
            amount:
              locationPlannedExpenseEntry.inputAmount ??
              locationPlannedExpenseEntry.amount,
          },
          budgetDist: [],
          showZeroCategories: false,
        }
      : null;

  function dateFromInputString(value: string): Date {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function clearPlannedExpenseNavigationState() {
    if (!locationState?.plannedExpenseEntry) return;
    const { plannedExpenseEntry: _plannedExpenseEntry, ...rest } =
      locationState;
    navigate(
      {
        pathname: location.pathname,
        search: location.search,
      },
      {
        replace: true,
        state: Object.keys(rest).length > 0 ? rest : null,
      },
    );
  }

  function getSubmittedExpenseSummary(values: CreateJournalInput) {
    const expenseLine = values.lines.find((line) => {
      if (line.debit <= 0) return false;
      const account = accounts.find((a) => a.id === line.account_id);
      return account?.type === "expense";
    });
    const amount = values.lines.reduce(
      (sum, line) => sum + Math.max(line.debit, 0),
      0,
    );
    return {
      description: values.description.trim(),
      expenseAccountId: expenseLine?.account_id ?? null,
      amount,
    };
  }

  async function completePlannedExpenseWithJournal(
    source: PlannedExpenseEntrySource,
    input: CreateJournalInput,
  ) {
    const result = await api.plannedExpenses.completeWithJournal(source.id, {
      journal: input,
      idempotency_key: source.idempotencyKey,
      occurrence_date: source.occurrenceDate ?? null,
      next_due_date_after_occurrence: source.nextDueDateAfterOccurrence ?? null,
      completed_dates: source.completedDates ?? null,
      completion_status_after_occurrence:
        source.completionStatusAfterOccurrence === "open" ||
        source.completionStatusAfterOccurrence === "completed"
          ? source.completionStatusAfterOccurrence
          : undefined,
      checkout_item_ids: source.checkoutItemIds,
      checkout_keep_item_ids: source.checkoutKeepItemIds,
    });
    clearPlannedExpenseNavigationState();
    return result.completion;
  }

  async function handleSubmit(
    values: CreateJournalInput,
    meta?: SimpleEntryMeta,
  ) {
    void meta;
    const journalCurrency = plannedExpenseJournalCurrency(
      activeTab === "simple"
        ? (locationPlannedExpenseEntry?.inputCurrency ??
          locationPlannedExpenseEntry?.currency)
        : undefined,
      displayCurrency,
    );
    const input = {
      ...values,
      lines: values.lines.map((l) => ({
        currency: journalCurrency,
        ...l,
      })),
    };
    if (activeTab === "simple" && !isOnline) {
      saveCurrentOfflineDraft();
      return;
    }
    const source =
      activeTab === "simple" ? locationPlannedExpenseEntry : undefined;
    if (source) {
      const submitted = getSubmittedExpenseSummary(input);
      const allChanged =
        submitted.description !== source.name.trim() &&
        submitted.expenseAccountId !== source.expenseAccountId &&
        Math.round(submitted.amount) !==
          Math.round(source.inputAmount ?? source.amount);
      if (allChanged) {
        setPendingPlannedExpenseCompletion({ source, input });
        return;
      }
    }

    let plannedExpenseCompletion: PlannedExpenseCompletionResult;
    try {
      plannedExpenseCompletion = source
        ? await completePlannedExpenseWithJournal(source, input)
        : (await api.journal.create(input), "none");
    } catch (err) {
      const wentOffline =
        err instanceof ApiError && err.body.error === "network_offline";
      if (activeTab === "simple" && wentOffline && saveCurrentOfflineDraft()) {
        return;
      }
      throw err;
    }
    if (locationState?.offlineDraftId) {
      removeOfflineDraft(locationState.offlineDraftId);
      clearOfflineDraftNavigationState();
    }
    if (activeTab === "simple") setSimpleDraft(null);
    if (activeTab === "multi") setMultiDraft(null);
    showFeedback({
      message: t(plannedExpenseCompletionFeedbackKey(plannedExpenseCompletion)),
      color: "teal",
    });
    refresh();
    void refreshBudget();
    void refreshAllocatable();
  }

  async function handleDepreciationSubmit(
    input: import("@balance-sheet/shared").CreateDepreciationInput,
  ) {
    await api.depreciation.create(input);
    showFeedback({ message: t("depreciationCreated"), color: "teal" });
    if (activeTab === "simple") setSimpleDraft(null);
    refresh();
    void refreshBudget();
    void refreshAllocatable();
  }

  if (privacyMode) {
    return <PrivacyModeBlocked />;
  }

  if (loading) {
    return (
      <Stack gap="md">
        <Skeleton height={28} width={180} radius="sm" />
        <Skeleton height={36} radius="sm" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} height={36} radius="sm" />
        ))}
      </Stack>
    );
  }

  if (error) {
    return <AppDataErrorAlert error={error} />;
  }

  return (
    <Stack gap={0}>
      {!isOnline && (
        <Alert
          color="yellow"
          variant="light"
          icon={<IconWifiOff size={18} />}
          mb="md"
        >
          {t("offlineInputNotice")}
        </Alert>
      )}
      {fromTt && (
        <Button
          component={Link}
          to="/fs/tt?segment=deviation"
          variant="subtle"
          size="xs"
          mb="xs"
          style={{ alignSelf: "flex-start" }}
        >
          ← {t("ttBackToDeviation")}
        </Button>
      )}
      <Group justify="space-between" align="center" mb="md">
        <Title order={4}>{t("inputPageTitle")}</Title>
      </Group>

      <Tabs value={activeTab} onChange={handleTabChange}>
        <ScrollArea type="never">
          <Tabs.List style={{ flexWrap: "nowrap" }}>
            <Tabs.Tab value="simple" leftSection={<IconPencil size={14} />}>
              {t("tabSimple")}
            </Tabs.Tab>
            <Tabs.Tab
              value="multi"
              disabled={!isOnline}
              leftSection={<IconLayoutGrid size={14} />}
            >
              {t("tabMultiLine")}
            </Tabs.Tab>
            <Tabs.Tab
              value="budget"
              disabled={!isOnline}
              leftSection={<IconCoin size={14} />}
            >
              {t("tabBudgetAdjust")}
            </Tabs.Tab>
            <Tabs.Tab
              value="csv"
              disabled={!isOnline}
              leftSection={<IconFileSpreadsheet size={14} />}
            >
              {t("tabCsvImport")}
            </Tabs.Tab>
            <Tabs.Tab
              value="bulk"
              disabled={!isOnline}
              leftSection={<IconShoppingCart size={14} />}
            >
              {t("tabBulkExpense")}
            </Tabs.Tab>
            {hasFx && (
              <Tabs.Tab
                value="fx"
                disabled={!isOnline}
                leftSection={<IconCurrencyDollar size={14} />}
              >
                {t("tabFxExchange")}
              </Tabs.Tab>
            )}
            {budgetSettings?.is_business_owner && (
              <Tabs.Tab
                value="business_advance_process"
                disabled={!isOnline}
                leftSection={<IconCoin size={14} />}
              >
                {t("tabBusinessAdvanceProcess")}
              </Tabs.Tab>
            )}
          </Tabs.List>
        </ScrollArea>

        <Box pt="md">
          <div style={{ display: activeTab === "simple" ? undefined : "none" }}>
            <SimpleEntryForm
              key={`${resetKeys.simple}:${locationState?.offlineDraftId ?? ""}`}
              accounts={accounts}
              budgetFilters={budgetFilters}
              onSubmit={handleSubmit}
              submitLabel={!isOnline ? t("saveOfflineDraft") : undefined}
              onDepreciationSubmit={handleDepreciationSubmit}
              initialDraft={
                plannedExpenseInitialDraft ??
                locationOfflineDraft?.draft ??
                (locationLoanDraft != null
                  ? {
                      formValues: locationLoanDraft,
                      budgetDist: [],
                      showZeroCategories: false,
                      settledEntryIds: locationSettledEntryIds,
                    }
                  : null) ??
                simpleDraft ??
                (typeParam === "loan"
                  ? {
                      formValues: { entryType: "loan" },
                      budgetDist: [],
                      showZeroCategories: false,
                    }
                  : undefined)
              }
              onDraftChange={handleSimpleDraftChange}
              onReset={() => resetForm("simple")}
            />
          </div>
          <div style={{ display: activeTab === "multi" ? undefined : "none" }}>
            <MultiLineEntryForm
              key={resetKeys.multi}
              onSubmit={handleSubmit}
              onReset={() => resetForm("multi")}
            />
          </div>
          <div style={{ display: activeTab === "budget" ? undefined : "none" }}>
            <BudgetAdjustForm
              key={resetKeys.budget}
              onDone={(result) => {
                if (result?.categoryArchived) {
                  void refresh();
                  return;
                }
                void refreshAfterBudgetAdjustment({
                  refreshBudget,
                  refreshAllocatable,
                });
              }}
              onReset={() => resetForm("budget")}
            />
          </div>
          {/* CSV and bulk tabs render when active (state is preserved via module-level vars) */}
          {activeTab === "csv" && (
            <CsvImportTab
              onImportDone={() => {
                refresh();
                void refreshBudget();
              }}
              onSwitchToBulk={() => {
                refresh();
                void refreshBudget();
                handleTabChange("bulk");
              }}
              onSwitchToSimple={() => {
                refresh();
                void refreshBudget();
                setResetKeys((k) => ({ ...k, simple: k.simple + 1 }));
                handleTabChange("simple");
              }}
            />
          )}
          {activeTab === "bulk" && (
            <BulkExpenseTab
              onPosted={() => {
                refresh();
                void refreshBudget();
              }}
            />
          )}
          {activeTab === "fx" && hasFx && (
            <ForeignExchangeForm
              onSuccess={() => {
                refresh();
              }}
            />
          )}
          {activeTab === "business_advance_process" &&
            budgetSettings?.is_business_owner && (
              <BusinessAdvanceProcessTab
                onDone={() => {
                  refresh();
                  void refreshBudget();
                }}
              />
            )}
        </Box>
      </Tabs>

      <ConfirmModal
        opened={resetConfirmOpened}
        onClose={closeResetConfirm}
        onConfirm={confirmReset}
        title={t("reset")}
        message={t("resetConfirm")}
        confirmLabel={t("reset")}
        confirmColor="orange"
      />
      <ConfirmModal
        opened={pendingPlannedExpenseCompletion != null}
        onClose={() => setPendingPlannedExpenseCompletion(null)}
        onConfirm={() => {
          if (pendingPlannedExpenseCompletion) {
            void (async () => {
              const completion = await completePlannedExpenseWithJournal(
                pendingPlannedExpenseCompletion.source,
                pendingPlannedExpenseCompletion.input,
              );
              setPendingPlannedExpenseCompletion(null);
              setSimpleDraft(null);
              showFeedback({
                message: t(plannedExpenseCompletionFeedbackKey(completion)),
                color: "teal",
              });
              refresh();
              void refreshBudget();
              void refreshAllocatable();
            })();
          }
        }}
        title={t("plannedExpenseCompleteSourceTitle")}
        message={t("plannedExpenseCompleteSourceMessage")}
        confirmLabel={t("plannedExpenseCompleteSourceConfirm")}
        confirmColor="teal"
      />
    </Stack>
  );
}
