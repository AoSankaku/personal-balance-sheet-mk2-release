import type { DepreciationBudgetSettings, DepreciationResetInputDecision, DepreciationResetPlan } from "../../../shared/depreciationBudget";
import { resolveDepreciationMonthlySourceAllocations } from "../../../shared/depreciationBudgetAllocation";
import { fromStorageMoneyAmount, toStorageMoneyAmount, type MoneyScaleOptions } from "./moneyValidation";
import { getDepreciationBudgetReceiptGroups } from "./depreciationBudgetReceipts";

interface Schedule {
  id: number;
  description: string;
  budget_method: "assigned" | "special";
  budget_settings: string;
  months: number;
  start_date: string;
  budget_revision: number;
  budget_special_category_id: number | null;
  budget_target_amount: number;
  budget_currency: string;
}

const DEPRECIATION_BUDGET_AUDIT_ROW_MAX_BYTES = 1_800_000;
type ExistingBudgetEvent = Record<string, unknown> & {
  id: number;
  budget_category_id: number;
  amount: number;
  date: string;
  created_at: string;
  depreciation_event_key: string | null;
};

export class DepreciationResetError extends Error {
  constructor(public readonly code: string, public readonly plans: DepreciationResetPlan[] = []) { super(code); }
}

async function configuredSchedules(DB: D1Database) {
  const result = await DB.prepare("SELECT * FROM depreciation_schedules WHERE budget_method IN ('assigned','special')").all<Schedule>();
  return result.results ?? [];
}

function routeAt(schedule: Schedule, date: string) {
  const settings = JSON.parse(schedule.budget_settings) as DepreciationBudgetSettings;
  let sourceAllocations = resolveDepreciationMonthlySourceAllocations(settings);
  let destination = schedule.budget_method === "special"
    ? schedule.budget_special_category_id : settings.purchase_category_id ?? null;
  for (const route of [...settings.routing_changes ?? []].sort((a,b) => a.date.localeCompare(b.date))) {
    if (route.date > date) break;
    sourceAllocations = resolveDepreciationMonthlySourceAllocations(
      route.monthly_source_allocations !== undefined || route.monthly_source_category_id != null
        ? route
        : settings,
    );
    destination = route.destination_category_id;
  }
  const source = sourceAllocations.length === 1 ? sourceAllocations[0]!.budget_category_id : null;
  return { settings, source, sourceAllocations, destination };
}

async function endedBefore(DB:D1Database,settings:DepreciationBudgetSettings,date:string) {
  if(settings.end_date&&settings.end_date<date)return true;
  const ids=(settings.reset_decisions??[]).filter(row=>row.action==="end"||row.action==="settle").map(row=>row.reset_log_id);
  if(!ids.length)return false;
  return !!await DB.prepare(`SELECT id FROM budget_adjustment_logs WHERE id IN (${ids.map(()=>"?").join(",")}) AND date<=? LIMIT 1`)
    .bind(...ids,date).first();
}

export async function isManagedDepreciationReset(DB:D1Database,id:number) {
  return !!await DB.prepare(`SELECT ds.id FROM depreciation_schedules ds,
    json_each(COALESCE(ds.budget_settings,'{}'),'$.reset_decisions') decision
    WHERE CAST(json_extract(decision.value,'$.reset_log_id') AS INTEGER)=? LIMIT 1`).bind(id).first();
}

/** The plan's lifetime receipts are independent of category resets. */
async function remainingAt(DB: D1Database, schedule: Schedule, date: string) {
  const settings = JSON.parse(schedule.budget_settings) as DepreciationBudgetSettings;
  const rows = await DB.prepare(`SELECT budget_category_id,amount,date,currency,created_at,
      depreciation_event_key,depreciation_event_side
    FROM budget_adjustment_logs WHERE depreciation_schedule_id = ?`)
    .bind(schedule.id).all<{
      budget_category_id: number; amount: number; date: string; currency: string; created_at: string | null;
      depreciation_event_key: string | null; depreciation_event_side: "source" | "destination" | null;
    }>();
  const valid = getDepreciationBudgetReceiptGroups(rows.results ?? [], settings, schedule);
  const received = [...valid.values()].filter((event) => event.date <= date)
    .reduce((sum, event) => sum + event.amount, 0);
  return Math.max(0, schedule.budget_target_amount - received);
}

