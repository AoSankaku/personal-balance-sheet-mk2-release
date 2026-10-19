import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { DepreciationSchedule } from "@balance-sheet/shared";
import { api } from "../api/client";
import { DepreciationBudgetRepairModal } from "../components/DepreciationBudgetRepairModal";
import { useAppData } from "./AppDataContext";
import { usePrivacy } from "./PrivacyContext";
import { useLang } from "../i18n";

interface DepreciationBudgetContextValue {
  schedules: DepreciationSchedule[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  openRepair: (scheduleId: number) => void;
}

const DepreciationBudgetContext =
  createContext<DepreciationBudgetContextValue | null>(null);

export function DepreciationBudgetProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { t } = useLang();
  const { privacyMode } = usePrivacy();
  const {
    journal,
    budgetCategories,
    budgetSummary,
    loading: appDataLoading,
    enabledCurrencies,
    enabledCurrenciesLoaded,
    refresh: refreshAppData,
    refreshBudget,
  } = useAppData();
  const [loadedSchedules, setLoadedSchedules] = useState<
    DepreciationSchedule[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(
    null,
  );
  const requestVersionRef = useRef(0);
  const suppressAutomaticRefreshRef = useRef(false);
  const privacyModeRef = useRef(privacyMode);
  privacyModeRef.current = privacyMode;
  const canLoad = enabledCurrenciesLoaded && enabledCurrencies.length > 0;

  const refresh = useCallback(async () => {
    const requestVersion = ++requestVersionRef.current;
    if (privacyModeRef.current || !canLoad) {
      setLoadedSchedules([]);
      setHasLoaded(false);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const schedules = await api.depreciation.list();
      if (requestVersion !== requestVersionRef.current) return;
      setLoadedSchedules(schedules);
      setHasLoaded(true);
    } catch {
      if (requestVersion !== requestVersionRef.current) return;
      setError(t("depreciationBudgetSchedulesLoadError"));
      setHasLoaded(true);
    } finally {
      if (requestVersion === requestVersionRef.current) setLoading(false);
    }
  }, [canLoad, t]);

  useEffect(() => {
    if (privacyMode) {
      requestVersionRef.current += 1;
      setLoadedSchedules([]);
      setHasLoaded(false);
      setSelectedScheduleId(null);
      setError(null);
      setLoading(false);
      return;
    }
    if (canLoad && !appDataLoading && !suppressAutomaticRefreshRef.current) {
      void refresh();
    }
    return () => {
      requestVersionRef.current += 1;
    };
  }, [
    canLoad,
    privacyMode,
    appDataLoading,
    journal,
    budgetCategories,
    budgetSummary,
    refresh,
  ]);

  const openRepair = useCallback(
    (scheduleId: number) => {
      if (privacyModeRef.current) return;
      const schedule = loadedSchedules.find(({ id }) => id === scheduleId);
      if (schedule) setSelectedScheduleId(schedule.id);
    },
    [loadedSchedules],
  );

  useEffect(() => {
    if (
      selectedScheduleId != null &&
      !loadedSchedules.some(({ id }) => id === selectedScheduleId)
    ) {
      setSelectedScheduleId(null);
    }
  }, [loadedSchedules, selectedScheduleId]);

  const handleApplied = useCallback(async () => {
    if (privacyModeRef.current) return;
    suppressAutomaticRefreshRef.current = true;
    try {
      await Promise.all([refreshAppData(), refreshBudget()]);
    } finally {
      suppressAutomaticRefreshRef.current = false;
    }
    if (privacyModeRef.current) return;
    await refresh();
  }, [refresh, refreshAppData, refreshBudget]);

  const selectedSchedule = privacyMode
    ? null
    : (loadedSchedules.find(({ id }) => id === selectedScheduleId) ?? null);

  const value = useMemo(
    () => ({
      schedules: privacyMode ? [] : loadedSchedules,
      loading:
        privacyMode
          ? false
          : loading || (canLoad && !appDataLoading && !hasLoaded),
      error: privacyMode ? null : error,
      refresh,
      openRepair,
    }),
    [
      privacyMode,
      loadedSchedules,
      loading,
      canLoad,
      appDataLoading,
      hasLoaded,
      error,
      refresh,
      openRepair,
    ],
  );

  return (
    <DepreciationBudgetContext.Provider value={value}>
      {children}
      {!privacyMode && selectedSchedule && (
        <DepreciationBudgetRepairModal
          opened
          schedule={selectedSchedule}
          onClose={() => setSelectedScheduleId(null)}
          onApplied={handleApplied}
        />
      )}
    </DepreciationBudgetContext.Provider>
  );
}

export function useDepreciationBudget() {
  const context = useContext(DepreciationBudgetContext);
  if (!context) {
    throw new Error(
      "useDepreciationBudget must be used inside DepreciationBudgetProvider",
    );
  }
  return context;
}
