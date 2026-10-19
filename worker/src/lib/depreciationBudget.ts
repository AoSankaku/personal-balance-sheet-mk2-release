import { and, eq, inArray } from "drizzle-orm";
import { budgetAccountDelta } from "../../../shared/budgetScope";
import type {
  DepreciationBudgetEvent,
  DepreciationBudgetMethod,
  DepreciationBudgetPreview,
  DepreciationBudgetSettlement,
  DepreciationBudgetProgress,
  DepreciationBudgetSettings,
} from "../../../shared/depreciationBudget";
import {
  resolveDepreciationMonthlySourceAllocations,
  splitDepreciationMonthlySourceAllocations,
  validateDepreciationMonthlySourceAllocations,
} from "../../../shared/depreciationBudgetAllocation";
import { createDb } from "../db";
import {
  accounts,
  budgetAdjustmentLogs,
  budgetCategories,
  depreciationBudgetRevisions,
  depreciationEntries,
  depreciationSchedules,
  enabledCurrencies,
  journalEntries,
  journalEntryBudgetAllocations,
  journalLines,
} from "../db/schema";
import { splitAmountByLargestRemainder } from "./budgetFundingImpact";
import { loadCurrencyDecimalPlaces } from "./currencyPrecision";
import { toLocalDateString } from "./appDate";
import { chunkForD1InClause } from "./d1Query";
import { computeBudgetSummaryForDate } from "../routes/budget";
import { getDepreciationBudgetReceiptGroups } from "./depreciationBudgetReceipts";
import {
  fromStorageMoneyAmount,
  toStorageMoneyAmount,
  type MoneyScaleOptions,
} from "./moneyValidation";

export type DepreciationDb = ReturnType<typeof createDb>;
export type DepreciationScheduleRow = typeof depreciationSchedules.$inferSelect;

export interface OwnedDepreciationBudgetLog {
  budget_category_id: number;
  year_month: string;
  amount: number;
  currency: string;
  date: string;
  adjustment_type: string;
  journal_entry_id: number | null;
  depreciation_schedule_id: number;
  depreciation_event_key: string;
  depreciation_event_side: "source" | "destination";
  created_at?: string;
  /** Null marks the schedule's auto-created special category. */
  special_category?: boolean;
}

export interface DepreciationBudgetMonthInput {
  journal_entry_id: number | null;
  month_number: number;
  date: string;
  created_at: string;
  amount: number;
}

export interface BuildOwnedDepreciationBudgetRowsOptions {
  months?: DepreciationBudgetMonthInput[];
  purchaseCreatedAt?: string;
}

export const UNALLOCATED_WARNING =
  "未割当方式では、購入額の予算対象分を購入時にまとめて負担します。費用の月次計上は続きますが、毎月の予算分割振替は行いません。費用を毎月の予算にも反映するには、割当済み予算方式または特別予算方式を選択してください。";

function daysInMonth(date: string): number {
  const [year, month] = date.split("-").map(Number) as [number, number];
  return new Date(year, month, 0).getDate();
}

function shiftStableTimestamp(value: string, milliseconds: number): string {
  const instant = new Date(`${value.replace(" ", "T")}Z`).getTime();
  return Number.isFinite(instant + milliseconds)
    ? new Date(instant + milliseconds).toISOString().replace("T", " ").replace("Z", "").slice(0, 23)
    : value;
}

export function normalizeDepreciationBudgetSettings(
  settings: DepreciationBudgetSettings,
): DepreciationBudgetSettings {
  const monthlyAllocations = settings.monthly_source_allocations;
  const normalizedMonthlyAllocations = Array.isArray(monthlyAllocations) &&
      monthlyAllocations.every((allocation) => allocation && typeof allocation === "object" && !Array.isArray(allocation))
    ? resolveDepreciationMonthlySourceAllocations(settings)
    : monthlyAllocations;
  return {
    method: settings.method,
    purchase_category_id: settings.purchase_category_id ?? null,
    monthly_source_category_id: settings.monthly_source_category_id ?? null,
    ...(monthlyAllocations === undefined ? {} : { monthly_source_allocations: normalizedMonthlyAllocations }),
    ...(settings.confirm_monthly_unallocated === undefined
      ? {}
      : { confirm_monthly_unallocated: settings.confirm_monthly_unallocated }),
    ...(settings.confirm_unallocated === undefined
      ? {}
      : { confirm_unallocated: settings.confirm_unallocated }),
    reset_decisions: [...(settings.reset_decisions ?? [])].sort(
      (left, right) => left.reset_log_id - right.reset_log_id,
    ).map((decision) => ({
      ...decision,
      ...(decision.scope ? { scope: decision.scope } : {}),
    })),
    routing_changes: [...(settings.routing_changes ?? [])].sort((left, right) =>
      left.date.localeCompare(right.date),
    ).map((route) => {
      if (route.monthly_source_allocations === undefined) return route;
      const allocations = Array.isArray(route.monthly_source_allocations) &&
          route.monthly_source_allocations.every((allocation) => allocation && typeof allocation === "object" && !Array.isArray(allocation))
        ? resolveDepreciationMonthlySourceAllocations(route)
        : route.monthly_source_allocations;
      return { ...route, monthly_source_allocations: allocations };
    }),
    settlements: [...(settings.settlements ?? [])].sort((left, right) =>
      left.date.localeCompare(right.date) || left.key.localeCompare(right.key),
    ),
    end_date: settings.end_date ?? null,
  };
}