export async function getDepreciationResetPlans(DB: D1Database, categoryId: number, date: string, currency: string,
  scaleOptions: MoneyScaleOptions = {}): Promise<DepreciationResetPlan[]> {
  const plans: DepreciationResetPlan[] = [];
  for (const schedule of await configuredSchedules(DB)) {
    if ((schedule.budget_currency || "JPY") !== currency) continue;
    const { settings, source, sourceAllocations, destination } = routeAt(schedule, date);
    // Ending monthly reimbursement never releases an outstanding special debt.
    if (await endedBefore(DB,settings,date) &&
      !(schedule.budget_method === "special" && destination === categoryId)) continue;
    if (!sourceAllocations.some((allocation) => allocation.budget_category_id === categoryId && allocation.ratio > 0) &&
      destination !== categoryId) continue;
    const remaining = await remainingAt(DB, schedule, date);
    if (remaining <= 0) continue;
    plans.push({ schedule_id: schedule.id, description: schedule.description, method: schedule.budget_method,
      remaining_amount: fromStorageMoneyAmount(remaining,currency,scaleOptions),
      special_category_id: schedule.budget_method === "special" ? destination : null,
      monthly_source_category_id: source, monthly_source_allocations: sourceAllocations,
      destination_category_id: destination });
  }
  return plans;
}

/** An archive may retire old routing only after a dated replacement is saved. */
export async function categoryHasDepreciationReferences(DB: D1Database, categoryId: number, date: string, deleting = false) {
  if (deleting) {
    const history = await DB.prepare("SELECT 1 AS found FROM budget_adjustment_logs WHERE budget_category_id=? AND depreciation_schedule_id IS NOT NULL LIMIT 1")
      .bind(categoryId).first();
    if (history) return true;
  }
  for (const schedule of await configuredSchedules(DB)) {
    const { settings, sourceAllocations, destination } = routeAt(schedule,date);
    const remaining = await remainingAt(DB,schedule,date);
    if (schedule.budget_method === "special" && destination === categoryId && remaining > 0) return true;
    if (remaining <= 0 || await endedBefore(DB,settings,date)) continue;
    if (sourceAllocations.some((allocation) => allocation.budget_category_id === categoryId && allocation.ratio > 0) ||
      destination === categoryId) return true;
    if ((settings.routing_changes ?? []).some(route => {
      if (route.date <= date) return false;
      const allocations = resolveDepreciationMonthlySourceAllocations(
        route.monthly_source_allocations !== undefined || route.monthly_source_category_id != null
          ? route
          : settings,
      );
      return allocations.some((allocation) => allocation.budget_category_id === categoryId && allocation.ratio > 0) ||
        route.destination_category_id === categoryId;
    })) return true;
  }
  return false;
}

