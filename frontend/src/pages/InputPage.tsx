import {
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
} from "@tabler/icons-react";
import {
  useSearchParams,
  useLocation,
  useNavigate,
  Link,
} from "react-router-dom";
import { useCallback, useRef, useState } from "react";
import type { CreateJournalInput } from "@balance-sheet/shared";
import { api } from "../api/client";
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
  savedTab,
  setSavedTab,
  simpleDraft,
  setSimpleDraft,
  setMultiDraft,
  setBudgetDraft,
} from "../utils/inputDrafts";

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
  } | null;
  const locationLoanDraft = locationState?.loanDraft;
  const locationPlannedExpenseEntry = locationState?.plannedExpenseEntry;
  const locationSettledEntryIds = locationState?.settledEntryIds;
  const fromTt = searchParams.get("from") === "tt";
  const typeParam = searchParams.get("type"); // e.g. "loan" from /fs/db
  const {
    accounts,
    budgetFilters,
    budgetSettings,
    enabledCurrencies,
    displayCurrency,
    loading,
    error,
    refresh,
    refreshBudget,
    refreshAllocatable,
  } = useAppData();

  const hasFx = enabledCurrencies.length >= 2;
  const [activeTab, setActiveTab] = useState(
    locationLoanDraft != null || locationPlannedExpenseEntry != null
      ? "simple"
      : (locationState?.tab ?? savedTab),
  );
  const [pendingPlannedExpenseCompletion, setPendingPlannedExpenseCompletion] =
    useState<{
      source: PlannedExpenseEntrySource;
      checkoutDate: string;
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
    setSimpleDraft(draft);
  }, []);

  const plannedExpenseInitialDraft: SimpleFormDraft | null =
    locationPlannedExpenseEntry != null
      ? {
          formValues: {
            entryType: "expense",
            description: locationPlannedExpenseEntry.name,
            expenseCategoryId: locationPlannedExpenseEntry.expenseAccountId,
            amount: locationPlannedExpenseEntry.amount,
          },
          budgetDist: [],
          showZeroCategories: false,
        }
      : null;

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

  async function completePlannedExpenseSource(
    source: PlannedExpenseEntrySource,
    checkoutDate: string,
  ): Promise<boolean> {
    try {
      const checkoutItemIds = source.checkoutItemIds ?? [];
      const checkoutKeepItemIdSet = new Set(source.checkoutKeepItemIds ?? []);
      const completedItemIds =
        checkoutItemIds.length > 0 ? checkoutItemIds : [source.id];
      if (
        source.kind === "shopping_list" &&
        source.categoryId != null &&
        source.categoryShoppingPlanType === "routine" &&
        checkoutItemIds.length > 0
      ) {
        const checkoutItemIdSet = new Set(checkoutItemIds);
        const checkoutItems =
          source.checkoutItems ??
          (await api.plannedExpenses.list({ kind: "shopping_list" }))
            .filter((item) => checkoutItemIdSet.has(item.id))
            .map((item) => ({
              id: item.id,
              name: item.name,
              estimatedAmount: item.estimated_amount,
              currency: item.currency,
              status: item.status,
              keepOnRoutineClear: item.keep_on_routine_clear,
              note: item.note,
            }));
        const snapshotArchivedAt = new Date().toISOString();
        const snapshotCategory = await api.plannedExpenses.createCategory({
          kind: "shopping_list",
          name: source.name,
          estimated_amount: source.amount,
          currency: source.currency,
          default_expense_account_id: source.expenseAccountId,
          target_date: source.categoryTargetDate ?? checkoutDate,
          shopping_plan_type: "one_time",
        });
        await Promise.all(
          checkoutItems.map((item) =>
            api.plannedExpenses.create({
              kind: "shopping_list",
              category_id: snapshotCategory.id,
              name: item.name,
              estimated_amount: item.estimatedAmount,
              currency: item.currency,
              budget_category_id: null,
              expense_account_id: null,
              target_date: null,
              recurrence_type: "one_time",
              recurrence_interval_months: null,
              recurrence_day: null,
              next_due_date: null,
              end_date: null,
              priority: 2,
              status: item.status,
              keep_on_routine_clear: item.keepOnRoutineClear,
              note: item.note,
              url: null,
              product_metadata_cache_id: null,
            }),
          ),
        );
        await api.plannedExpenses.updateCategory(snapshotCategory.id, {
          archived_at: snapshotArchivedAt,
        });
        await Promise.all(
          checkoutItemIds.map((id) =>
            checkoutKeepItemIdSet.has(id)
              ? api.plannedExpenses.update(id, { status: "open" })
              : api.plannedExpenses.delete(id),
          ),
        );
        await api.plannedExpenses.updateCategory(source.categoryId, {
          last_checked_out_date: checkoutDate,
        });
        return true;
      }
      await Promise.all(
        completedItemIds.map((id) =>
          api.plannedExpenses.update(id, {
            status: checkoutKeepItemIdSet.has(id) ? "open" : "completed",
          }),
        ),
      );
      if (
        source.kind === "shopping_list" &&
        source.categoryId != null &&
        source.categoryShoppingPlanType === "one_time"
      ) {
        await api.plannedExpenses.updateCategory(source.categoryId, {
          archived_at: new Date().toISOString(),
        });
        return checkoutItemIds.length > 0;
      }
      return false;
    } catch (e) {
      showFeedback({
        message: e instanceof Error ? e.message : String(e),
        color: "red",
      });
      return false;
    }
  }

  async function handlePlannedExpenseCompletion(values: CreateJournalInput) {
    const source = locationPlannedExpenseEntry;
    if (!source || activeTab !== "simple") return "none";

    clearPlannedExpenseNavigationState();
    const submitted = getSubmittedExpenseSummary(values);
    const allChanged =
      submitted.description !== source.name.trim() &&
      submitted.expenseAccountId !== source.expenseAccountId &&
      Math.round(submitted.amount) !== Math.round(source.amount);

    if (allChanged) {
      setPendingPlannedExpenseCompletion({ source, checkoutDate: values.date });
      return "pending";
    }

    return (await completePlannedExpenseSource(source, values.date))
      ? "shopping_list_archived"
      : "none";
  }

  async function handleSubmit(
    values: CreateJournalInput,
    meta?: SimpleEntryMeta,
  ) {
    void meta;
    const input = {
      ...values,
      lines: values.lines.map((l) => ({
        currency: displayCurrency,
        ...l,
      })),
    };
    await api.journal.create(input);
    if (activeTab === "simple") setSimpleDraft(null);
    if (activeTab === "multi") setMultiDraft(null);
    const plannedExpenseCompletion = await handlePlannedExpenseCompletion(input);
    showFeedback({
      message:
        plannedExpenseCompletion === "shopping_list_archived"
          ? t("transactionSavedWithShoppingListArchived")
          : t("transactionSaved"),
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
            <Tabs.Tab value="multi" leftSection={<IconLayoutGrid size={14} />}>
              {t("tabMultiLine")}
            </Tabs.Tab>
            <Tabs.Tab value="budget" leftSection={<IconCoin size={14} />}>
              {t("tabBudgetAdjust")}
            </Tabs.Tab>
            <Tabs.Tab
              value="csv"
              leftSection={<IconFileSpreadsheet size={14} />}
            >
              {t("tabCsvImport")}
            </Tabs.Tab>
            <Tabs.Tab value="bulk" leftSection={<IconShoppingCart size={14} />}>
              {t("tabBulkExpense")}
            </Tabs.Tab>
            {hasFx && (
              <Tabs.Tab
                value="fx"
                leftSection={<IconCurrencyDollar size={14} />}
              >
                {t("tabFxExchange")}
              </Tabs.Tab>
            )}
            {budgetSettings?.is_business_owner && (
              <Tabs.Tab
                value="business_advance_process"
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
              key={resetKeys.simple}
              accounts={accounts}
              budgetFilters={budgetFilters}
              onSubmit={handleSubmit}
              onDepreciationSubmit={handleDepreciationSubmit}
              initialDraft={
                plannedExpenseInitialDraft ??
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
              const archived = await completePlannedExpenseSource(
                pendingPlannedExpenseCompletion.source,
                pendingPlannedExpenseCompletion.checkoutDate,
              );
              if (archived) {
                showFeedback({
                  message: t("shoppingListArchivedFeedback"),
                  color: "teal",
                });
              }
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
