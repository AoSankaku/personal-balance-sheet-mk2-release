import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Account,
  BudgetCategory,
  BudgetFilter,
  BudgetSettings,
  BudgetSummary,
  CreditCardSettings,
  CreditCardStateEntry,
  CreditCardStatementCompletion,
  CryptoPrices,
  CryptoWallet,
  EnabledCurrency,
  ExchangeCredential,
  ExchangeRates,
  JournalEntry,
  PLReport,
  TaskSettings,
  UpdateTaskSettingsInput,
} from "@balance-sheet/shared";
import { api, ApiError } from "../api/client";
import { useLang } from "../i18n";
import { useCryptoPrices } from "../hooks/useCryptoPrices";
import { useExchangeRates } from "../hooks/useExchangeRates";
import type {
  ManualExchangeRateSpec,
  ManualExchangeRateSpecs,
} from "../lib/manualExchangeRates";
import { getEffectiveSymbol } from "../lib/currencyUtils";
import {
  computeAllocatableBudget,
  sumAllocatableCashBalances,
  sumBudgetClaims,
} from "../lib/allocatableBudget";
import {
  getStoredCryptoIconStyle,
  storeCryptoIconStyle,
  type CryptoIconStyle,
} from "../lib/cryptoCurrencyIcons";
import { toDateStr } from "../lib/dateUtils";
import { usePrivacy } from "./PrivacyContext";
import {
  applyPrivateAccountNames,
  buildPrivateAccountNameMap,
} from "../lib/privacy";
import { useLocation } from "react-router-dom";
import { shouldRefreshMonthScopedData } from "../lib/overviewSummaryLoading";
import {
  readOfflineAppCache,
  updateOfflineAppCache,
  type OfflineAppCache,
} from "../lib/offlineAppCache";
import {
  DEFAULT_TASK_SETTINGS,
  migrateLegacyTaskSettingsIfNeeded,
} from "../lib/taskSettings";

function normalizeCurrency(currency: string | null | undefined) {
  return (currency || "JPY").toUpperCase();
}