/** Build all reset/plan changes for the caller's single guarded D1 transaction. */
export async function prepareDepreciationReset(DB: D1Database, input: {
  categoryId: number; date: string; currency: string; resetId: number; createdAt: string;
  decisions: DepreciationResetInputDecision[]; scaleOptions: MoneyScaleOptions; archive: boolean;
}) {
  const plans = await getDepreciationResetPlans(DB,input.categoryId,input.date,input.currency,input.scaleOptions);
  const statements: D1PreparedStatement[] = [];
  let skipReset = false;
  const schedules = await configuredSchedules(DB);
  for (const plan of plans) {
    const schedule = schedules.find(row => row.id === plan.schedule_id)!;
    const ownSpecial = plan.method === "special" && plan.special_category_id === input.categoryId;
    const decision = input.decisions.find(row => row.schedule_id === plan.schedule_id) ??
      (plan.method === "special" ? { schedule_id: plan.schedule_id, action: "carry" as const } : undefined);
    if (!decision || (plan.method === "assigned" && !["continue","end"].includes(decision.action)) ||
        (plan.method === "special" && !["carry","settle"].includes(decision.action))) {
      throw new DepreciationResetError("depreciation_reset_decision_required",plans);
    }
    if (input.archive && decision.action !== "end" && !(ownSpecial && decision.action === "settle")) {
      throw new DepreciationResetError("depreciation_routing_required",plans);
    }
    if (ownSpecial && decision.action === "carry") { skipReset = true; continue; }
    const settings = JSON.parse(schedule.budget_settings) as DepreciationBudgetSettings;
    settings.reset_decisions = [...settings.reset_decisions ?? [],
      { reset_log_id: input.resetId, action: decision.action,
        ...(decision.action === "settle" ? { settlement_source_category_id: decision.settlement_source_category_id ?? null } : {}) }];
    if (decision.action === "end") settings.end_date = input.date;
    const beforeEvents = (await DB.prepare("SELECT * FROM budget_adjustment_logs WHERE depreciation_schedule_id=? ORDER BY date,created_at,id")
      .bind(schedule.id).all<ExistingBudgetEvent>()).results ?? [];
    const removesFutureReceipts = decision.action === "end" || decision.action === "settle";
    const afterEventRows = beforeEvents
      .filter((event) => !removesFutureReceipts || !(
        (event.depreciation_event_key?.startsWith("monthly:") ||
          event.depreciation_event_key?.startsWith("settlement:")) &&
        (event.date > input.date || (event.date === input.date && event.created_at > input.createdAt))
      ))
      .map((event) => ({
        id: event.id, category: event.budget_category_id, amount: event.amount,
        date: event.date, key: event.depreciation_event_key,
      }));
    if (decision.action === "end" || decision.action === "settle") {
      settings.settlements = settings.settlements?.filter(event => event.date <= input.date);
    }
    if (decision.action === "settle") {
      const source = decision.settlement_source_category_id ?? null;
      if (source === plan.destination_category_id || plan.destination_category_id == null) {
        throw new DepreciationResetError("invalid_depreciation_settlement_source",plans);
      }
      if (source != null && !await DB.prepare("SELECT id FROM budget_categories WHERE id=? AND is_archived=0").bind(source).first()) {
        throw new DepreciationResetError("invalid_depreciation_settlement_source",plans);
      }
      const key = `reset:${input.resetId}`;
      settings.settlements = [...settings.settlements ?? [], { key, date: input.date, amount: plan.remaining_amount, source_category_id: source }];
      const amount = toStorageMoneyAmount(plan.remaining_amount,input.currency,input.scaleOptions);
      const sides = [...(source == null ? [] : [{category:source,amount:-amount,side:"source"}]),
        {category:plan.destination_category_id,amount,side:"destination"}];
      afterEventRows.push(...sides.map((side) => ({
        id: 9_999_999_999, category: side.category, amount: side.amount,
        date: input.date, key: `settlement:${key}`,
      })));
      for (const side of sides) {
        statements.push(DB.prepare(`INSERT INTO budget_adjustment_logs
          (budget_category_id,year_month,amount,currency,date,adjustment_type,created_at,
           depreciation_schedule_id,depreciation_event_key,depreciation_event_side)
          VALUES(?,?,?,?,?,'transfer',?,?,?,?)`).bind(side.category,input.date.slice(0,7),side.amount,input.currency,
            input.date,input.createdAt,schedule.id,`settlement:${key}`,side.side));
      }
    }
    if (decision.action === "end" || decision.action === "settle") {
      statements.push(DB.prepare(`DELETE FROM budget_adjustment_logs WHERE depreciation_schedule_id=?
        AND (depreciation_event_key LIKE 'monthly:%' OR depreciation_event_key LIKE 'settlement:%')
        AND (date>? OR (date=? AND created_at>?))`)
        .bind(schedule.id,input.date,input.date,input.createdAt));
    }
    statements.push(DB.prepare("UPDATE depreciation_schedules SET budget_settings=?,budget_revision=budget_revision+1 WHERE id=?")
      .bind(JSON.stringify(settings),schedule.id));
    const auditRowSize = new TextEncoder().encode(JSON.stringify({
      schedule_id: schedule.id,
      revision: schedule.budget_revision + 1,
      action: "reset",
      request_key: `reset:${input.resetId}`,
      before_settings: schedule.budget_settings,
      after_settings: JSON.stringify(settings),
      before_events: JSON.stringify(beforeEvents),
      after_events: JSON.stringify(afterEventRows),
      created_at: "2026-10-19 00:00:00",
    })).byteLength;
    if (auditRowSize > DEPRECIATION_BUDGET_AUDIT_ROW_MAX_BYTES) {
      throw new DepreciationResetError("depreciation_budget_plan_too_large",plans);
    }
    statements.push(DB.prepare(`INSERT INTO depreciation_budget_revisions
      (schedule_id,revision,action,request_key,before_settings,after_settings,before_events,after_events)
      VALUES(?,?,'reset',?,?,?,?,(SELECT json_group_array(json_object('id',id,'category',budget_category_id,'amount',amount,'date',date,'key',depreciation_event_key))
        FROM budget_adjustment_logs WHERE depreciation_schedule_id=?))`)
      .bind(schedule.id,schedule.budget_revision+1,`reset:${input.resetId}`,schedule.budget_settings,
        JSON.stringify(settings),JSON.stringify(beforeEvents),schedule.id));
  }
  return { statements, skipReset, plans };
}
