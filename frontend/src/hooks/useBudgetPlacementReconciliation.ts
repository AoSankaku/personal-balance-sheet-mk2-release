import { useCallback, useEffect, useRef, useState } from "react";
import type { BudgetPlacementReconciliation } from "@balance-sheet/shared";
import { api } from "../api/client";
import { getPlacementPreviewDay } from "../api/placementPreviewScope";
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
  const day = getPlacementPreviewDay();
  const initialPlan = api.incomeTransferRequirements.cachedPlacementPreview(currency);
  const [plan, setPlan] = useState<BudgetPlacementReconciliation | null>(initialPlan);
  const [loading, setLoading] = useState(initialPlan === null);
  const [error, setError] = useState<Error | null>(null);
  const requestGeneration = useRef(0);

  const load = useCallback(async (force = false) => {
    const generation = ++requestGeneration.current;
    const cached = !force && api.incomeTransferRequirements.cachedPlacementPreview(currency);
    if (cached) {
      setPlan(cached);
      setLoading(false);
      setError(null);
      return cached;
    }
    setLoading(true);
    setError(null);
    setPlan(null);
    try {
      const result = await api.incomeTransferRequirements.placementPreview(currency, { force });
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
  }, [currency, day]);
  const refresh = useCallback(() => load(true), [load]);

  useEffect(() => {
    void load().catch(() => undefined);
    return () => { requestGeneration.current += 1; };
    // Category targets, manual allocations, and currency precision can change
    // without creating a journal entry or refreshing today's summary.
  }, [accountsToday, budgetCategories, budgetSummary, budgetSummaryToday, currency, enabledCurrencies, journal, load]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load().catch(() => undefined);
    };
    const onFocus = () => { void load().catch(() => undefined); };
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const matchesScope = plan === null || (plan.currency.toUpperCase() === currency && plan.as_of === day);
  return { plan: matchesScope ? plan : null, loading: loading || !matchesScope, error, refresh };
}
