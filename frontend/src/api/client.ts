import type {
  Account,
  AccountBudgetRatio,
  CreateAccountInput,
  JournalEntry,
  CreateJournalInput,
  BatchCreateJournalInput,
  PLReport,
  CryptoWallet,
  CreateCryptoWalletInput,
  CryptoBalance,
  CryptoChain,
  ExchangeCredential,
  CreateExchangeCredentialInput,
  BudgetCategory,
  CreateBudgetCategoryInput,
  UpdateBudgetCategoryInput,
  BudgetAllocation,
  UpsertBudgetAllocationInput,
  BudgetSummary,
  BudgetHistoryResponse,
  BudgetFilter,
  CreateBudgetFilterInput,
  BudgetAdjustmentLog,
  BudgetSettings,
  CreditCardSettings,
  CreateCreditCardSettingsInput,
  StoreAccountMapping,
  UpsertStoreAccountMappingInput,
  DepreciationSchedule,
  CreateDepreciationInput,
  UpdateDepreciationInput,
  DepreciationReport,
  ActualBalanceSnapshot,
  CreateActualBalanceSnapshotInput,
  CreditCardStateEntry,
  SaveCreditCardStateInput,
  UnsettledLoanEntry,
  EnabledCurrency,
  LongTermLoanPlan,
  LongTermLoanPlanRow,
  UpsertLongTermLoanPlanInput,
  UpsertLongTermLoanPlanRowInput,
  LongTermLoanComparisonRow,
  PlannedExpense,
  PlannedExpenseCategory,
  PlannedExpenseKind,
  CreatePlannedExpenseInput,
  CreatePlannedExpenseCategoryInput,
  ProductMetadata,
  ProductMetadataLookupInput,
  UpdatePlannedExpenseInput,
  UpdatePlannedExpenseCategoryInput,
  ProductApiCredentialStatus,
  ProductApiProvider,
  UpsertProductApiCredentialInput,
} from "@balance-sheet/shared";
import { createInFlightRequestDeduper } from "./inFlightRequest";
import {
  isLikelyCloudflareAccessResponse,
} from "../lib/appVersion";
import { showReloadPrompt } from "../lib/reloadPrompt";

const BASE = "/api";
const dedupeBudgetSummaryRequest = createInFlightRequestDeduper();
const dedupeCachedRequest = createInFlightRequestDeduper();
const sessionResponseCache = new Map<string, unknown>();
const NETWORK_OFFLINE_ERROR = "network_offline";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function createOfflineApiError() {
  return new ApiError(NETWORK_OFFLINE_ERROR, 0, {
    error: NETWORK_OFFLINE_ERROR,
  });
}

function isBrowserOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function isLikelyNetworkFailure(error: unknown) {
  return error instanceof TypeError || isBrowserOffline();
}

async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  if (isBrowserOffline()) throw createOfflineApiError();

  try {
    return await fetch(input, init);
  } catch (error) {
    if (isLikelyNetworkFailure(error)) throw createOfflineApiError();
    throw error;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    const bodyText = await res.text().catch(() => "");
    if (
      isLikelyCloudflareAccessResponse({
        status: res.status,
        redirected: res.redirected,
        url: res.url,
        contentType,
        bodyText,
      })
    ) {
      showReloadPrompt({ reason: "cloudflare-access-session" });
      throw new ApiError("cloudflare_access_session_expired", 401, {
        error: "cloudflare_access_session_expired",
      });
    }

    throw new ApiError(
      res.ok ? "unexpected_api_response" : res.statusText,
      res.status,
      { error: res.ok ? "unexpected_api_response" : res.statusText },
    );
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(
      (body as { message?: string; error?: string }).message ??
        (body as { error?: string }).error ??
        res.statusText,
      res.status,
      body as Record<string, unknown>,
    );
  }
  return res.json() as Promise<T>;
}

function cachedRequest<T>(path: string): Promise<T> {
  if (sessionResponseCache.has(path)) {
    return Promise.resolve(sessionResponseCache.get(path) as T);
  }
  return dedupeCachedRequest(path, async () => {
    const result = await request<T>(path);
    sessionResponseCache.set(path, result);
    return result;
  });
}