export function validateDepreciationBudgetSettings(
  settings: DepreciationBudgetSettings,
): string | null {
  if (!settings || !["assigned", "special", "unallocated"].includes(settings.method)) {
    return "invalid_budget_method";
  }
  const purchase = settings.purchase_category_id ?? null;
  const source = settings.monthly_source_category_id ?? null;
  const validCategoryId = (id: unknown) => id == null || (Number.isSafeInteger(id) && (id as number) > 0);
  const hasExplicitAllocations = settings.monthly_source_allocations !== undefined;
  if (!validCategoryId(purchase) || (!hasExplicitAllocations && !validCategoryId(source))) return "invalid_budget_category_id";
  if (settings.confirm_monthly_unallocated !== undefined && typeof settings.confirm_monthly_unallocated !== "boolean") {
    return "invalid_monthly_unallocated_confirmation";
  }
  if (hasExplicitAllocations) {
    const allocationError = validateDepreciationMonthlySourceAllocations(settings.monthly_source_allocations);
    if (allocationError) return allocationError;
  }
  const sourceAllocations = resolveDepreciationMonthlySourceAllocations(settings);
  const hasPositiveUnallocated = (allocations: readonly unknown[]) => allocations.some((allocation) =>
    !!allocation && typeof allocation === "object" && !Array.isArray(allocation) &&
    (allocation as Partial<{ budget_category_id: number | null; ratio: number }>).budget_category_id == null &&
    typeof (allocation as Partial<{ ratio: number }>).ratio === "number" &&
    (allocation as Partial<{ ratio: number }>).ratio! > 0,
  );
  const usesUnallocated = hasPositiveUnallocated(sourceAllocations) ||
    (settings.routing_changes ?? []).some((route) =>
      hasPositiveUnallocated(resolveDepreciationMonthlySourceAllocations(
        route.monthly_source_allocations !== undefined || route.monthly_source_category_id != null
          ? route
          : settings,
      )),
    );
  if (settings.method !== "unallocated" && usesUnallocated && settings.confirm_monthly_unallocated !== true) {
    return "monthly_unallocated_confirmation_required";
  }
  if (settings.method === "assigned" && purchase == null) {
    return "purchase_category_required";
  }
  if ((settings.method === "assigned" || settings.method === "special") && !hasExplicitAllocations && source == null) {
    return "monthly_source_category_required";
  }
  if (settings.method === "assigned" && sourceAllocations.some((allocation) =>
    allocation.ratio > 0 && allocation.budget_category_id === purchase,
  )) {
    return "source_and_destination_must_differ";
  }
  if (settings.method === "unallocated" && settings.confirm_unallocated !== true) {
    return "unallocated_confirmation_required";
  }
  for (const route of settings.routing_changes ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(route.date)) {
      return "invalid_routing_change";
    }
    if ((route.monthly_source_allocations === undefined && !validCategoryId(route.monthly_source_category_id)) ||
      !validCategoryId(route.destination_category_id) ||
      route.destination_category_id == null) return "invalid_routing_change";
    if (route.monthly_source_allocations !== undefined) {
      const allocationError = validateDepreciationMonthlySourceAllocations(route.monthly_source_allocations);
      if (allocationError) return allocationError;
    }
    const routeAllocations = resolveDepreciationMonthlySourceAllocations(
      route.monthly_source_allocations !== undefined || route.monthly_source_category_id != null
        ? route
        : settings,
    );
    if (routeAllocations.some((allocation) =>
      allocation.ratio > 0 && allocation.budget_category_id === route.destination_category_id,
    )) {
      return "source_and_destination_must_differ";
    }
  }
  for (const settlement of settings.settlements ?? []) {
    if (!settlement.key || !/^\d{4}-\d{2}-\d{2}$/.test(settlement.date) ||
      !Number.isFinite(settlement.amount) || settlement.amount <= 0 || !validCategoryId(settlement.source_category_id)) {
      return "invalid_settlement";
    }
  }
  if ((settings.reset_decisions ?? []).some((decision) => !Number.isSafeInteger(decision.reset_log_id) || decision.reset_log_id <= 0)) {
    return "invalid_reset_decision";
  }
  if (new Set((settings.settlements ?? []).map((settlement) => settlement.key)).size !== (settings.settlements ?? []).length) {
    return "duplicate_settlement_key";
  }
  if (new Set((settings.reset_decisions ?? []).map((decision) => decision.reset_log_id)).size !== (settings.reset_decisions ?? []).length) {
    return "duplicate_reset_decision";
  }
  return null;
}

export async function getBudgetScaleOptions(db: DepreciationDb): Promise<MoneyScaleOptions> {
  return { decimalPlacesByCurrency: await loadCurrencyDecimalPlaces(db) };
}

export async function getDepreciationBudgetRevision(DB: D1Database): Promise<number> {
  const result = await DB.prepare(
    "SELECT revision FROM depreciation_budget_state WHERE id=1",
  ).first<{ revision: number }>();
  return result?.revision ?? 0;
}

export function buildDepreciationBudgetRevisionGuard(
  DB: D1Database,
  expectedRevision: number,
): D1PreparedStatement[] {
  return [
    DB.prepare("DELETE FROM depreciation_budget_apply_guard WHERE id=1"),
    DB.prepare(
      "INSERT INTO depreciation_budget_apply_guard(id,expected_revision) VALUES(1,?)",
    ).bind(expectedRevision),
  ];
}

export async function getDepreciationPurchaseTarget(
  db: DepreciationDb,
  schedule: DepreciationScheduleRow,
  currency = schedule.budget_currency || "JPY",
): Promise<number> {
  const lines = await db
    .select({
      account_id: journalLines.account_id,
      debit: journalLines.debit,
      credit: journalLines.credit,
      currency: journalLines.currency,
    })
    .from(journalLines)
    .where(eq(journalLines.journal_entry_id, schedule.source_journal_entry_id));
  const accountIds = [...new Set(lines.map((line) => line.account_id))];
  const accountRows = accountIds.length
    ? await db.select().from(accounts).where(inArray(accounts.id, accountIds))
    : [];
  return Math.min(
    Math.max(0, -budgetAccountDelta(lines, accountRows, currency)),
    Math.max(0, schedule.total_amount),
  );
}