interface AppDataContextValue {
  accounts: Account[];
  journal: JournalEntry[];
  pl: PLReport;
  cryptoWallets: CryptoWallet[];
  exchangeCredentials: ExchangeCredential[];
  cryptoBalances: Map<number, number>;
  prices: CryptoPrices | null;
  budgetCategories: BudgetCategory[];
  budgetFilters: BudgetFilter[];
  budgetSummary: BudgetSummary | null;
  budgetSettings: BudgetSettings | null;
  creditCardSettings: CreditCardSettings[];
  creditCardState: CreditCardStateEntry[];
  creditCardStatementCompletions: CreditCardStatementCompletion[];
  latestTrialBalanceDate: string | null;
  taskSettings: TaskSettings;
  currentYearMonth: string;
  setCurrentYearMonth: (ym: string) => void;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  refreshCryptoBalances: () => void;
  /** Manually refresh crypto prices. Returns false if still on cooldown. */
  refreshCryptoPrices: () => Promise<boolean>;
  /** Force refresh crypto prices regardless of cooldown (use after switching provider). */
  forceRefreshCryptoPrices: () => Promise<void>;
  /** Force refresh exchange rates regardless of cooldown (use after switching provider). */
  forceRefreshRates: () => Promise<void>;
  /** Seconds until the next price refresh is allowed (0 = ready) */
  pricesCooldown: number;
  refreshBudget: () => void;
  refreshBudgetFilters: () => void;
  refreshCreditCardSettings: () => void;
  refreshCreditCardState: () => void;
  refreshCreditCardStatementCompletions: () => void;
  refreshLatestTrialBalanceDate: () => void;
  updateTaskSettings: (input: UpdateTaskSettingsInput) => Promise<TaskSettings>;
  refreshBudgetSettings: () => void;
  refreshAllocatable: () => void;
  allocatableToday: number;
  allocatableTotal: number;
  assetBalanceToday: number;
  assetBalanceTotal: number;
  loggedToday: number;
  loggedTotal: number;
  /** Currently selected display/input currency */
  displayCurrency: string;
  /** Effective symbol for the current display currency (e.g. "¥", "$", "€"), respecting custom_symbol and conflict resolution */
  displayCurrencySymbol: string;
  setDisplayCurrency: (currency: string) => void;
  /** Currencies the user has enabled */
  enabledCurrencies: EnabledCurrency[];
  /** True after the first enabled-currency fetch has completed successfully */
  enabledCurrenciesLoaded: boolean;
  refreshEnabledCurrencies: () => Promise<void>;
  /** Visual style used for crypto currency icons */
  cryptoIconStyle: CryptoIconStyle;
  setCryptoIconStyle: (style: CryptoIconStyle) => void;
  /** Exchange rates: 1 unit = X JPY. Always includes JPY: 1. */
  exchangeRates: ExchangeRates;
  /** Manually entered custom-currency rates: 1 unit of CODE = rate units of base */
  manualExchangeRateSpecs: ManualExchangeRateSpecs;
  /** Save or clear a manually entered custom-currency exchange rate */
  setManualExchangeRateSpec: (
    code: string,
    spec: ManualExchangeRateSpec | null,
  ) => void;
  /** Clear manually entered and cached exchange rates. */
  resetExchangeRates: () => void;
  /** Seconds until next exchange rate refresh is allowed */
  ratesCooldown: number;
  /** Convert an amount between currencies using current rates */
  convertCurrency: (amount: number, from: string, to: string) => number;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used within AppDataProvider");
  return ctx;
}

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const { t, locale } = useLang();
  const { pathname } = useLocation();
  const { privacyMode, maskAccountNames } = usePrivacy();
  const {
    prices,
    refresh: refreshCryptoPrices,
    forceRefresh: forceRefreshCryptoPrices,
    cooldownRemaining: pricesCooldown,
  } = useCryptoPrices();

  const {
    rates: exchangeRates,
    cooldownRemaining: ratesCooldown,
    convert: convertCurrency,
    forceRefresh: forceRefreshRates,
    manualRateSpecs: manualExchangeRateSpecs,
    setManualRateSpec: setManualExchangeRateSpec,
    resetStoredRates: resetExchangeRates,
    ensureRatesForCurrencies,
  } = useExchangeRates(prices);

  const initialOfflineCache = useRef(readOfflineAppCache()).current;
  const [accounts, setAccounts] = useState<Account[]>(
    initialOfflineCache?.accounts ?? [],
  );
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [pl, setPl] = useState<PLReport>({
    income: 0,
    expense: 0,
    net_income: 0,
  });
  const [cryptoWallets, setCryptoWallets] = useState<CryptoWallet[]>([]);
  const [cryptoBalances, setCryptoBalances] = useState<Map<number, number>>(
    new Map(),
  );
  const [exchangeCredentials, setExchangeCredentials] = useState<
    ExchangeCredential[]
  >([]);
  const [budgetCategories, setBudgetCategories] = useState<BudgetCategory[]>(
    initialOfflineCache?.budgetCategories ?? [],
  );
  const [budgetFilters, setBudgetFilters] = useState<BudgetFilter[]>(
    initialOfflineCache?.budgetFilters ?? [],
  );
  const [budgetSettings, setBudgetSettings] = useState<BudgetSettings | null>(
    initialOfflineCache?.budgetSettings ?? null,
  );
  const [creditCardSettings, setCreditCardSettings] = useState<
    CreditCardSettings[]
  >([]);
  const [creditCardState, setCreditCardState] = useState<
    CreditCardStateEntry[]
  >([]);
  const [creditCardStatementCompletions, setCreditCardStatementCompletions] =
    useState<CreditCardStatementCompletion[]>([]);
  const [latestTrialBalanceDate, setLatestTrialBalanceDate] = useState<
    string | null
  >(null);
  const [taskSettings, setTaskSettings] = useState<TaskSettings>({
    ...DEFAULT_TASK_SETTINGS,
    configured: false,
    updated_at: null,
  });
  const taskSettingsRef = useRef(taskSettings);
  const taskSettingsUpdateQueueRef = useRef<Promise<unknown>>(
    Promise.resolve(),
  );
  const taskSettingsUpdateVersionRef = useRef(0);
  useEffect(() => {
    taskSettingsRef.current = taskSettings;
  }, [taskSettings]);
  const [budgetSummary, setBudgetSummary] = useState<BudgetSummary | null>(
    initialOfflineCache?.todayBudget?.summary ?? null,
  );
  const [currentYearMonth, setCurrentYearMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [loading, setLoading] = useState(
    initialOfflineCache?.enabledCurrencies === undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const [displayCurrency, setDisplayCurrencyState] = useState<string>(() => {
    try {
      return localStorage.getItem("display_currency") ?? "";
    } catch {
      return "";
    }
  });
  const [enabledCurrencies, setEnabledCurrencies] = useState<EnabledCurrency[]>(
    initialOfflineCache?.enabledCurrencies ?? [],
  );
  const [enabledCurrenciesLoaded, setEnabledCurrenciesLoaded] = useState(
    initialOfflineCache?.enabledCurrencies !== undefined,
  );
  const isInitialSetupComplete =
    enabledCurrenciesLoaded && enabledCurrencies.length > 0;
  const [cryptoIconStyle, setCryptoIconStyleState] =
    useState<CryptoIconStyle>(getStoredCryptoIconStyle);

  const setCryptoIconStyle = useCallback((style: CryptoIconStyle) => {
    setCryptoIconStyleState(style);
    storeCryptoIconStyle(style);
  }, []);

  const ensureRatesForEnabledCurrencies = useCallback(() => {
    if (!enabledCurrenciesLoaded) return;
    void ensureRatesForCurrencies(enabledCurrencies.map((c) => c.code));
  }, [enabledCurrencies, enabledCurrenciesLoaded, ensureRatesForCurrencies]);

  const setDisplayCurrency = useCallback(
    (currency: string) => {
      setDisplayCurrencyState(currency);
      void ensureRatesForCurrencies([currency]);
      try {
        localStorage.setItem("display_currency", currency);
      } catch {}
    },
    [ensureRatesForCurrencies],
  );

  useEffect(() => {
    if (!isInitialSetupComplete) return;
    void ensureRatesForCurrencies([displayCurrency]);
  }, [displayCurrency, ensureRatesForCurrencies, isInitialSetupComplete]);

  useEffect(() => {
    ensureRatesForEnabledCurrencies();
  }, [ensureRatesForEnabledCurrencies]);

  const refreshEnabledCurrencies = useCallback(async () => {
    try {
      const rows = await api.currencies.list();
      setEnabledCurrencies(rows);
      setEnabledCurrenciesLoaded(true);
      updateOfflineAppCache({ enabledCurrencies: rows });
      // If the stored displayCurrency is no longer enabled, fall back to the first enabled currency
      const codes = new Set(rows.map((r) => r.code));
      setDisplayCurrencyState((prev) => {
        const next = codes.has(prev) ? prev : (rows[0]?.code ?? "");
        try {
          if (next) localStorage.setItem("display_currency", next);
          else localStorage.removeItem("display_currency");
        } catch {}
        return next;
      });
    } catch {
      const cached = readOfflineAppCache()?.enabledCurrencies;
      if (cached !== undefined) setEnabledCurrencies(cached);
      setEnabledCurrenciesLoaded(true);
    }
  }, []);

  // currentYearMonth ref to read inside stable callbacks
  const currentYearMonthRef = useRef(currentYearMonth);
  useEffect(() => {
    currentYearMonthRef.current = currentYearMonth;
  }, [currentYearMonth]);

  // Allocatable budget state (shared so TopNav and pages stay in sync)
  const [accountsToday, setAccountsToday] = useState<Account[]>([]);
  const [budgetSummaryToday, setBudgetSummaryToday] =
    useState<BudgetSummary | null>(null);
  const [budgetSummaryTotal, setBudgetSummaryTotal] =
    useState<BudgetSummary | null>(null);
  const displayCurrencyRef = useRef(normalizeCurrency(displayCurrency));
  const refreshAllocatableRequestRef = useRef<{
    key: string;
    promise: Promise<void>;
  } | null>(null);
  useEffect(() => {
    displayCurrencyRef.current = normalizeCurrency(displayCurrency);
  }, [displayCurrency]);

  const refreshAllocatable = useCallback(() => {
    const today = toDateStr(new Date());
    const currency = displayCurrencyRef.current;
    const ym = currentYearMonthRef.current;
    const key = `${ym}|${today}|${currency}`;
    if (refreshAllocatableRequestRef.current?.key === key) {
      return refreshAllocatableRequestRef.current.promise;
    }

    const pending = (async () => {
      try {
        const [accs, summaryToday, summaryTotal] = await Promise.all([
          api.accounts.list(today),
          api.budget.summary(ym, today, currency),
          api.budget.summary(ym, undefined, currency),
        ]);
        setAccountsToday(accs);
        setBudgetSummaryToday(summaryToday);
        setBudgetSummaryTotal(summaryTotal);
        if (ym === today.slice(0, 7)) {
          updateOfflineAppCache({
            accounts: accs,
            todayBudget: {
              asOf: today,
              capturedAt: new Date().toISOString(),
              summary: summaryToday,
            },
          });
        }
      } catch {
        // silently ignore
      }
    })().finally(() => {
      if (refreshAllocatableRequestRef.current?.promise === pending) {
        refreshAllocatableRequestRef.current = null;
      }
    });

    refreshAllocatableRequestRef.current = { key, promise: pending };
    return pending;
  }, []);

  const assetBalanceToday = useMemo(
    () =>
      sumAllocatableCashBalances(
        accountsToday,
        normalizeCurrency(displayCurrency),
      ),
    [accountsToday, displayCurrency],
  );

  const assetBalanceTotal = useMemo(
    () =>
      sumAllocatableCashBalances(accounts, normalizeCurrency(displayCurrency)),
    [accounts, displayCurrency],
  );

  const allocatableToday = useMemo(() => {
    return computeAllocatableBudget(
      assetBalanceToday,
      (budgetSummaryToday?.categories ?? []).map(
        (category) => category.available,
      ),
    );
  }, [assetBalanceToday, budgetSummaryToday]);

  const allocatableTotal = useMemo(() => {
    return computeAllocatableBudget(
      assetBalanceTotal,
      (budgetSummaryTotal?.categories ?? []).map(
        (category) => category.available,
      ),
    );
  }, [assetBalanceTotal, budgetSummaryTotal]);

  const loggedToday = useMemo(
    () =>
      sumBudgetClaims(
        (budgetSummaryToday?.categories ?? []).map(
          (category) => category.available,
        ),
      ),
    [budgetSummaryToday],
  );

  const loggedTotal = useMemo(
    () =>
      sumBudgetClaims(
        (budgetSummaryTotal?.categories ?? []).map(
          (category) => category.available,
        ),
      ),
    [budgetSummaryTotal],
  );

  // Guard: attempt seed exactly once per browser session
  const seedAttempted = useRef(false);

  // Stable ref so refreshCryptoBalances never needs cryptoWallets as a dep
  const cryptoWalletsRef = useRef<CryptoWallet[]>([]);
  useEffect(() => {
    cryptoWalletsRef.current = cryptoWallets;
  }, [cryptoWallets]);

  // Stable callback — no deps, reads current wallets via ref when none passed
  const refreshCryptoBalances = useCallback(
    async (wallets?: CryptoWallet[]) => {
      const targets = wallets ?? cryptoWalletsRef.current;
      if (targets.length === 0) return;
      try {
        const results = await Promise.all(
          targets.map((w) => api.crypto.balance(w.address, w.chain)),
        );
        const map = new Map<number, number>();
        for (let i = 0; i < targets.length; i++) {
          map.set(targets[i]!.account_id, results[i]!.amount);
        }
        setCryptoBalances(map);
      } catch {
        // silently ignore — balances remain from previous fetch
      }
    },
    [],
  ); // no state deps → stable reference

  const refreshBudgetFilters = useCallback(async () => {
    try {
      const filters = await api.budget.listFilters();
      setBudgetFilters(filters);
    } catch {
      // silently ignore
    }
  }, []);

  const refreshCreditCardSettings = useCallback(async () => {
    try {
      const settings = await api.creditCardSettings.list();
      setCreditCardSettings(settings);
    } catch {
      // silently ignore
    }
  }, []);

  const refreshCreditCardState = useCallback(async () => {
    try {
      const state = await api.trialBalance.getCreditCardState();
      setCreditCardState(state);
    } catch {
      // silently ignore
    }
  }, []);

  const refreshCreditCardStatementCompletions = useCallback(async () => {
    try {
      const completions = await api.creditCardStatements.listCompletions();
      setCreditCardStatementCompletions(completions);
    } catch {
      // silently ignore
    }
  }, []);

  const refreshLatestTrialBalanceDate = useCallback(async () => {
    try {
      const latest = await api.trialBalance.getLatestSnapshotDate();
      setLatestTrialBalanceDate(latest.snapshot_date);
    } catch {
      // silently ignore
    }
  }, []);

  const updateTaskSettings = useCallback(
    async (input: UpdateTaskSettingsInput) => {
      const previous = taskSettingsRef.current;
      const updateVersion = taskSettingsUpdateVersionRef.current + 1;
      taskSettingsUpdateVersionRef.current = updateVersion;
      const optimistic: TaskSettings = {
        ...previous,
        ...input,
        configured: true,
      };
      taskSettingsRef.current = optimistic;
      setTaskSettings(optimistic);
      const request = taskSettingsUpdateQueueRef.current.then(() =>
        api.taskSettings.update(input),
      );
      taskSettingsUpdateQueueRef.current = request.catch(() => undefined);
      try {
        const saved = await request;
        if (taskSettingsUpdateVersionRef.current === updateVersion) {
          taskSettingsRef.current = saved;
          setTaskSettings(saved);
        }
        return saved;
      } catch (error) {
        if (taskSettingsUpdateVersionRef.current === updateVersion) {
          taskSettingsRef.current = previous;
          setTaskSettings(previous);
        }
        throw error;
      }
    },
    [],
  );

  const refreshBudgetSettings = useCallback(async () => {
    try {
      const s = await api.budget.getSettings();
      setBudgetSettings(s);
    } catch {
      // silently ignore
    }
  }, []);

  const refreshBudget = useCallback(async () => {
    try {
      const ym = currentYearMonthRef.current;
      const currency = displayCurrencyRef.current;
      const [cats, summary, filters] = await Promise.all([
        api.budget.listCategories(),
        api.budget.summary(ym, undefined, currency),
        api.budget.listFilters(),
      ]);
      setBudgetCategories(cats);
      setBudgetSummary(summary);
      setBudgetFilters(filters);
      updateOfflineAppCache({
        budgetCategories: cats,
        budgetFilters: filters,
      });
    } catch {
      // silently ignore budget errors — non-critical
    }
  }, []); // stable — reads ym via ref

  // Re-fetch only the summary when month/currency changes. Categories and
  // filters are not month-specific and are refreshed by refreshBudget().
  useEffect(() => {
    if (!isInitialSetupComplete) return;
    if (!shouldRefreshMonthScopedData(pathname)) return;
    void api.budget
      .summary(
        currentYearMonthRef.current,
        undefined,
        displayCurrencyRef.current,
      )
      .then(setBudgetSummary)
      .catch(() => {});
  }, [currentYearMonth, displayCurrency, isInitialSetupComplete, pathname]);

  useEffect(() => {
    if (!isInitialSetupComplete) return;
    if (!shouldRefreshMonthScopedData(pathname)) return;
    void refreshAllocatable();
  }, [
    currentYearMonth,
    displayCurrency,
    refreshAllocatable,
    isInitialSetupComplete,
    pathname,
  ]);

  // Stable callback — only depends on t (locale string) and the stable refreshCryptoBalances
  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [
        accts,
        entries,
        plData,
        wallets,
        creds,
        cats,
        filters,
        ccSettings,
        ccState,
        ccStatementCompletions,
        bSettings,
        latestTrialBalance,
        serverTaskSettings,
      ] = await Promise.all([
        api.accounts.list(toDateStr(new Date())),
        api.journal.list(),
        api.reports.pl(),
        api.crypto.list(),
        api.exchangeCredentials.list(),
        api.budget.listCategories(),
        api.budget.listFilters(),
        api.creditCardSettings.list(),
        api.trialBalance.getCreditCardState(),
        api.creditCardStatements.listCompletions(),
        api.budget.getSettings(),
        api.trialBalance
          .getLatestSnapshotDate()
          .catch(() => ({ snapshot_date: null })),
        api.taskSettings.get(),
      ]);
      setAccounts(accts);
      setJournal(entries);
      setPl(plData);
      setCryptoWallets(wallets);
      setExchangeCredentials(creds);
      setBudgetCategories(cats);
      setBudgetFilters(filters);
      setCreditCardSettings(ccSettings);
      setCreditCardState(ccState);
      setCreditCardStatementCompletions(ccStatementCompletions);
      setBudgetSettings(bSettings);
      setLatestTrialBalanceDate(latestTrialBalance.snapshot_date);
      let resolvedTaskSettings = serverTaskSettings;
      try {
        resolvedTaskSettings = await migrateLegacyTaskSettingsIfNeeded(
          serverTaskSettings,
          localStorage,
          api.taskSettings.update,
        );
      } catch {
        // Keep server defaults and retry migration on the next full refresh.
      }
      taskSettingsRef.current = resolvedTaskSettings;
      setTaskSettings(resolvedTaskSettings);
      updateOfflineAppCache({
        accounts: accts,
        budgetCategories: cats,
        budgetFilters: filters,
        budgetSettings: bSettings,
      });
      void refreshCryptoBalances(wallets);
      void refreshAllocatable();
      // Also refresh budget summary
      try {
        const summary = await api.budget.summary(
          currentYearMonthRef.current,
          undefined,
          displayCurrencyRef.current,
        );
        setBudgetSummary(summary);
      } catch {
        // ignore
      }
    } catch (err) {
      const cached: OfflineAppCache | null = readOfflineAppCache();
      const isOfflineFailure =
        (typeof navigator !== "undefined" && navigator.onLine === false) ||
        (err instanceof ApiError && err.body.error === "network_offline");
      if (isOfflineFailure && cached?.enabledCurrencies !== undefined) {
        setAccounts(cached.accounts ?? []);
        setBudgetCategories(cached.budgetCategories ?? []);
        setBudgetFilters(cached.budgetFilters ?? []);
        setBudgetSettings(cached.budgetSettings ?? null);
        setBudgetSummary(cached.todayBudget?.summary ?? null);
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : t("failedToLoadData"));
      }
    } finally {
      setLoading(false);
    }
  }, [t, refreshCryptoBalances, refreshAllocatable]); // both stable → refresh is stable too

  // Load the setup gate first. Full app data is fetched only after setup is complete.
  useEffect(() => {
    void refreshEnabledCurrencies();
  }, [refreshEnabledCurrencies]);

  useEffect(() => {
    if (!enabledCurrenciesLoaded) return;
    if (!isInitialSetupComplete) {
      setLoading(false);
      setError(null);
      return;
    }
    void refresh();
  }, [enabledCurrenciesLoaded, isInitialSetupComplete, refresh]);

  // Seed default accounts on first ever load when the DB is empty
  useEffect(() => {
    if (loading) return;
    if (!isInitialSetupComplete) {
      seedAttempted.current = false;
      return;
    }
    if (seedAttempted.current) return;
    seedAttempted.current = true;
    if (accounts.length > 0) {
      localStorage.setItem("app:initialSeeded", "true");
      return;
    }
    if (localStorage.getItem("app:initialSeeded") === "true") return;
    localStorage.setItem("app:initialSeeded", "true");
    void api.admin
      .seed(locale)
      .then(() => void refresh())
      .catch(() => {});
  }, [
    loading,
    isInitialSetupComplete,
    accounts,
    locale,
    refresh,
  ]);

  const privateAccountNameMap = useMemo(() => {
    if (!privacyMode || !maskAccountNames) return new Map<number, string>();
    return buildPrivateAccountNameMap(accounts, (type) => {
      const labels = {
        asset: t("typeAsset"),
        liability: t("typeLiability"),
        equity: t("typeEquity"),
        income: t("typeIncome"),
        expense: t("typeExpense"),
      } satisfies Record<Account["type"], string>;
      return labels[type];
    });
  }, [accounts, privacyMode, maskAccountNames, t, locale]);

  const accountTypeLabel = useCallback(
    (type: Account["type"]) => {
      const labels = {
        asset: t("typeAsset"),
        liability: t("typeLiability"),
        equity: t("typeEquity"),
        income: t("typeIncome"),
        expense: t("typeExpense"),
      } satisfies Record<Account["type"], string>;
      return labels[type];
    },
    [t, locale],
  );

  const displayedAccounts = useMemo(
    () =>
      applyPrivateAccountNames(
        accounts,
        privacyMode,
        maskAccountNames,
        accountTypeLabel,
      ),
    [accounts, privacyMode, maskAccountNames, accountTypeLabel],
  );

  const displayedJournal = useMemo(() => {
    if (privateAccountNameMap.size === 0) return journal;
    return journal.map((entry) => ({
      ...entry,
      lines: entry.lines.map((line) => ({
        ...line,
        account_name:
          privateAccountNameMap.get(line.account_id) ?? line.account_name,
      })),
    }));
  }, [journal, privateAccountNameMap]);

  const displayedCryptoWallets = useMemo(() => {
    if (privateAccountNameMap.size === 0) return cryptoWallets;
    return cryptoWallets.map((wallet) => ({
      ...wallet,
      account_name:
        privateAccountNameMap.get(wallet.account_id) ?? wallet.account_name,
    }));
  }, [cryptoWallets, privateAccountNameMap]);

  return (
    <AppDataContext.Provider
      value={{
        accounts: displayedAccounts,
        journal: displayedJournal,
        pl,
        cryptoWallets: displayedCryptoWallets,
        exchangeCredentials,
        cryptoBalances,
        prices,
        budgetCategories,
        budgetFilters,
        budgetSummary,
        budgetSettings,
        creditCardSettings,
        creditCardState,
        creditCardStatementCompletions,
        latestTrialBalanceDate,
        taskSettings,
        currentYearMonth,
        setCurrentYearMonth,
        loading,
        error,
        refresh,
        refreshCryptoBalances,
        refreshCryptoPrices,
        forceRefreshCryptoPrices,
        forceRefreshRates,
        pricesCooldown,
        refreshBudget,
        refreshBudgetFilters,
        refreshCreditCardSettings,
        refreshCreditCardState,
        refreshCreditCardStatementCompletions,
        refreshLatestTrialBalanceDate,
        updateTaskSettings,
        refreshBudgetSettings,
        refreshAllocatable,
        allocatableToday,
        allocatableTotal,
        assetBalanceToday,
        assetBalanceTotal,
        loggedToday,
        loggedTotal,
        displayCurrency,
        displayCurrencySymbol: getEffectiveSymbol(
          displayCurrency,
          enabledCurrencies,
        ),
        setDisplayCurrency,
        enabledCurrencies,
        enabledCurrenciesLoaded,
        refreshEnabledCurrencies,
        cryptoIconStyle,
        setCryptoIconStyle,
        exchangeRates,
        manualExchangeRateSpecs,
        setManualExchangeRateSpec,
        resetExchangeRates,
        ratesCooldown,
        convertCurrency,
      }}
    >
      {children}
    </AppDataContext.Provider>
  );
}