function invalidateSessionCache(
  predicate: (path: string) => boolean = () => true,
) {
  for (const key of [...sessionResponseCache.keys()]) {
    if (predicate(key)) sessionResponseCache.delete(key);
  }
}

function invalidatePrefixes(prefixes: string[]) {
  invalidateSessionCache((path) =>
    prefixes.some((prefix) => path.startsWith(prefix)),
  );
}

async function mutationRequest<T>(
  path: string,
  init: RequestInit,
  invalidate: string[],
): Promise<T> {
  const result = await request<T>(path, init);
  invalidatePrefixes(invalidate);
  return result;
}

const DERIVED_ACCOUNT_PREFIXES = ["/accounts", "/budget", "/reports"];
const DERIVED_JOURNAL_PREFIXES = ["/accounts", "/budget", "/reports"];
const BUDGET_PREFIXES = ["/budget"];
const PLANNED_EXPENSE_PREFIXES = ["/planned-expenses", "/budget"];

export const api = {
  accounts: {
    list: (asOf?: string) => {
      const path = asOf
        ? `/accounts?as_of=${encodeURIComponent(asOf)}`
        : "/accounts";
      return cachedRequest<Account[]>(path);
    },
    create: (input: CreateAccountInput) =>
      mutationRequest<Account>("/accounts", {
        method: "POST",
        body: JSON.stringify(input),
      }, DERIVED_ACCOUNT_PREFIXES),
    update: (
      id: number,
      input: {
        name?: string;
        category?: string;
        payday?: number | null;
        is_depreciable?: boolean;
        include_in_allocatable?: boolean;
        budget_ratios?: AccountBudgetRatio[];
      },
    ) =>
      mutationRequest<Account>(`/accounts/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }, DERIVED_ACCOUNT_PREFIXES),
    delete: (id: number) =>
      mutationRequest<{ success: boolean }>(
        `/accounts/${id}`,
        { method: "DELETE" },
        DERIVED_ACCOUNT_PREFIXES,
      ),
    replaceAccount: (id: number, replaceWithId: number) =>
      mutationRequest<{ success: boolean }>(`/accounts/${id}/replace`, {
        method: "POST",
        body: JSON.stringify({ replace_with_id: replaceWithId }),
      }, DERIVED_ACCOUNT_PREFIXES),
    forceComplete: (id: number) =>
      mutationRequest<{ success: boolean }>(`/accounts/${id}/complete`, {
        method: "POST",
      }, DERIVED_ACCOUNT_PREFIXES),
    forceUncomplete: (id: number) =>
      mutationRequest<{ success: boolean }>(`/accounts/${id}/complete`, {
        method: "DELETE",
      }, DERIVED_ACCOUNT_PREFIXES),
  },
  journal: {
    list: () => request<JournalEntry[]>("/journal"),
    get: (id: number) => request<JournalEntry>(`/journal/${id}`),
    create: (input: CreateJournalInput) =>
      mutationRequest<JournalEntry>("/journal", {
        method: "POST",
        body: JSON.stringify(input),
      }, DERIVED_JOURNAL_PREFIXES),
    batchCreate: (input: BatchCreateJournalInput) =>
      mutationRequest<JournalEntry[]>("/journal/batch", {
        method: "POST",
        body: JSON.stringify(input),
      }, DERIVED_JOURNAL_PREFIXES),
    update: (id: number, input: CreateJournalInput) =>
      mutationRequest<JournalEntry>(`/journal/${id}`, {
        method: "PUT",
        body: JSON.stringify(input),
      }, DERIVED_JOURNAL_PREFIXES),
    delete: (id: number) =>
      mutationRequest<{ success: boolean }>(
        `/journal/${id}`,
        { method: "DELETE" },
        DERIVED_JOURNAL_PREFIXES,
      ),
    bulkReplace: (input: {
      from_account_id: number;
      to_account_id: number;
      dry_run?: boolean;
      entry_ids?: number[];
    }) =>
      mutationRequest<{
        affected_lines: number;
        dry_run?: boolean;
        entries?: JournalEntry[];
      }>("/journal/bulk-replace", {
        method: "POST",
        body: JSON.stringify(input),
      }, DERIVED_JOURNAL_PREFIXES),
    bulkDelete: (input: {
      account_id?: number;
      date_from?: string;
      date_to?: string;
      description?: string;
      dry_run?: boolean;
      entry_ids?: number[];
    }) =>
      mutationRequest<{
        deleted_entries: number;
        dry_run?: boolean;
        entries?: JournalEntry[];
      }>("/journal/bulk-delete", {
        method: "POST",
        body: JSON.stringify(input),
      }, DERIVED_JOURNAL_PREFIXES),
  },
  reports: {
    pl: (params?: { from?: string; to?: string }) => {
      const q = new URLSearchParams();
      if (params?.from) q.set("from", params.from);
      if (params?.to) q.set("to", params.to);
      const qs = q.toString();
      return cachedRequest<PLReport>(`/reports/pl${qs ? `?${qs}` : ""}`);
    },
  },
  crypto: {
    list: () => request<CryptoWallet[]>("/crypto"),
    create: (input: CreateCryptoWalletInput) =>
      request<CryptoWallet>("/crypto", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    delete: (id: number) =>
      request<{ success: boolean }>(`/crypto/${id}`, { method: "DELETE" }),
    balance: (address: string, chain: CryptoChain) => {
      const q = new URLSearchParams({ address, chain });
      return request<CryptoBalance>(`/crypto/balance?${q.toString()}`);
    },
  },
  exchangeCredentials: {
    list: () => request<ExchangeCredential[]>("/exchange-credentials"),
    upsert: (input: CreateExchangeCredentialInput) =>
      request<ExchangeCredential>("/exchange-credentials", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    delete: (id: number) =>
      request<{ success: boolean }>(`/exchange-credentials/${id}`, {
        method: "DELETE",
      }),
  },
  productApiCredentials: {
    list: () =>
      request<ProductApiCredentialStatus[]>("/product-api-credentials"),
    upsert: (
      provider: ProductApiProvider,
      input: UpsertProductApiCredentialInput,
    ) =>
      request<ProductApiCredentialStatus>(
        `/product-api-credentials/${provider}`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      ),
    delete: (provider: ProductApiProvider) =>
      request<{ success: boolean }>(`/product-api-credentials/${provider}`, {
        method: "DELETE",
      }),
  },
  budget: {
    listCategories: (options?: { includeArchived?: boolean }) => {
      const q = new URLSearchParams();
      if (options?.includeArchived) q.set("include_archived", "1");
      const qs = q.toString();
      return cachedRequest<BudgetCategory[]>(
        `/budget/categories${qs ? `?${qs}` : ""}`,
      );
    },
    createCategory: (input: CreateBudgetCategoryInput) =>
      mutationRequest<BudgetCategory>("/budget/categories", {
        method: "POST",
        body: JSON.stringify(input),
      }, BUDGET_PREFIXES),
    updateCategory: (id: number, input: UpdateBudgetCategoryInput) =>
      mutationRequest<BudgetCategory>(`/budget/categories/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }, BUDGET_PREFIXES),
    deleteCategory: (id: number) =>
      mutationRequest<{ success: boolean }>(`/budget/categories/${id}`, {
        method: "DELETE",
      }, BUDGET_PREFIXES),
    upsertAllocation: (input: UpsertBudgetAllocationInput) =>
      mutationRequest<BudgetAllocation>("/budget/allocations", {
        method: "POST",
        body: JSON.stringify(input),
      }, BUDGET_PREFIXES),
    summary: (yearMonth: string, asOf?: string, currency?: string) => {
      const q = new URLSearchParams({ year_month: yearMonth });
      if (asOf) q.set("as_of", asOf);
      if (currency) q.set("currency", currency);
      const path = `/budget/summary?${q.toString()}`;
      return dedupeBudgetSummaryRequest(path, () => cachedRequest<BudgetSummary>(path));
    },
    history: (from: string, to: string, currency?: string) => {
      const q = new URLSearchParams({ from, to });
      if (currency) q.set("currency", currency);
      return cachedRequest<BudgetHistoryResponse>(
        `/budget/history?${q.toString()}`,
      );
    },
    patchAdhocAllocation: (input: {
      budget_category_id: number;
      year_month: string;
      currency?: string;
      adhoc_delta: number;
      date?: string;
      note?: string | null;
      adjustment_type?: "allocation" | "reset";
      archive_category?: boolean;
    }) =>
      mutationRequest<BudgetAdjustmentLog>("/budget/allocations", {
        method: "PATCH",
        body: JSON.stringify(input),
      }, BUDGET_PREFIXES),
    listAdjustmentLogs: (params?: {
      from?: string;
      to?: string;
      currency?: string;
    }) => {
      const q = new URLSearchParams();
      if (params?.from) q.set("from", params.from);
      if (params?.to) q.set("to", params.to);
      if (params?.currency) q.set("currency", params.currency);
      const qs = q.toString();
      return cachedRequest<BudgetAdjustmentLog[]>(
        `/budget/adjustment-logs${qs ? `?${qs}` : ""}`,
      );
    },
    getSettings: () => cachedRequest<BudgetSettings>("/budget/settings"),
    updateSettings: (input: {
      preferred_payment_account_ids?: number[];
      preferred_filter_ids?: number[];
      calendar_week_start?: number;
      is_business_owner?: boolean;
      business_advance_account_id?: number | null;
      business_loss_account_id?: number | null;
      business_advance_budget_category_id?: number | null;
    }) =>
      mutationRequest<BudgetSettings>("/budget/settings", {
        method: "PATCH",
        body: JSON.stringify(input),
      }, BUDGET_PREFIXES),
    deleteAdjustmentLog: (id: number) =>
      mutationRequest<{ ok: boolean }>(`/budget/adjustment-logs/${id}`, {
        method: "DELETE",
      }, BUDGET_PREFIXES),
    updateAdjustmentLog: (
      id: number,
      input: { amount?: number; date?: string; note?: string | null },
    ) =>
      mutationRequest<BudgetAdjustmentLog>(`/budget/adjustment-logs/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }, BUDGET_PREFIXES),
    listFilters: () => cachedRequest<BudgetFilter[]>("/budget/filters"),
    createFilter: (input: CreateBudgetFilterInput) =>
      mutationRequest<BudgetFilter>("/budget/filters", {
        method: "POST",
        body: JSON.stringify(input),
      }, BUDGET_PREFIXES),
    updateFilter: (
      id: number,
      input: {
        name?: string;
        currency?: string;
        is_active?: boolean;
        steps?: CreateBudgetFilterInput["steps"];
      },
    ) =>
      mutationRequest<BudgetFilter>(`/budget/filters/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }, BUDGET_PREFIXES),
    deleteFilter: (id: number) =>
      mutationRequest<{ success: boolean }>(`/budget/filters/${id}`, {
        method: "DELETE",
      }, BUDGET_PREFIXES),
    copyFilter: (id: number) =>
      mutationRequest<BudgetFilter>(
        `/budget/filters/${id}/copy`,
        { method: "POST" },
        BUDGET_PREFIXES,
      ),
  },
  storeMappings: {
    list: () => request<StoreAccountMapping[]>("/store-mappings"),
    upsert: (input: UpsertStoreAccountMappingInput) =>
      request<StoreAccountMapping>("/store-mappings", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    delete: (id: number) =>
      request<{ success: boolean }>(`/store-mappings/${id}`, {
        method: "DELETE",
      }),
  },
  admin: {
    erase: (scope: string) =>
      request<{ ok: boolean; scope: string }>("/admin/erase", {
        method: "POST",
        body: JSON.stringify({ scope }),
      }),
    seed: (locale: string) =>
      request<{ ok: boolean; created?: number; skipped?: boolean }>(
        "/admin/seed",
        { method: "POST", body: JSON.stringify({ locale }) },
      ),
    exportDb: async (): Promise<Blob> => {
      const res = await apiFetch(`${BASE}/admin/export-db`);
      const contentType = res.headers.get("content-type") ?? "";
      if (
        contentType.toLowerCase().includes("text/html") ||
        res.url.toLowerCase().includes("/cdn-cgi/access/")
      ) {
        const bodyText = await res.clone().text().catch(() => "");
        if (
          isLikelyCloudflareAccessResponse({
            status: res.status,
            redirected: res.redirected,
            url: res.url,
            contentType,
            bodyText,
          })
        ) {
          showReloadPrompt({ reason: "cloudflare-access-session" });
          throw new ApiError("cloudflare_access_session_expired", 401, {
            error: "cloudflare_access_session_expired",
          });
        }
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new ApiError(
          (body as { message?: string; error?: string }).message ??
            (body as { error?: string }).error ??
            res.statusText,
          res.status,
          body as Record<string, unknown>,
        );
      }
      return res.blob();
    },
  },
  creditCardSettings: {
    list: () => request<CreditCardSettings[]>("/credit-card-settings"),
    upsert: (input: CreateCreditCardSettingsInput) =>
      request<CreditCardSettings>("/credit-card-settings", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    delete: (account_id: number) =>
      request<{ success: boolean }>(`/credit-card-settings/${account_id}`, {
        method: "DELETE",
      }),
  },
  depreciation: {
    list: () => request<DepreciationSchedule[]>("/depreciation"),
    create: (input: CreateDepreciationInput) =>
      request<{
        schedule_id: number;
        source_journal_entry_id: number;
        monthly_amounts: number[];
        entry_dates: string[];
      }>("/depreciation", { method: "POST", body: JSON.stringify(input) }),
    update: (id: number, input: UpdateDepreciationInput) =>
      request<{
        schedule_id: number;
        monthly_amounts: number[];
        entry_dates: string[];
      }>(`/depreciation/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    delete: (id: number) =>
      request<{ success: boolean }>(`/depreciation/${id}`, {
        method: "DELETE",
      }),
    report: (params: { year?: string; year_month?: string }) => {
      const q = new URLSearchParams();
      if (params.year) q.set("year", params.year);
      if (params.year_month) q.set("year_month", params.year_month);
      return request<DepreciationReport>(
        `/depreciation/report?${q.toString()}`,
      );
    },
  },
  trialBalance: {
    listSnapshots: () =>
      request<ActualBalanceSnapshot[]>("/trial-balance/snapshots"),
    createSnapshot: (input: CreateActualBalanceSnapshotInput) =>
      request<ActualBalanceSnapshot>("/trial-balance/snapshots", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    deleteSnapshot: (id: number) =>
      request<{ ok: boolean }>(`/trial-balance/snapshots/${id}`, {
        method: "DELETE",
      }),
    getCreditCardState: () =>
      request<CreditCardStateEntry[]>("/trial-balance/credit-card-state"),
    saveCreditCardState: (input: SaveCreditCardStateInput) =>
      request<CreditCardStateEntry[]>("/trial-balance/credit-card-state", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  },
  loans: {
    unsettled: (
      accountId: number,
      settlerEntryId?: number,
      currency?: string,
    ) => {
      const q = new URLSearchParams({ account_id: String(accountId) });
      if (settlerEntryId != null) {
        q.set("settler_entry_id", String(settlerEntryId));
      }
      if (currency) q.set("currency", currency);
      return request<{ entries: UnsettledLoanEntry[] }>(
        `/loans/unsettled?${q.toString()}`,
      );
    },
    settle: (body: {
      journal_entry_ids: number[];
      settled_by_journal_entry_id?: number;
    }) =>
      request<{ success: boolean }>("/loans/settle", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },
  longTermLoanPlans: {
    get: (accountId: number) =>
      request<{ plan: LongTermLoanPlan | null }>(
        `/long-term-loan-plans/${accountId}`,
      ),
    upsert: (input: UpsertLongTermLoanPlanInput) =>
      request<{ plan: LongTermLoanPlan }>("/long-term-loan-plans", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    upsertRows: (accountId: number, rows: UpsertLongTermLoanPlanRowInput[]) =>
      request<{ rows: LongTermLoanPlanRow[] }>(
        `/long-term-loan-plans/${accountId}/rows`,
        { method: "PUT", body: JSON.stringify({ rows }) },
      ),
    deleteRow: (accountId: number, yearMonth: string) =>
      request<{ success: boolean }>(
        `/long-term-loan-plans/${accountId}/rows/${encodeURIComponent(yearMonth)}`,
        { method: "DELETE" },
      ),
    comparison: (accountId: number) =>
      request<{ rows: LongTermLoanComparisonRow[] }>(
        `/long-term-loan-plans/${accountId}/comparison`,
      ),
  },
  plannedExpenses: {
    listCategories: (params?: {
      kind?: PlannedExpenseKind;
      includeArchived?: boolean;
    }) => {
      const q = new URLSearchParams();
      if (params?.kind) q.set("kind", params.kind);
      if (params?.includeArchived) q.set("include_archived", "true");
      const qs = q.toString();
      return cachedRequest<PlannedExpenseCategory[]>(
        `/planned-expenses/categories${qs ? `?${qs}` : ""}`,
      );
    },
    createCategory: (input: CreatePlannedExpenseCategoryInput) =>
      mutationRequest<PlannedExpenseCategory>("/planned-expenses/categories", {
        method: "POST",
        body: JSON.stringify(input),
      }, PLANNED_EXPENSE_PREFIXES),
    updateCategory: (id: number, input: UpdatePlannedExpenseCategoryInput) =>
      mutationRequest<PlannedExpenseCategory>(
        `/planned-expenses/categories/${id}`,
        {
          method: "PATCH",
          body: JSON.stringify(input),
        },
        PLANNED_EXPENSE_PREFIXES,
      ),
    deleteCategory: (id: number) =>
      mutationRequest<{ success: boolean }>(
        `/planned-expenses/categories/${id}`,
        { method: "DELETE" },
        PLANNED_EXPENSE_PREFIXES,
      ),
    list: (params?: {
      kind?: PlannedExpenseKind;
      status?: PlannedExpense["status"];
      includeArchived?: boolean;
    }) => {
      const q = new URLSearchParams();
      if (params?.kind) q.set("kind", params.kind);
      if (params?.status) q.set("status", params.status);
      if (params?.includeArchived) q.set("include_archived", "true");
      const qs = q.toString();
      return cachedRequest<PlannedExpense[]>(
        `/planned-expenses${qs ? `?${qs}` : ""}`,
      );
    },
    create: (input: CreatePlannedExpenseInput) =>
      mutationRequest<PlannedExpense>("/planned-expenses", {
        method: "POST",
        body: JSON.stringify(input),
      }, PLANNED_EXPENSE_PREFIXES),
    lookupMetadata: (input: ProductMetadataLookupInput) =>
      mutationRequest<ProductMetadata>("/planned-expenses/metadata", {
        method: "POST",
        body: JSON.stringify(input),
      }, PLANNED_EXPENSE_PREFIXES),
    refreshMetadata: (id: number) =>
      mutationRequest<PlannedExpense>(`/planned-expenses/${id}/refresh-metadata`, {
        method: "POST",
      }, PLANNED_EXPENSE_PREFIXES),
    update: (id: number, input: UpdatePlannedExpenseInput) =>
      mutationRequest<PlannedExpense>(`/planned-expenses/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }, PLANNED_EXPENSE_PREFIXES),
    delete: (id: number) =>
      mutationRequest<{ success: boolean }>(`/planned-expenses/${id}`, {
        method: "DELETE",
      }, PLANNED_EXPENSE_PREFIXES),
  },
  currencies: {
    list: () => cachedRequest<EnabledCurrency[]>("/currencies"),
    toggle: (
      code: string,
      enabled: boolean,
      custom_symbol?: string,
      decimal_places?: number,
      custom_icon?: string,
      background_color?: string | null,
    ) =>
      mutationRequest<EnabledCurrency[]>("/currencies", {
        method: "POST",
        body: JSON.stringify({
          code,
          enabled,
          custom_symbol,
          decimal_places,
          custom_icon,
          background_color,
        }),
      }, ["/currencies", "/budget"]),
    setPriority: (code: string, symbol_priority: number) =>
      mutationRequest<EnabledCurrency[]>(`/currencies/${encodeURIComponent(code)}`, {
        method: "PATCH",
        body: JSON.stringify({ symbol_priority }),
      }, ["/currencies"]),
    update: (
      code: string,
      input: {
        symbol_priority?: number;
        decimal_places?: number;
        background_color?: string | null;
      },
    ) =>
      mutationRequest<EnabledCurrency[]>(
        `/currencies/${encodeURIComponent(code)}`,
        {
          method: "PATCH",
          body: JSON.stringify(input),
        },
        ["/currencies", "/budget"],
      ),
    reorder: (codes: string[]) =>
      mutationRequest<EnabledCurrency[]>("/currencies/reorder", {
        method: "POST",
        body: JSON.stringify({ codes }),
      }, ["/currencies"]),
  },
  __testing: {
    clearSessionCache: () => invalidateSessionCache(),
  },
};