async function monthlyDepreciationRows(
  db: DepreciationDb,
  schedule: DepreciationScheduleRow,
  currency: string,
) {
  const entries = await db
    .select({
      id: depreciationEntries.id,
      journal_entry_id: depreciationEntries.journal_entry_id,
      month_number: depreciationEntries.month_number,
      date: journalEntries.date,
      created_at: journalEntries.created_at,
    })
    .from(depreciationEntries)
    .innerJoin(journalEntries, eq(depreciationEntries.journal_entry_id, journalEntries.id))
    .where(eq(depreciationEntries.schedule_id, schedule.id))
    .orderBy(depreciationEntries.month_number);
  // Repair must follow accounting entries that actually exist. Reconstructing a
  // missing schedule from its planned term would turn deleted/cancelled months
  // into cash movements that never happened.
  if (entries.length === 0) return [];
  const lines = (await Promise.all(chunkForD1InClause(entries.map((entry) => entry.journal_entry_id)).map((entryIds) =>
    db.select({
      journal_entry_id: journalLines.journal_entry_id,
      debit: journalLines.debit,
      credit: journalLines.credit,
      currency: journalLines.currency,
    })
      .from(journalLines)
      .where(
        and(
          inArray(journalLines.journal_entry_id, entryIds),
          eq(journalLines.account_id, schedule.expense_account_id),
          eq(journalLines.currency, currency),
        ),
      )))).flat();
  const amounts = new Map<number, number>();
  for (const line of lines) {
    amounts.set(
      line.journal_entry_id,
      (amounts.get(line.journal_entry_id) ?? 0) + line.debit - line.credit,
    );
  }
  return entries.map((entry) => ({
    journal_entry_id: entry.journal_entry_id,
    month_number: entry.month_number,
    date: entry.date,
    created_at: entry.created_at,
    amount: Math.max(0, amounts.get(entry.journal_entry_id) ?? 0),
  }));
}

function routeAt(
  settings: DepreciationBudgetSettings,
  method: DepreciationBudgetMethod,
  date: string,
  purchaseCategoryId: number | null,
  specialCategoryId: number | null,
) {
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
    source: sourceAllocations.length === 1 ? sourceAllocations[0]!.budget_category_id : null,
    sourceAllocations,
    explicitAllocations: allocationSource.monthly_source_allocations !== undefined,
    destination:
      change?.destination_category_id ??
      (method === "special" ? specialCategoryId : purchaseCategoryId),
  };
}

