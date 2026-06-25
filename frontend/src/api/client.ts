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
} from "@balance-sheet/shared";
import { createInFlightRequestDeduper } from "./inFlightRequest";

const BASE = "/api";
const dedupeBudgetSummaryRequest = createInFlightRequestDeduper();

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
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

export const api = {
  accounts: {
    list: (asOf?: string) => {
      const path = asOf
        ? `/accounts?as_of=${encodeURIComponent(asOf)}`
        : "/accounts";
      return request<Account[]>(path);
    },
    create: (input: CreateAccountInput) =>
      request<Account>("/accounts", {
        method: "POST",
        body: JSON.stringify(input),
      }),
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
      request<Account>(`/accounts/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    delete: (id: number) =>
      request<{ success: boolean }>(`/accounts/${id}`, { method: "DELETE" }),
    replaceAccount: (id: number, replaceWithId: number) =>
      request<{ success: boolean }>(`/accounts/${id}/replace`, {
        method: "POST",
        body: JSON.stringify({ replace_with_id: replaceWithId }),
      }),
    forceComplete: (id: number) =>
      request<{ success: boolean }>(`/accounts/${id}/complete`, {
        method: "POST",
      }),
    forceUncomplete: (id: number) =>
      request<{ success: boolean }>(`/accounts/${id}/complete`, {
        method: "DELETE",
      }),
  },
  journal: {
    list: () => request<JournalEntry[]>("/journal"),
    get: (id: number) => request<JournalEntry>(`/journal/${id}`),
    create: (input: CreateJournalInput) =>
      request<JournalEntry>("/journal", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    batchCreate: (input: BatchCreateJournalInput) =>
      request<JournalEntry[]>("/journal/batch", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    update: (id: number, input: CreateJournalInput) =>
      request<JournalEntry>(`/journal/${id}`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    delete: (id: number) =>
      request<{ success: boolean }>(`/journal/${id}`, { method: "DELETE" }),
    bulkReplace: (input: {
      from_account_id: number;
      to_account_id: number;
      dry_run?: boolean;
      entry_ids?: number[];
    }) =>
      request<{
        affected_lines: number;
        dry_run?: boolean;
        entries?: JournalEntry[];
      }>("/journal/bulk-replace", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    bulkDelete: (input: {
      account_id?: number;
      date_from?: string;
      date_to?: string;
      description?: string;
      dry_run?: boolean;
      entry_ids?: number[];
    }) =>
      request<{
        deleted_entries: number;
        dry_run?: boolean;
        entries?: JournalEntry[];
      }>("/journal/bulk-delete", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  },
  reports: {
    pl: (params?: { from?: string; to?: string }) => {
      const q = new URLSearchParams();
      if (params?.from) q.set("from", params.from);
      if (params?.to) q.set("to", params.to);
      const qs = q.toString();
      return request<PLReport>(`/reports/pl${qs ? `?${qs}` : ""}`);
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
  budget: {
    listCategories: (options?: { includeArchived?: boolean }) => {
      const q = new URLSearchParams();
      if (options?.includeArchived) q.set("include_archived", "1");
      const qs = q.toString();
      return request<BudgetCategory[]>(
        `/budget/categories${qs ? `?${qs}` : ""}`,
      );
    },
    createCategory: (input: CreateBudgetCategoryInput) =>
      request<BudgetCategory>("/budget/categories", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    updateCategory: (id: number, input: UpdateBudgetCategoryInput) =>
      request<BudgetCategory>(`/budget/categories/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    deleteCategory: (id: number) =>
      request<{ success: boolean }>(`/budget/categories/${id}`, {
        method: "DELETE",
      }),
    upsertAllocation: (input: UpsertBudgetAllocationInput) =>
      request<BudgetAllocation>("/budget/allocations", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    summary: (yearMonth: string, asOf?: string, currency?: string) => {
      const q = new URLSearchParams({ year_month: yearMonth });
      if (asOf) q.set("as_of", asOf);
      if (currency) q.set("currency", currency);
      const path = `/budget/summary?${q.toString()}`;
      return dedupeBudgetSummaryRequest(path, () =>
        request<BudgetSummary>(path),
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
      request<BudgetAdjustmentLog>("/budget/allocations", {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
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
      return request<BudgetAdjustmentLog[]>(
        `/budget/adjustment-logs${qs ? `?${qs}` : ""}`,
      );
    },
    getSettings: () => request<BudgetSettings>("/budget/settings"),
    updateSettings: (input: {
      preferred_payment_account_ids?: number[];
      preferred_filter_ids?: number[];
      is_business_owner?: boolean;
      business_advance_account_id?: number | null;
      business_loss_account_id?: number | null;
      business_advance_budget_category_id?: number | null;
    }) =>
      request<BudgetSettings>("/budget/settings", {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    deleteAdjustmentLog: (id: number) =>
      request<{ ok: boolean }>(`/budget/adjustment-logs/${id}`, {
        method: "DELETE",
      }),
    updateAdjustmentLog: (
      id: number,
      input: { amount?: number; date?: string; note?: string | null },
    ) =>
      request<BudgetAdjustmentLog>(`/budget/adjustment-logs/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    listFilters: () => request<BudgetFilter[]>("/budget/filters"),
    createFilter: (input: CreateBudgetFilterInput) =>
      request<BudgetFilter>("/budget/filters", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    updateFilter: (
      id: number,
      input: {
        name?: string;
        currency?: string;
        is_active?: boolean;
        steps?: CreateBudgetFilterInput["steps"];
      },
    ) =>
      request<BudgetFilter>(`/budget/filters/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    deleteFilter: (id: number) =>
      request<{ success: boolean }>(`/budget/filters/${id}`, {
        method: "DELETE",
      }),
    copyFilter: (id: number) =>
      request<BudgetFilter>(`/budget/filters/${id}/copy`, { method: "POST" }),
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
      const res = await fetch(`${BASE}/admin/export-db`);
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
  currencies: {
    list: () => request<EnabledCurrency[]>("/currencies"),
    toggle: (
      code: string,
      enabled: boolean,
      custom_symbol?: string,
      decimal_places?: number,
      custom_icon?: string,
    ) =>
      request<EnabledCurrency[]>("/currencies", {
        method: "POST",
        body: JSON.stringify({
          code,
          enabled,
          custom_symbol,
          decimal_places,
          custom_icon,
        }),
      }),
    setPriority: (code: string, symbol_priority: number) =>
      request<EnabledCurrency[]>(`/currencies/${encodeURIComponent(code)}`, {
        method: "PATCH",
        body: JSON.stringify({ symbol_priority }),
      }),
    reorder: (codes: string[]) =>
      request<EnabledCurrency[]>("/currencies/reorder", {
        method: "POST",
        body: JSON.stringify({ codes }),
      }),
  },
};
