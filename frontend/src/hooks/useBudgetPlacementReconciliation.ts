import { useCallback, useEffect, useRef, useState } from "react";
import type { BudgetPlacementReconciliation } from "@balance-sheet/shared";
import { api } from "../api/client";
import { useAppData } from "../context/AppDataContext";

export function useBudgetPlacementReconciliation() {
  const {
    accountsToday,
    budgetCategories,
    budgetSummary,
    budgetSummaryToday,
    enabledCurrencies,
    journal,
    displayCurrency,
  } = useAppData();
  const currency = (displayCurrency || "JPY").toUpperCase();
  const [plan, setPlan] = useState<BudgetPlacementReconciliation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const requestGeneration = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setError(null);
    setPlan(null);
    try {
      const result = await api.incomeTransferRequirements.placementPreview(currency);
      if (generation === requestGeneration.current) setPlan(result);
      return result;
    } catch (cause) {
      const nextError = cause instanceof Error ? cause : new Error(String(cause));
      if (generation === requestGeneration.current) {
        setPlan(null);
        setError(nextError);
      }
      throw nextError;
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [currency]);

  useEffect(() => {
    void refresh().catch(() => undefined);
    return () => { requestGeneration.current += 1; };
    // Category targets, manual allocations, and currency precision can change
    // without creating a journal entry or refreshing today's summary.
  }, [accountsToday, budgetCategories, budgetSummary, budgetSummaryToday, currency, enabledCurrencies, journal, refresh]);

  return { plan, loading, error, refresh };
}