export async function buildOwnedDepreciationBudgetRows(
  db: DepreciationDb,
  schedule: DepreciationScheduleRow,
  settings: DepreciationBudgetSettings,
  targetAmount: number,
  specialCategoryId: number | null,
  scaleOptions: MoneyScaleOptions = {},
  options: BuildOwnedDepreciationBudgetRowsOptions = {},
): Promise<OwnedDepreciationBudgetLog[]> {
  const method = settings.method;
  const currency = schedule.budget_currency || "JPY";
  if (method === "unallocated" || targetAmount <= 0) return [];
  const settingsError = validateDepreciationBudgetSettings(settings);
  if (settingsError) throw new DepreciationBudgetPlanError(settingsError);
  const purchaseCategoryId = settings.purchase_category_id ?? null;
  const purchaseDestination = method === "special" ? specialCategoryId : purchaseCategoryId;
  const purchaseEntry = options.purchaseCreatedAt
    ? { created_at: options.purchaseCreatedAt }
    : (await db
        .select({ created_at: journalEntries.created_at })
        .from(journalEntries)
        .where(eq(journalEntries.id, schedule.source_journal_entry_id)))[0];
  const rows: OwnedDepreciationBudgetLog[] = [];
  const specialDestination = method === "special" &&
    (purchaseDestination == null || purchaseDestination === specialCategoryId);
  if (purchaseDestination != null || specialDestination) {
    rows.push({
      budget_category_id: purchaseDestination ?? 0,
      year_month: schedule.start_date.slice(0, 7),
      amount: -targetAmount,
      currency,
      date: schedule.start_date,
      adjustment_type: "allocation",
      journal_entry_id: schedule.source_journal_entry_id,
      depreciation_schedule_id: schedule.id,
      depreciation_event_key: `purchase:${schedule.budget_idempotency_key ?? schedule.source_journal_entry_id}`,
      depreciation_event_side: "destination",
      created_at: purchaseEntry?.created_at ?? schedule.created_at,
      special_category: specialDestination,
    });
  }

  const months = options.months ?? await monthlyDepreciationRows(db, schedule, currency);
  const monthNumbers = new Set<number>();
  if (months.some((month) => monthNumbers.has(month.month_number) || !monthNumbers.add(month.month_number))) {
    throw new DepreciationBudgetPlanError("ambiguous_depreciation_months");
  }
  const totalDepreciation = months.reduce((sum, month) => sum + month.amount, 0);
  const depreciableTarget = schedule.total_amount > 0
    ? Math.floor((targetAmount * Math.min(totalDepreciation, schedule.total_amount)) / schedule.total_amount)
    : 0;
  const monthlyTargets = splitAmountByLargestRemainder(
    depreciableTarget,
    months.map((month) => ({ key: month.month_number, weight: month.amount })),
  );
  const amountByMonth = new Map(monthlyTargets.map((row) => [row.key, row.amount]));
  const resetIds = [...new Set((settings.reset_decisions ?? []).map((decision) => decision.reset_log_id))];
  const resetRows = resetIds.length
    ? (await Promise.all(chunkForD1InClause(resetIds).map((ids) => db.select({
        id: budgetAdjustmentLogs.id,
        budget_category_id: budgetAdjustmentLogs.budget_category_id,
        amount: budgetAdjustmentLogs.amount,
        date: budgetAdjustmentLogs.date,
        created_at: budgetAdjustmentLogs.created_at,
        adjustment_type: budgetAdjustmentLogs.adjustment_type,
        currency: budgetAdjustmentLogs.currency,
        reset_scope: budgetAdjustmentLogs.reset_scope,
        reset_group_key: budgetAdjustmentLogs.reset_group_key,
      }).from(budgetAdjustmentLogs).where(inArray(budgetAdjustmentLogs.id, ids))))).flat()
    : [];
  const resetById = new Map(resetRows.map((row) => [row.id, row]));
  const decisions = [...(settings.reset_decisions ?? [])]
    .map((decision) => ({ decision, reset: resetById.get(decision.reset_log_id) }))
    .filter((entry): entry is { decision: NonNullable<typeof entry.decision>; reset: NonNullable<typeof entry.reset> } => !!entry.reset)
    .sort((left, right) => left.reset.date.localeCompare(right.reset.date) ||
      left.reset.created_at.localeCompare(right.reset.created_at) || left.reset.id - right.reset.id);

  // A reset decision is a historical boundary. End/settle stop future monthly
  // routing at that exact stable timestamp; an explicit before/after answer is
  // used only when the source event and reset timestamp are identical.
  const receiptAllowed = (date: string, createdAt: string) => {
    if (settings.end_date && date > settings.end_date) return false;
    for (const { decision, reset } of decisions) {
      if (decision.action !== "end" && decision.action !== "settle") continue;
      const pastBoundary = date < reset.date ||
        (date === reset.date && (createdAt < reset.created_at ||
          (createdAt === reset.created_at && decision.same_day_order === "before")));
      if (pastBoundary) continue;
      return false;
    }
    return true;
  };

  const settlements: {
    settlement: DepreciationBudgetSettlement;
    created_at: string;
    sort_created_at: string;
    sameDayOrder?: "before" | "after";
    auto: boolean;
    route?: ReturnType<typeof routeAt>;
  }[] = (settings.settlements ?? []).map((settlement) => {
    const resetId = settlement.key.startsWith("reset:") ? Number(settlement.key.slice("reset:".length)) : null;
    const reset = resetId == null ? undefined : resetById.get(resetId);
    const decision = resetId == null ? undefined : settings.reset_decisions?.find((item) => item.reset_log_id === resetId);
    const timestampAnchor = reset?.created_at ??
      months.find((month) => month.date === settlement.date)?.created_at ??
      purchaseEntry?.created_at ?? schedule.created_at;
    return {
      settlement,
      created_at: timestampAnchor,
      sort_created_at: reset?.created_at ?? "9999-12-31 23:59:59",
      sameDayOrder: decision?.same_day_order,
      auto: false,
    };
  });
  for (const { decision, reset } of decisions) {
    if (decision.action !== "settle" || settings.settlements?.some((item) => item.key === `reset:${reset.id}`)) continue;
    const routeAtReset = routeAt(settings, method, reset.date, purchaseCategoryId, specialCategoryId);
    settlements.push({
      settlement: {
        key: `reset:${reset.id}`,
        date: reset.date,
        amount: 0,
        source_category_id: decision.settlement_source_category_id ?? null,
      },
      created_at: reset.created_at,
      sort_created_at: reset.created_at,
      sameDayOrder: decision.same_day_order,
      auto: true,
      route: routeAtReset,
    });
  }
  const routingChanges = [...(settings.routing_changes ?? [])].sort((left, right) => left.date.localeCompare(right.date));
  const monthlyByDate = new Map<string, typeof months>();
  for (const month of months) monthlyByDate.set(month.date, [...(monthlyByDate.get(month.date) ?? []), month]);
  const settlementsByDate = new Map<string, typeof settlements>();
  for (const settlement of settlements) settlementsByDate.set(settlement.settlement.date,
    [...(settlementsByDate.get(settlement.settlement.date) ?? []), settlement]);
  const timelineDates = [...new Set([
    ...monthlyByDate.keys(), ...settlementsByDate.keys(), ...routingChanges.map((change) => change.date),
    ...decisions.filter((entry) => entry.decision.action === "carry").map((entry) => entry.reset.date),
  ])].sort();
  let reimbursed = 0;
  let previousDestination = method === "special" ? specialCategoryId : purchaseCategoryId;
  let routeIndex = 0;
  for (const date of timelineDates) {
    while (routeIndex < routingChanges.length && routingChanges[routeIndex]!.date === date) {
      const change = routingChanges[routeIndex]!;
      const nextDestination = change.destination_category_id;
      if (method === "special" && previousDestination != null && nextDestination !== previousDestination) {
        const outstanding = Math.max(0, targetAmount - reimbursed);
        if (outstanding > 0) {
          const key = `routing:${change.date}:${routeIndex}`;
          const createdAt = months.find((month) => month.date >= change.date)?.created_at ??
            purchaseEntry?.created_at ?? schedule.created_at;
          rows.push({
            budget_category_id: previousDestination, year_month: change.date.slice(0, 7), amount: outstanding,
            currency, date: change.date, adjustment_type: "transfer", journal_entry_id: null,
            depreciation_schedule_id: schedule.id, depreciation_event_key: key, depreciation_event_side: "source",
            created_at: createdAt,
          });
          rows.push({
            budget_category_id: nextDestination, year_month: change.date.slice(0, 7), amount: -outstanding,
            currency, date: change.date, adjustment_type: "transfer", journal_entry_id: null,
            depreciation_schedule_id: schedule.id, depreciation_event_key: key, depreciation_event_side: "destination",
            created_at: createdAt,
          });
        }
      }
      previousDestination = nextDestination;
      routeIndex += 1;
    }

    const candidates = [
      ...(monthlyByDate.get(date) ?? []).map((month) => ({
        created_at: month.created_at,
        priority: 0,
        kind: "monthly" as const,
        month,
      })),
      ...(settlementsByDate.get(date) ?? []).map((entry) => ({
        created_at: entry.sort_created_at,
        priority: entry.sameDayOrder === "before" ? -1 : entry.sameDayOrder === "after" ? 1 : 2,
        kind: "settlement" as const,
        entry,
      })),
    ].sort((left, right) => left.created_at.localeCompare(right.created_at) || left.priority - right.priority);

    for (const candidate of candidates) {
      if (candidate.kind === "monthly") {
        const month = candidate.month;
        if (!month.amount || !receiptAllowed(month.date, month.created_at) || reimbursed >= targetAmount) continue;
        const amount = Math.min(amountByMonth.get(month.month_number) ?? 0, targetAmount - reimbursed);
        if (amount <= 0) continue;
        const route = routeAt(settings, method, month.date, purchaseCategoryId, specialCategoryId);
        if (route.destination == null) continue;
        if (route.sourceAllocations.some((allocation) =>
          allocation.ratio > 0 && allocation.budget_category_id === route.destination,
        )) {
          throw new DepreciationBudgetPlanError("source_and_destination_must_differ");
        }
        if (route.sourceAllocations.length === 0) continue;
        reimbursed += amount;
        if (!route.explicitAllocations) {
          const source = route.sourceAllocations[0]?.budget_category_id;
          if (source == null) continue;
          const key = `monthly:${month.month_number}`;
          rows.push({
            budget_category_id: source, year_month: month.date.slice(0, 7), amount: -amount, currency,
            date: month.date, adjustment_type: "transfer", journal_entry_id: month.journal_entry_id,
            depreciation_schedule_id: schedule.id, depreciation_event_key: key,
            depreciation_event_side: "source", created_at: month.created_at,
          });
          rows.push({
            budget_category_id: route.destination, year_month: month.date.slice(0, 7), amount, currency,
            date: month.date, adjustment_type: "transfer", journal_entry_id: month.journal_entry_id,
            depreciation_schedule_id: schedule.id, depreciation_event_key: key,
            depreciation_event_side: "destination", created_at: month.created_at,
            special_category: method === "special" && route.destination === specialCategoryId,
          });
          continue;
        }
        const sourceAmounts = splitDepreciationMonthlySourceAllocations(amount, route.sourceAllocations);
        for (const allocation of sourceAmounts) {
          if (allocation.amount <= 0) continue;
          if (allocation.budget_category_id == null) {
            const key = `monthly:${month.month_number}:unallocated`;
            rows.push({
              budget_category_id: route.destination, year_month: month.date.slice(0, 7), amount: allocation.amount, currency,
              date: month.date, adjustment_type: "transfer", journal_entry_id: month.journal_entry_id,
              depreciation_schedule_id: schedule.id, depreciation_event_key: key,
              depreciation_event_side: "destination", created_at: month.created_at,
              special_category: method === "special" && route.destination === specialCategoryId,
            });
            continue;
          }
          const key = `monthly:${month.month_number}:category:${allocation.budget_category_id}`;
          rows.push({
            budget_category_id: allocation.budget_category_id, year_month: month.date.slice(0, 7), amount: -allocation.amount, currency,
            date: month.date, adjustment_type: "transfer", journal_entry_id: month.journal_entry_id,
            depreciation_schedule_id: schedule.id, depreciation_event_key: key,
            depreciation_event_side: "source", created_at: month.created_at,
          });
          rows.push({
            budget_category_id: route.destination, year_month: month.date.slice(0, 7), amount: allocation.amount, currency,
            date: month.date, adjustment_type: "transfer", journal_entry_id: month.journal_entry_id,
            depreciation_schedule_id: schedule.id, depreciation_event_key: key,
            depreciation_event_side: "destination", created_at: month.created_at,
            special_category: method === "special" && route.destination === specialCategoryId,
          });
        }
        continue;
      }

      const { settlement } = candidate.entry;
      let amount: number;
      try {
        amount = candidate.entry.auto
          ? Math.max(0, targetAmount - reimbursed)
          : toStorageMoneyAmount(settlement.amount, currency, scaleOptions);
      } catch {
        throw new DepreciationBudgetPlanError("invalid_settlement_amount");
      }
      if (amount === 0) continue;
      if (amount > targetAmount - reimbursed) {
        throw new DepreciationBudgetPlanError("settlement_exceeds_remaining_principal");
      }
      const route = candidate.entry.route ?? routeAt(settings, method, settlement.date, purchaseCategoryId, specialCategoryId);
      if (route.destination == null || settlement.source_category_id === route.destination) {
        throw new DepreciationBudgetPlanError("invalid_settlement_source");
      }
      if (!receiptAllowed(settlement.date, candidate.created_at) &&
          !settings.reset_decisions?.some((decision) => decision.action === "settle" && settlement.key === `reset:${decision.reset_log_id}`)) {
        continue;
      }
      reimbursed += amount;
      const eventKey = `settlement:${settlement.key}`;
      if (settlement.source_category_id != null) {
        rows.push({
          budget_category_id: settlement.source_category_id, year_month: settlement.date.slice(0, 7), amount: -amount,
          currency, date: settlement.date, adjustment_type: "transfer", journal_entry_id: null,
          depreciation_schedule_id: schedule.id, depreciation_event_key: eventKey,
          depreciation_event_side: "source", created_at: candidate.created_at,
        });
      }
      rows.push({
        budget_category_id: route.destination, year_month: settlement.date.slice(0, 7), amount,
        currency, date: settlement.date, adjustment_type: "transfer", journal_entry_id: null,
        depreciation_schedule_id: schedule.id, depreciation_event_key: eventKey,
        depreciation_event_side: "destination", created_at: candidate.created_at,
        special_category: method === "special" && route.destination === specialCategoryId,
      });
    }
  }

  // `same_day_order` resolves historical events whose database timestamp was
  // identical to a reset. Keep the choice in the event log's stable ordering,
  // so both sides of a paired transfer are visible together at either cutoff.
  // The accounting journal timestamp remains unchanged.
  for (const row of rows) {
    if (row.depreciation_event_key.startsWith("settlement:") || row.depreciation_event_key.startsWith("carry:")) continue;
    const decision = decisions.find(({ decision: choice, reset }) =>
      reset.date === row.date && reset.created_at === row.created_at && choice.same_day_order,
    )?.decision;
    if (decision?.same_day_order === "before") row.created_at = shiftStableTimestamp(row.created_at ?? schedule.created_at, -1);
    if (decision?.same_day_order === "after") row.created_at = shiftStableTimestamp(row.created_at ?? schedule.created_at, 1);
  }

  // A historical carry decision restores only the negative balance that the
  // corrected plan would have immediately before that reset. The stored reset
  // amount may have been calculated from the old reservation scheme, so it is
  // not safe to invert it directly.
  const allCurrentLogs = await db.select().from(budgetAdjustmentLogs);
  const scheduleEntryIds = months
    .map((month) => month.journal_entry_id)
    .filter((id): id is number => id != null);
  const legacyAllocationRows = (await Promise.all(chunkForD1InClause([
    schedule.source_journal_entry_id,
    ...scheduleEntryIds,
  ]).map((journalIds) => db.select({ id: journalEntryBudgetAllocations.id })
    .from(journalEntryBudgetAllocations)
    .where(and(
      inArray(journalEntryBudgetAllocations.journal_entry_id, journalIds),
      eq(journalEntryBudgetAllocations.source, "depreciation"),
    ))))).flat();
  for (const { decision, reset } of decisions) {
    if (decision.action !== "carry" || method !== "special" ||
        reset.adjustment_type !== "reset" || reset.currency !== currency) continue;
    const scopeAll = decision.scope === "all" || reset.reset_scope === "all";
    const resetGroup = reset.reset_group_key
      ? await db.select({
          id: budgetAdjustmentLogs.id,
          budget_category_id: budgetAdjustmentLogs.budget_category_id,
        }).from(budgetAdjustmentLogs).where(and(
          eq(budgetAdjustmentLogs.reset_group_key, reset.reset_group_key),
          eq(budgetAdjustmentLogs.adjustment_type, "reset"),
          eq(budgetAdjustmentLogs.currency, currency),
        ))
      : scopeAll
        ? await db.select({
            id: budgetAdjustmentLogs.id,
            budget_category_id: budgetAdjustmentLogs.budget_category_id,
          }).from(budgetAdjustmentLogs).where(and(
            eq(budgetAdjustmentLogs.date, reset.date),
            eq(budgetAdjustmentLogs.created_at, reset.created_at),
            eq(budgetAdjustmentLogs.adjustment_type, "reset"),
            eq(budgetAdjustmentLogs.currency, currency),
          ))
        : [{ id: reset.id, budget_category_id: reset.budget_category_id }];
    const specialReset = resetGroup.find((row) => row.budget_category_id === specialCategoryId);
    // A retroactive virtual special category did not exist at a global reset,
    // so carry has no category reset to undo. Do not infer one from unrelated
    // categories or fabricate a balancing event.
    if (!specialReset || specialCategoryId == null) continue;
    const resetGroupIds = new Set(resetGroup.map((row) => row.id));
    const rowsBeforeReset = rows.filter((row) => {
      if (row.date < reset.date) return true;
      if (row.date > reset.date) return false;
      const eventCreatedAt = row.created_at ?? schedule.created_at;
      return eventCreatedAt < reset.created_at ||
        (eventCreatedAt === reset.created_at && decision.same_day_order === "before");
    });
    const replacementLogs = [
      ...allCurrentLogs.filter((row) => row.depreciation_schedule_id !== schedule.id && !resetGroupIds.has(row.id)),
      ...rowsBeforeReset.map((row, index) => ({
        id: -100000 - index,
        note: null,
        created_at: row.created_at ?? schedule.created_at,
        ...row,
        budget_category_id: row.special_category ? specialCategoryId! : row.budget_category_id,
      })),
    ] as unknown as (typeof budgetAdjustmentLogs.$inferSelect)[];
    const beforeReset = await computeBudgetSummaryForDate(db, reset.date, currency, {
      adjustmentLogs: replacementLogs,
      excludeLegacyScheduleId: schedule.id,
      excludeAllocationIds: legacyAllocationRows.map((row) => row.id),
      through: { date: reset.date, created_at: reset.created_at },
    });
    const categoryBalance = beforeReset.categories.find((category) => category.category.id === specialCategoryId)?.available ?? 0;
    const carriedDebt = Math.min(0, toStorageMoneyAmount(categoryBalance, currency, scaleOptions));
    if (carriedDebt === 0) continue;
    const resetInstant = new Date(`${reset.created_at.replace(" ", "T")}Z`).getTime();
    const afterResetCreatedAt = Number.isFinite(resetInstant)
      ? new Date(resetInstant + 1).toISOString().replace("T", " ").replace("Z", "").slice(0, 23)
      : `${reset.created_at}.001`;
    rows.push({
      budget_category_id: specialReset.budget_category_id,
      year_month: reset.date.slice(0, 7),
      amount: carriedDebt,
      currency,
      date: reset.date,
      adjustment_type: "allocation",
      journal_entry_id: null,
      depreciation_schedule_id: schedule.id,
      depreciation_event_key: `carry:reset:${reset.id}`,
      depreciation_event_side: "source",
      created_at: afterResetCreatedAt,
      special_category: true,
    });
  }
  return rows;
}

