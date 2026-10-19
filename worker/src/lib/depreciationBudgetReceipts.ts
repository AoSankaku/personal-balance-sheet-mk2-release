import type { DepreciationBudgetSettings } from "../../../shared/depreciationBudget";
import { resolveDepreciationMonthlySourceAllocations } from "../../../shared/depreciationBudgetAllocation";
import type { depreciationSchedules } from "../db/schema";

type BudgetReceiptRow = {
  budget_category_id: number;
  amount: number;
  date: string;
  currency: string;
  created_at?: string | null;
  depreciation_event_key: string | null;
  depreciation_event_side: "source" | "destination" | null;
};

type ReceiptSchedule = Pick<typeof depreciationSchedules.$inferSelect,
  "id" | "months" | "start_date" | "budget_special_category_id" | "budget_currency">;

function routeAt(settings: DepreciationBudgetSettings, date: string, schedule: ReceiptSchedule) {
  const change = [...(settings.routing_changes ?? [])]
    .sort((left, right) => left.date.localeCompare(right.date))
    .filter((row) => row.date <= date)
    .at(-1);
  const allocationSource: Pick<DepreciationBudgetSettings,
    "monthly_source_allocations" | "monthly_source_category_id"> = change?.monthly_source_allocations !== undefined
    ? change
    : change?.monthly_source_category_id != null
      ? { monthly_source_category_id: change.monthly_source_category_id }
      : settings;
  const sourceAllocations = resolveDepreciationMonthlySourceAllocations(allocationSource);
  return {
    sourceAllocations,
    explicitAllocations: allocationSource.monthly_source_allocations !== undefined,
    destination: change?.destination_category_id ??
      (settings.method === "special"
        ? schedule.budget_special_category_id ?? -schedule.id
        : settings.purchase_category_id ?? null),
  };
}

/** Validate persisted monthly receipts against the saved source and route plan. */
export function getDepreciationBudgetReceiptGroups(
  rows: readonly BudgetReceiptRow[],
  settings: DepreciationBudgetSettings,
  schedule: ReceiptSchedule,
): Map<string, { key: string; amount: number; date: string; created_at: string }> {
  const groups = new Map<string, BudgetReceiptRow[]>();
  for (const row of rows) {
    const key = row.depreciation_event_key ?? "";
    if (!key.startsWith("monthly:") && !key.startsWith("settlement:")) continue;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const valid = new Map<string, { key: string; amount: number; date: string; created_at: string }>();
  for (const [key, events] of groups) {
    const sources = events.filter((row) => row.depreciation_event_side === "source");
    const destinations = events.filter((row) => row.depreciation_event_side === "destination");
    if (key.startsWith("monthly:")) {
      const legacy = /^monthly:(\d+)$/.exec(key);
      const category = /^monthly:(\d+):category:(\d+)$/.exec(key);
      const unallocated = /^monthly:(\d+):unallocated$/.exec(key);
      const monthNumber = Number(legacy?.[1] ?? category?.[1] ?? unallocated?.[1]);
      if ((!legacy && !category && !unallocated) || !Number.isSafeInteger(monthNumber) ||
        monthNumber < 1 || monthNumber > schedule.months || events.length === 0) continue;
      const eventDate = events[0]!.date;
      // Accounting entries can be date-edited after creation. The event key and
      // saved routing snapshot identify its month; require a valid, shared date
      // without pinning it to the schedule's original planned date.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) ||
        events.some((row) => row.date !== eventDate || row.currency !== (schedule.budget_currency || "JPY"))) continue;
      const route = routeAt(settings, eventDate, schedule);
      const destinationId = route.destination;
      if (destinationId == null || destinations.length !== 1 || destinations[0]!.budget_category_id !== destinationId ||
        destinations[0]!.amount <= 0) continue;
      if (legacy) {
        const sourceId = route.sourceAllocations.length === 1 ? route.sourceAllocations[0]!.budget_category_id : null;
        if (route.explicitAllocations || sourceId == null || sources.length !== 1 ||
          sources[0]!.budget_category_id !== sourceId || sources[0]!.amount !== -destinations[0]!.amount) continue;
      } else if (category) {
        const sourceId = Number(category[2]);
        if (!route.explicitAllocations || !route.sourceAllocations.some((allocation) =>
          allocation.budget_category_id === sourceId && allocation.ratio > 0,
        ) || sources.length !== 1 || sources[0]!.budget_category_id !== sourceId ||
          sources[0]!.amount !== -destinations[0]!.amount) continue;
      } else {
        if (!route.explicitAllocations || settings.confirm_monthly_unallocated !== true ||
          !route.sourceAllocations.some((allocation) => allocation.budget_category_id == null && allocation.ratio > 0) ||
          sources.length !== 0) continue;
      }
      valid.set(key, {
        key,
        amount: destinations[0]!.amount,
        date: eventDate,
        created_at: destinations[0]!.created_at ?? "",
      });
      continue;
    }
    if (sources.length === 1 && destinations.length === 1) {
      const source = sources[0]!;
      const destination = destinations[0]!;
      if (
        source.amount < 0 &&
        destination.amount > 0 &&
        source.amount === -destination.amount &&
        source.currency === destination.currency &&
        source.date === destination.date
      ) {
        valid.set(key, { key, amount: destination.amount, date: destination.date, created_at: destination.created_at ?? "" });
      }
      continue;
    }
    if (key.startsWith("settlement:")) {
      const settlementKey = key.slice("settlement:".length);
      const expected = settings.settlements?.find((row) => row.key === settlementKey);
      const resetDecision = /^reset:\d+$/.test(settlementKey) &&
        settings.reset_decisions?.some((decision) =>
          decision.action === "settle" && settlementKey === `reset:${decision.reset_log_id}`,
        );
      if (
        ((expected && expected.source_category_id == null) || resetDecision) &&
        sources.length === 0 &&
        destinations.length === 1 &&
        destinations[0]!.amount > 0 &&
        (!expected || destinations[0]!.date === expected.date)
      ) {
        valid.set(key, { key, amount: destinations[0]!.amount, date: destinations[0]!.date, created_at: destinations[0]!.created_at ?? "" });
      }
    }
  }
  return valid;
}
