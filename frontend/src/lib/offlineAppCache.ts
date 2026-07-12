import type {
  Account,
  BudgetCategory,
  BudgetFilter,
  BudgetSettings,
  BudgetSummary,
  EnabledCurrency,
} from "@balance-sheet/shared";

const STORAGE_KEY = "balance-sheet:offline-app-cache:v1";

export interface TodayBudgetSnapshot {
  asOf: string;
  capturedAt: string;
  summary: BudgetSummary;
}

export interface OfflineAppCache {
  accounts?: Account[];
  budgetCategories?: BudgetCategory[];
  budgetFilters?: BudgetFilter[];
  budgetSettings?: BudgetSettings | null;
  enabledCurrencies?: EnabledCurrency[];
  todayBudget?: TodayBudgetSnapshot;
}

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readOfflineAppCache(
  storage: Storage | null = browserStorage(),
): OfflineAppCache | null {
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
    return parsed && typeof parsed === "object"
      ? (parsed as OfflineAppCache)
      : null;
  } catch {
    return null;
  }
}

export function updateOfflineAppCache(
  patch: Partial<OfflineAppCache>,
  storage: Storage | null = browserStorage(),
): OfflineAppCache {
  const next = { ...(readOfflineAppCache(storage) ?? {}), ...patch };
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Offline support is best-effort when storage is unavailable or full.
  }
  return next;
}

export function getCachedTodayBudgetSummary(
  asOf: string,
  currency: string,
  storage: Storage | null = browserStorage(),
): TodayBudgetSnapshot | null {
  const snapshot = readOfflineAppCache(storage)?.todayBudget;
  if (!snapshot) return null;
  if (snapshot.asOf !== asOf) return null;
  if (snapshot.summary.currency.toUpperCase() !== currency.toUpperCase()) {
    return null;
  }
  return snapshot;
}