export class DepreciationBudgetPlanError extends Error {
  constructor(public readonly code: string) { super(code); }
}

export { getDepreciationBudgetReceiptGroups } from "./depreciationBudgetReceipts";

export async function getDepreciationBudgetProgress(
  db: DepreciationDb,
  schedule: DepreciationScheduleRow,
  scaleOptions?: MoneyScaleOptions,
): Promise<DepreciationBudgetProgress> {
  const scales = scaleOptions ?? (await getBudgetScaleOptions(db));
  const method = (schedule.budget_method ?? null) as DepreciationBudgetMethod | null;
  const settings = schedule.budget_settings
    ? (JSON.parse(schedule.budget_settings) as DepreciationBudgetSettings)
    : null;
  const rows = await db
    .select()
    .from(budgetAdjustmentLogs)
    .where(eq(budgetAdjustmentLogs.depreciation_schedule_id, schedule.id));
  const valid = getDepreciationBudgetReceiptGroups(rows, settings ?? { method: "unallocated" }, schedule);
  const today = toLocalDateString();
  const currency = schedule.budget_currency || "JPY";
  const validRows = [...valid.values()];
  const stoppingDecisions = (settings?.reset_decisions ?? [])
    .filter((decision) => decision.action === "end" || decision.action === "settle");
  const stoppingResetIds = stoppingDecisions.map((decision) => decision.reset_log_id);
  const stoppingResetRows = stoppingResetIds.length
    ? (await Promise.all(chunkForD1InClause(stoppingResetIds).map((ids) =>
        db.select({ id: budgetAdjustmentLogs.id, date: budgetAdjustmentLogs.date, created_at: budgetAdjustmentLogs.created_at })
          .from(budgetAdjustmentLogs).where(inArray(budgetAdjustmentLogs.id, ids))))).flat()
    : [];
  const stoppingBoundaries = stoppingDecisions.flatMap((decision) => {
    const reset = stoppingResetRows.find((row) => row.id === decision.reset_log_id);
    return reset ? [{ ...reset, decision }] : [];
  }).sort((left, right) => left.date.localeCompare(right.date) || left.created_at.localeCompare(right.created_at));
  const receiptIsInPlan = (event: { key: string; date: string; created_at: string }) => {
    if (settings?.end_date && event.date > settings.end_date) return false;
    for (const reset of stoppingBoundaries) {
      // A paired reset settlement is the final receipt at the boundary itself.
      // The stop applies to ordinary monthly receipts and later events only.
      if (reset.decision.action === "settle" && event.key === `settlement:reset:${reset.decision.reset_log_id}`) continue;
      if (event.date < reset.date) continue;
      if (event.date > reset.date) return false;
      if (event.created_at < reset.created_at) continue;
      if (event.created_at === reset.created_at && reset.decision.same_day_order === "before") continue;
      return false;
    }
    return true;
  };
  const reimbursedUnits = validRows
    .filter((event) => event.date <= today && receiptIsInPlan(event))
    .reduce((sum, event) => sum + event.amount, 0);
  const futureUnits = validRows
    .filter((event) => event.date > today && receiptIsInPlan(event))
    .reduce((sum, event) => sum + event.amount, 0);
  const targetUnits = method == null
    ? await getDepreciationPurchaseTarget(db, schedule, currency)
    : schedule.budget_target_amount;
  const target = fromStorageMoneyAmount(targetUnits, currency, scales);
  const reimbursed = fromStorageMoneyAmount(Math.min(targetUnits, reimbursedUnits), currency, scales);
  const remaining = method === "unallocated"
    ? 0
    : fromStorageMoneyAmount(Math.max(0, targetUnits - Math.min(targetUnits, reimbursedUnits)), currency, scales);
  const ended = ((!!settings?.end_date && settings.end_date <= today) ||
    stoppingBoundaries.some((boundary) => boundary.date <= today)) && remaining > 0;
  const status = method == null
    ? "unset"
    : method === "unallocated" || remaining <= 0
      ? "completed"
      : ended
        ? "ended"
        : "active";
  return {
    method,
    purchase_category_id: settings?.purchase_category_id ?? null,
    monthly_source_category_id: settings?.monthly_source_category_id ?? null,
    destination_category_id:
      method === "special"
        ? schedule.budget_special_category_id
        : settings?.purchase_category_id ?? null,
    target_amount: target,
    reimbursed_amount: reimbursed,
    remaining_amount: remaining,
    ended_unreimbursed_amount: status === "ended" ? remaining : 0,
    future_amount: fromStorageMoneyAmount(futureUnits, currency, scales),
    status,
    currency,
    revision: schedule.budget_revision,
    settings,
  };
}

