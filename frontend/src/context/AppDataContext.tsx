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
  CryptoPrices,
  CryptoWallet,
  EnabledCurrency,
  ExchangeCredential,
  ExchangeRates,
  JournalEntry,
  PLReport,
} from "@balance-sheet/shared";
import { api } from "../api/client";
import { useLang } from "../i18n";
import { useCryptoPrices } from "../hooks/useCryptoPrices";
import { useExchangeRates } from "../hooks/useExchangeRates";
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
  cryptoValueMap: Map<number, number>;
  prices: CryptoPrices | null;
  budgetCategories: BudgetCategory[];
  budgetFilters: BudgetFilter[];
  budgetSummary: BudgetSummary | null;
  budgetSettings: BudgetSettings | null;
  creditCardSettings: CreditCardSettings[];
  creditCardState: CreditCardStateEntry[];
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
  /** Manually entered rates: 1 unit = X JPY. */
  manualExchangeRates: ExchangeRates;
  /** Save or clear a manually entered exchange rate. */
  setManualExchangeRate: (code: string, rate: number | null) => void;
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
  const { t, locale, hasExplicitLocale } = useLang();
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
    manualRates: manualExchangeRates,
    setManualRate: setManualExchangeRate,
  } = useExchangeRates(prices);

  const [accounts, setAccounts] = useState<Account[]>([]);
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
    [],
  );
  const [budgetFilters, setBudgetFilters] = useState<BudgetFilter[]>([]);
  const [budgetSettings, setBudgetSettings] = useState<BudgetSettings | null>(
    null,
  );
  const [creditCardSettings, setCreditCardSettings] = useState<
    CreditCardSettings[]
  >([]);
  const [creditCardState, setCreditCardState] = useState<
    CreditCardStateEntry[]
  >([]);
  const [budgetSummary, setBudgetSummary] = useState<BudgetSummary | null>(
    null,
  );
  const [currentYearMonth, setCurrentYearMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [displayCurrency, setDisplayCurrencyState] = useState<string>(() => {
    try {
      return localStorage.getItem("display_currency") ?? "";
    } catch {
      return "";
    }
  });
  const [enabledCurrencies, setEnabledCurrencies] = useState<EnabledCurrency[]>(
    [],
  );
  const [enabledCurrenciesLoaded, setEnabledCurrenciesLoaded] = useState(false);
  const isInitialSetupComplete =
    hasExplicitLocale && enabledCurrenciesLoaded && enabledCurrencies.length > 0;
  const [cryptoIconStyle, setCryptoIconStyleState] =
    useState<CryptoIconStyle>(getStoredCryptoIconStyle);

  const setCryptoIconStyle = useCallback((style: CryptoIconStyle) => {
    setCryptoIconStyleState(style);
    storeCryptoIconStyle(style);
  }, []);

  const ensureRateForCurrency = useCallback(
    (currency: string) => {
      if (!currency || currency === "JPY") return;
      if ((exchangeRates[currency] ?? 0) > 0) return;
      void forceRefreshRates();
    },
    [exchangeRates, forceRefreshRates],
  );

  const setDisplayCurrency = useCallback(
    (currency: string) => {
      setDisplayCurrencyState(currency);
      ensureRateForCurrency(currency);
      try {
        localStorage.setItem("display_currency", currency);
      } catch {}
    },
    [ensureRateForCurrency],
  );

  useEffect(() => {
    if (!isInitialSetupComplete) return;
    ensureRateForCurrency(displayCurrency);
  }, [displayCurrency, ensureRateForCurrency, isInitialSetupComplete]);

  const refreshEnabledCurrencies = useCallback(async () => {
    try {
      const rows = await api.currencies.list();
      setEnabledCurrencies(rows);
      setEnabledCurrenciesLoaded(true);
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
      // silently ignore
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
  useEffect(() => {
    displayCurrencyRef.current = normalizeCurrency(displayCurrency);
  }, [displayCurrency]);

  const refreshAllocatable = useCallback(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const currency = displayCurrencyRef.current;
      const ym = currentYearMonthRef.current;
      const [accs, summaryToday, summaryTotal] = await Promise.all([
        api.accounts.list(today),
        api.budget.summary(ym, today, currency),
        api.budget.summary(ym, undefined, currency),
      ]);
      setAccountsToday(accs);
      setBudgetSummaryToday(summaryToday);
      setBudgetSummaryTotal(summaryTotal);
    } catch {
      // silently ignore
    }
  }, []);

  useEffect(() => {
    if (!isInitialSetupComplete) return;
    void refreshAllocatable();
  }, [refreshAllocatable, isInitialSetupComplete]);

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
    } catch {
      // silently ignore budget errors — non-critical
    }
  }, []); // stable — reads ym via ref

  // Re-fetch budget summary when currentYearMonth changes
  useEffect(() => {
    if (!isInitialSetupComplete) return;
    void refreshBudget();
  }, [currentYearMonth, displayCurrency, refreshBudget, isInitialSetupComplete]);

  useEffect(() => {
    if (!isInitialSetupComplete) return;
    void refreshAllocatable();
  }, [
    currentYearMonth,
    displayCurrency,
    refreshAllocatable,
    isInitialSetupComplete,
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
        bSettings,
      ] = await Promise.all([
        api.accounts.list(),
        api.journal.list(),
        api.reports.pl(),
        api.crypto.list(),
        api.exchangeCredentials.list(),
        api.budget.listCategories(),
        api.budget.listFilters(),
        api.creditCardSettings.list(),
        api.trialBalance.getCreditCardState(),
        api.budget.getSettings(),
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
      setBudgetSettings(bSettings);
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
      setError(err instanceof Error ? err.message : t("failedToLoadData"));
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
    if (!isInitialSetupComplete) return;
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

  const cryptoValueMap = useMemo(() => {
    if (!prices) return new Map<number, number>();
    const map = new Map<number, number>();
    for (const w of cryptoWallets) {
      const amount = cryptoBalances.get(w.account_id) ?? 0;
      let price = 0;
      if (w.chain === "eth") price = prices.ethereum;
      else if (w.chain === "btc") price = prices.bitcoin;
      else if (w.chain === "sol") price = prices.solana;
      else if (w.chain === "msol")
        price = prices.solana; // mSOL amount already SOL-equivalent from API
      else if (w.chain === "sol_stake")
        price = prices.solana; // native stake in SOL
      else if (w.chain === "skr") price = prices.skr ?? 0;
      else if (w.chain === "binance")
        price = prices.byTicker[w.address.toUpperCase()] ?? 0;
      map.set(w.account_id, amount * price);
    }
    return map;
  }, [cryptoWallets, cryptoBalances, prices]);

  return (
    <AppDataContext.Provider
      value={{
        accounts,
        journal,
        pl,
        cryptoWallets,
        exchangeCredentials,
        cryptoBalances,
        cryptoValueMap,
        prices,
        budgetCategories,
        budgetFilters,
        budgetSummary,
        budgetSettings,
        creditCardSettings,
        creditCardState,
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
        manualExchangeRates,
        setManualExchangeRate,
        ratesCooldown,
        convertCurrency,
      }}
    >
      {children}
    </AppDataContext.Provider>
  );
}