function eventFromRows(rows: readonly OwnedDepreciationBudgetLog[]): DepreciationBudgetEvent {
  const row = rows[0]!;
  const kind = row.depreciation_event_key.startsWith("purchase:")
    ? "purchase"
    : row.depreciation_event_key.startsWith("settlement:")
      ? "settlement"
      : row.depreciation_event_key.startsWith("routing:")
        ? "routing"
        : row.depreciation_event_key.startsWith("carry:")
          ? "carry"
          : "monthly";
  const source = rows.find((item) => item.amount < 0);
  const destination = rows.find((item) => item.amount > 0);
  return {
    key: row.depreciation_event_key,
    date: row.date,
    created_at: row.created_at ?? "",
    kind,
    // Preview events describe where budget value leaves and enters, which is
    // the signed amount semantics. The log's side marker is not that meaning:
    // a purchase debit is stored as a negative destination-side adjustment.
    source_category_id: source && source.budget_category_id > 0 ? source.budget_category_id : null,
    destination_category_id: destination && destination.budget_category_id > 0 ? destination.budget_category_id : null,
    amount: Math.max(...rows.map((item) => Math.abs(item.amount))),
    journal_entry_id: rows.find((item) => item.journal_entry_id != null)?.journal_entry_id ?? null,
  };
}

function ownedEventGroups(rows: readonly OwnedDepreciationBudgetLog[]) {
  const groups = new Map<string, OwnedDepreciationBudgetLog[]>();
  for (const row of rows) {
    const group = groups.get(row.depreciation_event_key) ?? [];
    group.push(row);
    groups.set(row.depreciation_event_key, group);
  }
  return groups;
}

function ownedEventSignature(rows: readonly OwnedDepreciationBudgetLog[]): string {
  return JSON.stringify([...rows]
    .sort((left, right) => left.depreciation_event_side.localeCompare(right.depreciation_event_side))
    .map((row) => [
      row.depreciation_event_side,
      row.amount,
      row.date,
      row.year_month,
      row.currency,
      row.adjustment_type,
      row.special_category ? 0 : row.budget_category_id,
      row.journal_entry_id,
      row.created_at ?? "",
    ]));
}

export function diffOwnedDepreciationBudgetRows(
  current: (typeof budgetAdjustmentLogs.$inferSelect)[],
  expected: OwnedDepreciationBudgetLog[],
  _method: DepreciationBudgetMethod,
): DepreciationBudgetPreview["changes"] {
  const currentGroups = ownedEventGroups(current
    .filter((row) => row.depreciation_event_key && row.depreciation_event_side)
    .map((row) => ({
      ...row,
      depreciation_schedule_id: row.depreciation_schedule_id!,
      depreciation_event_key: row.depreciation_event_key!,
      depreciation_event_side: row.depreciation_event_side!,
    }) as OwnedDepreciationBudgetLog));
  const expectedGroups = ownedEventGroups(expected);
  const changes: DepreciationBudgetPreview["changes"] = [];
  for (const [key, rows] of currentGroups) {
    const next = expectedGroups.get(key);
    if (!next) {
      const beforeRows = rows as OwnedDepreciationBudgetLog[];
      changes.push({ operation: "cancel", event: eventFromRows(beforeRows) });
    } else {
      // A virtual special category may use a negative placeholder during
      // preview. Compare its paired category leg as the same special bucket.
      const beforeRows = (rows as OwnedDepreciationBudgetLog[]).map((row) => ({
        ...row,
        special_category: next.some((nextRow) =>
          nextRow.depreciation_event_side === row.depreciation_event_side && nextRow.special_category,
        ),
      }));
      if (ownedEventSignature(next) === ownedEventSignature(beforeRows)) continue;
      changes.push({ operation: "change", event: eventFromRows(next) });
    }
  }
  for (const [key, rows] of expectedGroups) {
    if (!currentGroups.has(key)) changes.push({ operation: "add", event: eventFromRows(rows) });
  }
  return changes;
}

export async function validateBudgetCategoryIds(
  db: DepreciationDb,
  settings: DepreciationBudgetSettings,
): Promise<string | null> {
  const error = validateDepreciationBudgetSettings(settings);
  if (error) return error;
  const ids = new Set<number>();
  if (settings.purchase_category_id != null) ids.add(settings.purchase_category_id);
  for (const allocation of resolveDepreciationMonthlySourceAllocations(settings)) {
    if (allocation.ratio > 0 && allocation.budget_category_id != null) ids.add(allocation.budget_category_id);
  }
  for (const route of settings.routing_changes ?? []) {
    ids.add(route.destination_category_id);
    const allocations = resolveDepreciationMonthlySourceAllocations(
      route.monthly_source_allocations !== undefined || route.monthly_source_category_id != null
        ? route
        : settings,
    );
    for (const allocation of allocations) {
      if (allocation.ratio > 0 && allocation.budget_category_id != null) ids.add(allocation.budget_category_id);
    }
  }
  for (const settlement of settings.settlements ?? []) {
    if (settlement.source_category_id != null) ids.add(settlement.source_category_id);
  }
  const found = ids.size
    ? (await Promise.all(chunkForD1InClause([...ids]).map((chunk) =>
        db.select({ id: budgetCategories.id, is_archived: budgetCategories.is_archived })
          .from(budgetCategories).where(inArray(budgetCategories.id, chunk))))).flat()
    : [];
  if (found.length !== ids.size) return "budget_category_not_found";
  return null;
}

export async function getOwnedBudgetRows(db: DepreciationDb, scheduleId: number) {
  return db.select().from(budgetAdjustmentLogs).where(
    eq(budgetAdjustmentLogs.depreciation_schedule_id, scheduleId),
  );
}

export async function getDepreciationBudgetRevisionAudit(db: DepreciationDb, scheduleId: number) {
  return db.select().from(depreciationBudgetRevisions)
    .where(eq(depreciationBudgetRevisions.schedule_id, scheduleId));
}

export async function snapshotBudgetInputRevision(db: DepreciationDb) {
  const [scales, currencies] = await Promise.all([
    getBudgetScaleOptions(db),
    db.select().from(enabledCurrencies),
  ]);
  return { scales, currencies };
}
