import { and, eq, sql, inArray } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";
import { createDb, type Env } from "../db";
import type {
  ApplyDepreciationBudgetInput,
  DepreciationBudgetBoundary,
  DepreciationBudgetPreview,
  DepreciationBudgetSettings,
  DepreciationBudgetSnapshot,
} from "../../../shared/depreciationBudget";
import { resolveDepreciationMonthlySourceAllocations } from "../../../shared/depreciationBudgetAllocation";
import { budgetAccountDelta, isBudgetAccount } from "../../../shared/budgetScope";
import { computeBudgetSummaryForDate } from "./budget";
import { toLocalDateString } from "../lib/appDate";
import { chunkForD1InClause } from "../lib/d1Query";
import { buildJournalHistoryStatements } from "../lib/journalHistory";
import { createRequestScopedD1ReadMemo } from "../lib/d1ReadMemo";
import { prepareMutation, readBudgetMutationRevision, runBudgetGuardedBatch } from "../lib/d1Mutation";
import { journalBalanceError } from "../lib/journalValidation";
import {
  accounts,
  budgetAdjustmentLogs,
  budgetCategories,
  journalEntries,
  journalLines,
  journalEntryBudgetAllocations,
  budgetCategoryAccounts,
  budgetFundingAllocations,
  enabledCurrencies,
  depreciationSchedules,
  depreciationEntries,
  depreciationBudgetReservations,
  depreciationBudgetRevisions,
} from "../db/schema";
import {
  buildDepreciationBudgetRevisionGuard,
  buildOwnedDepreciationBudgetRows,
  DepreciationBudgetPlanError,
  diffOwnedDepreciationBudgetRows,
  getBudgetScaleOptions,
  getDepreciationBudgetProgress,
  getDepreciationBudgetReceiptGroups,
  getDepreciationBudgetRevision,
  getDepreciationPurchaseTarget,
  getOwnedBudgetRows,
  normalizeDepreciationBudgetSettings,
  snapshotBudgetInputRevision,
  validateBudgetCategoryIds,
  type DepreciationScheduleRow,
} from "../lib/depreciationBudget";
import {
  findInvalidMoneyField,
  invalidMoneyResponse,
  fromStorageMoneyAmount,
  toStorageMoneyAmount,
  type MoneyScaleOptions,
} from "../lib/moneyValidation";

type RouteContext = Context<{ Bindings: Env }>;

const router = new Hono<{ Bindings: Env }>();
const DEPRECIATION_BUDGET_LOG_CHUNK_SIZE = 200;
const DEPRECIATION_BUDGET_AUDIT_ROW_MAX_BYTES = 1_800_000;

function depreciationBudgetAuditRowFits(row: Record<string, unknown>): boolean {
  return new TextEncoder().encode(JSON.stringify(row)).byteLength <= DEPRECIATION_BUDGET_AUDIT_ROW_MAX_BYTES;
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Return YYYY-MM-DD for the 1st of the month that is `offset` months after the
 *  month derived from `baseDate`. offset=0 = same month as baseDate. */
function firstOfMonth(baseDate: string, offset: number): string {
  const [y, m] = baseDate.split("-").map(Number) as [number, number];
  const d = new Date(y, m - 1 + offset, 1);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}-01`;
}

/** Days in the month of `date` (YYYY-MM-DD). */
function daysInMonth(date: string): number {
  const [y, m] = date.split("-").map(Number) as [number, number];
  return new Date(y, m, 0).getDate();
}

/**
 * Compute the monthly depreciation amounts.
 * - Month 1: prorated by the remaining days in the purchase month.
 * - Months 2..N: treated as full months.
 * - Any rounding remainder is added to month 1 instead of the final month.
 */
function computeMonthlyAmounts(
  totalAmount: number,
  months: number,
  startDate: string,
): number[] {
  if (months === 1) return [totalAmount];

  const [, , dayStr] = startDate.split("-") as [string, string, string];
  const day = Number(dayStr);
  const dim = daysInMonth(startDate);
  const daysRemaining = dim - day + 1;
  const firstMonthWeight = daysRemaining / dim;
  const weights = [firstMonthWeight, ...Array<number>(months - 1).fill(1)];
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const amounts = weights.map((weight) =>
    Math.floor((totalAmount * weight) / totalWeight),
  );
  const allocated = amounts.reduce((sum, amount) => sum + amount, 0);
  amounts[0] = (amounts[0] ?? 0) + (totalAmount - allocated);
  return amounts;
}

/** Build journal_entry_budget_allocations rows for a monthly depreciation entry. */
function buildBudgetAllocations(
  journalEntryId: number,
  amount: number,
  ratios: { budget_category_id: number; ratio: number }[],
): { journal_entry_id: number; budget_category_id: number; amount: number }[] {
  if (ratios.length === 0) return [];
  const totalRatio = ratios.reduce((s, r) => s + r.ratio, 0);
  if (totalRatio <= 0) return [];

  // Expense-side allocations are stored as negative values so budget summary
  // treats them as spending rather than additions to the budget.
  const rows: {
    journal_entry_id: number;
    budget_category_id: number;
    amount: number;
  }[] = [];
  let remaining = -amount;

  for (let i = 0; i < ratios.length; i++) {
    const r = ratios[i]!;
    const isLast = i === ratios.length - 1;
    const alloc = isLast
      ? remaining
      : -Math.round((amount * r.ratio) / totalRatio);
    rows.push({
      journal_entry_id: journalEntryId,
      budget_category_id: r.budget_category_id,
      amount: alloc,
    });
    remaining -= alloc;
  }
  return rows;
}

function buildBudgetReservations(
  scheduleId: number,
  amount: number,
  ratios: { budget_category_id: number; ratio: number }[],
) {
  return buildBudgetAllocations(0, amount, ratios).map((allocation) => ({
    schedule_id: scheduleId,
    budget_category_id: allocation.budget_category_id,
    amount: -allocation.amount,
    currency: "JPY",
  }));
}

function buildMonthlyExpenseTagCopyStatements(
  DB: D1Database,
  monthPairs: { sourceJournalId: number; replacementJournalId: number }[],
): D1PreparedStatement[] {
  if (monthPairs.length === 0) return [];
  const serializedPairs = JSON.stringify(monthPairs.map((pair) => ({
    source_journal_id: pair.sourceJournalId,
    replacement_journal_id: pair.replacementJournalId,
  })));
  return [
    DB.prepare(`INSERT INTO journal_entry_expense_tags(journal_entry_id,tag_id)
      SELECT CAST(json_extract(pair.value,'$.replacement_journal_id') AS INTEGER),jet.tag_id
      FROM json_each(?) pair JOIN journal_entry_expense_tags jet
        ON jet.journal_entry_id=CAST(json_extract(pair.value,'$.source_journal_id') AS INTEGER)`)
      .bind(serializedPairs),
    DB.prepare(`INSERT INTO journal_entry_tag_amounts(journal_entry_id,currency,amount)
      SELECT CAST(json_extract(pair.value,'$.replacement_journal_id') AS INTEGER),manual.currency,manual.amount
      FROM json_each(?) pair JOIN journal_entry_tag_amounts manual
        ON manual.journal_entry_id=CAST(json_extract(pair.value,'$.source_journal_id') AS INTEGER)`)
      .bind(serializedPairs),
  ];
}

async function insertDepreciationEntriesChunked(
  db: ReturnType<typeof createDb>,
  rows: {
    schedule_id: number;
    journal_entry_id: number;
    month_number: number;
  }[],
) {
  // D1 is sensitive to large parameterized multi-row inserts.
  const chunkSize = 30;
  for (let i = 0; i < rows.length; i += chunkSize) {
    await db
      .insert(depreciationEntries)
      .values(rows.slice(i, i + chunkSize));
  }
}

function toBudgetSnapshot(
  summary: Awaited<ReturnType<typeof computeBudgetSummaryForDate>>,
  totalResources: number,
  reimbursedAmount: number,
  remainingAmount: number,
): DepreciationBudgetSnapshot {
  const balances = summary.categories.map(row => row.available);
  const unallocated = totalResources - balances.reduce((sum,balance) => sum+balance,0);
  const deficit = balances.reduce((sum,balance) => sum+Math.max(-balance,0),0);
  return {
    T: totalResources,
    U: unallocated,
    D: deficit,
    allocatable: unallocated-deficit,
    categories: summary.categories.map((row) => ({
      id: row.category.id,
      name: row.category.name,
      balance: row.available,
    })),
    reimbursed_amount: reimbursedAmount,
    remaining_amount: remainingAmount,
  };
}

async function hashPreviewToken(value: unknown) {
  const bytes = new TextEncoder().encode(stableSerialize(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function linkedAllocationIds(db: ReturnType<typeof createDb>, schedule: DepreciationScheduleRow) {
  const entryRows = await db
    .select({ journal_entry_id: depreciationEntries.journal_entry_id, month_number: depreciationEntries.month_number })
    .from(depreciationEntries)
    .where(eq(depreciationEntries.schedule_id, schedule.id));
  const entryIds = entryRows.map((row) => row.journal_entry_id);
  const entryChunks = chunkForD1InClause(entryIds);
  const safeRows = await db
    .select({ id: journalEntryBudgetAllocations.id })
    .from(journalEntryBudgetAllocations)
    .where(and(
      eq(journalEntryBudgetAllocations.journal_entry_id, schedule.source_journal_entry_id),
      eq(journalEntryBudgetAllocations.source, "depreciation"),
    ));
  const monthlyRows = (await Promise.all(entryChunks.map(chunk=>db.select()
      .from(journalEntryBudgetAllocations)
      .where(inArray(journalEntryBudgetAllocations.journal_entry_id, chunk))))).flat();

  const recognizedLegacyMonthlyAllocationIds = new Set<number>();
  // Old generation omitted allocation source, but NULL is also used by manual entries.
  // Whitelist only whole monthly bundles with matching journal and allocation evidence;
  // all other NULL-source rows remain ambiguous and the original rows are audited on apply.
  if (schedule.budget_method === null && schedule.budget_settings === null && entryChunks.length > 0) {
    const [ownershipRows, purchaseOwnerRows, headerRows, lineRows] = await Promise.all([
      Promise.all(entryChunks.map((chunk) => db.select({ journal_entry_id: depreciationEntries.journal_entry_id })
        .from(depreciationEntries)
        .where(inArray(depreciationEntries.journal_entry_id, chunk)))).then((chunks) => chunks.flat()),
      Promise.all(entryChunks.map((chunk) => db.select({ source_journal_entry_id: depreciationSchedules.source_journal_entry_id })
        .from(depreciationSchedules)
        .where(inArray(depreciationSchedules.source_journal_entry_id, chunk)))).then((chunks) => chunks.flat()),
      Promise.all(entryChunks.map((chunk) => db.select({
        id: journalEntries.id,
        date: journalEntries.date,
        source: journalEntries.source,
        created_at: journalEntries.created_at,
      }).from(journalEntries).where(inArray(journalEntries.id, chunk)))).then((chunks) => chunks.flat()),
      Promise.all(entryChunks.map((chunk) => db.select({
        journal_entry_id: journalLines.journal_entry_id,
        account_id: journalLines.account_id,
        debit: journalLines.debit,
        credit: journalLines.credit,
        currency: journalLines.currency,
        created_at: journalLines.created_at,
      }).from(journalLines).where(inArray(journalLines.journal_entry_id, chunk)))).then((chunks) => chunks.flat()),
    ]);
    const currency = schedule.budget_currency || "JPY";
    const ownershipCountByEntry = new Map<number, number>();
    for (const row of ownershipRows) {
      ownershipCountByEntry.set(row.journal_entry_id, (ownershipCountByEntry.get(row.journal_entry_id) ?? 0) + 1);
    }
    const purchaseOwnedEntries = new Set(purchaseOwnerRows.map((row) => row.source_journal_entry_id));
    const headersById = new Map(headerRows.map((row) => [row.id, row]));
    const linesByEntry = new Map<number, typeof lineRows>();
    for (const row of lineRows) {
      const rows = linesByEntry.get(row.journal_entry_id) ?? [];
      rows.push(row);
      linesByEntry.set(row.journal_entry_id, rows);
    }
    const allocationsByEntry = new Map<number, typeof monthlyRows>();
    for (const row of monthlyRows) {
      const rows = allocationsByEntry.get(row.journal_entry_id) ?? [];
      rows.push(row);
      allocationsByEntry.set(row.journal_entry_id, rows);
    }
    const monthCount = new Map<number, number>();
    for (const row of entryRows) {
      monthCount.set(row.month_number, (monthCount.get(row.month_number) ?? 0) + 1);
    }
    const startDate = /^\d{4}-\d{2}-\d{2}$/.test(schedule.start_date)
      ? new Date(`${schedule.start_date}T00:00:00.000Z`)
      : null;
    const validStartDate = startDate && !Number.isNaN(startDate.getTime()) &&
      startDate.toISOString().slice(0, 10) === schedule.start_date;

    for (const link of entryRows) {
      const { journal_entry_id: entryId, month_number: monthNumber } = link;
      if (!validStartDate || !Number.isSafeInteger(monthNumber) || monthNumber < 1 ||
          monthNumber > schedule.months || monthCount.get(monthNumber) !== 1 ||
          ownershipCountByEntry.get(entryId) !== 1 || purchaseOwnedEntries.has(entryId)) continue;

      const expectedDate = monthNumber === 1
        ? schedule.start_date
        : firstOfMonth(schedule.start_date, monthNumber - 1);
      const header = headersById.get(entryId);
      const lines = linesByEntry.get(entryId) ?? [];
      const allocations = allocationsByEntry.get(entryId) ?? [];
      if (!header || header.source !== null || header.date !== expectedDate || lines.length !== 2 || allocations.length === 0) continue;
      if (lines.some((line) => line.currency !== currency || line.created_at !== header.created_at ||
          !Number.isSafeInteger(line.debit) || !Number.isSafeInteger(line.credit))) continue;

      const expenseLines = lines.filter((line) => line.account_id === schedule.expense_account_id && line.debit > 0 && line.credit === 0);
      const assetLines = lines.filter((line) => line.account_id === schedule.asset_account_id && line.debit === 0 && line.credit > 0);
      if (expenseLines.length !== 1 || assetLines.length !== 1 ||
          expenseLines[0]!.debit !== assetLines[0]!.credit) continue;
      const expenseAmount = expenseLines[0]!.debit;

      const categories = new Set<number>();
      let allocationTotal = 0;
      let validAllocations = true;
      for (const allocation of allocations) {
        if (allocation.source !== null || allocation.is_reference !== 0 ||
            allocation.currency !== currency || allocation.created_at !== header.created_at ||
            !Number.isSafeInteger(allocation.amount) || allocation.amount > 0 ||
            !Number.isSafeInteger(allocation.budget_category_id) || categories.has(allocation.budget_category_id)) {
          validAllocations = false;
          break;
        }
        categories.add(allocation.budget_category_id);
        allocationTotal += allocation.amount;
        if (!Number.isSafeInteger(allocationTotal)) {
          validAllocations = false;
          break;
        }
      }
      if (!validAllocations || allocationTotal !== -expenseAmount) continue;

      for (const allocation of allocations) recognizedLegacyMonthlyAllocationIds.add(allocation.id);
    }
  }
  const ambiguousRows = (await Promise.all(chunkForD1InClause([...entryIds,schedule.source_journal_entry_id]).map(chunk=>db.select({ id: journalEntryBudgetAllocations.id })
      .from(journalEntryBudgetAllocations)
      .where(and(
        inArray(journalEntryBudgetAllocations.journal_entry_id, chunk),
        sql`${journalEntryBudgetAllocations.amount} <> 0`,
        sql`COALESCE(${journalEntryBudgetAllocations.source}, '') <> 'depreciation'`,
      ))))).flat();
  return {
    entryIds,
    safeIds: [...safeRows, ...monthlyRows.filter((row) => row.source === "depreciation" || recognizedLegacyMonthlyAllocationIds.has(row.id))]
      .map((row) => row.id),
    ambiguousCount: ambiguousRows.filter((row) => !recognizedLegacyMonthlyAllocationIds.has(row.id)).length,
  };
}

async function findRelevantResetBoundaries(
  c: RouteContext,
  schedule: DepreciationScheduleRow,
  settings: DepreciationBudgetSettings,
  readDB: D1Database = c.env.DB,
): Promise<DepreciationBudgetBoundary[]> {
  if(settings.method==="unallocated")return [];
  const currency = schedule.budget_currency || "JPY";
  const today = toLocalDateString();
  const resetRows = await readDB.prepare(`SELECT l.id,l.budget_category_id,l.amount,l.date,l.created_at,c.name,l.reset_scope,l.reset_group_key
    FROM budget_adjustment_logs l JOIN budget_categories c ON c.id=l.budget_category_id
    WHERE l.adjustment_type='reset' AND l.currency=? AND l.date>=? AND l.date<=?
    ORDER BY l.date,l.created_at,l.id`).bind(currency, schedule.start_date, today).all<{
      id: number; budget_category_id: number; amount: number; date: string; created_at: string; name: string;
      reset_scope:"category"|"all"|null;reset_group_key:string|null;
    }>();
  const rows = resetRows.results ?? [];
  const groupKey=(row:typeof rows[number])=>row.reset_group_key??`${row.date}/${row.created_at}`;
  const groups=new Map<string,typeof rows>();
  for(const row of rows)groups.set(groupKey(row),[...groups.get(groupKey(row))??[],row]);
  const decisionById = new Map((settings.reset_decisions ?? []).map((decision) => [decision.reset_log_id, decision]));
  const [journalEventRows, ownedEventRows] = await Promise.all([
    readDB.prepare(`SELECT date,created_at FROM journal_entries WHERE id=?
      UNION ALL
      SELECT je.date,je.created_at FROM depreciation_entries de
      JOIN journal_entries je ON je.id=de.journal_entry_id WHERE de.schedule_id=?`)
      .bind(schedule.source_journal_entry_id, schedule.id).all<{ date: string; created_at: string }>(),
    readDB.prepare(`SELECT date,created_at FROM budget_adjustment_logs
      WHERE depreciation_schedule_id=? AND depreciation_event_key IS NOT NULL`)
      .bind(schedule.id).all<{ date: string; created_at: string }>(),
  ]);
  const timestampsByDate = (events: readonly { date: string; created_at: string }[]) => {
    const byDate = new Map<string, Set<string>>();
    for (const event of events) {
      const timestamps = byDate.get(event.date) ?? new Set<string>();
      timestamps.add(event.created_at);
      byDate.set(event.date, timestamps);
    }
    return byDate;
  };
  const journalTimestamps = timestampsByDate(journalEventRows.results ?? []);
  const ownedTimestamps = timestampsByDate(ownedEventRows.results ?? []);
  const boundaries: DepreciationBudgetBoundary[] = [];
  for (const row of rows) {
    const group=groups.get(groupKey(row))!;
    const groupDecision=group.map(item=>decisionById.get(item.id)).find(decision=>decision?.scope);
    // A shared timestamp is only a candidate. Current category counts cannot
    // establish the intent or scope of a historical reset.
    const isGlobal=groupDecision?.scope==="all" || (!groupDecision?.scope&&group.some(item=>item.reset_scope==="all"));
    const scopeUnknown=settings.method==="special"&&new Set(group.map(item=>item.budget_category_id)).size>1&&group.every(item=>item.reset_scope==null)&&!groupDecision?.scope;
    if((isGlobal||scopeUnknown)&&row.id!==group[0]!.id)continue;
    let sourceAllocations=resolveDepreciationMonthlySourceAllocations(settings);
    let destination=settings.method==="special"?schedule.budget_special_category_id??-schedule.id:settings.purchase_category_id??null;
    for(const route of [...settings.routing_changes??[]].sort((a,b)=>a.date.localeCompare(b.date))) {
      if(route.date>row.date)break;
      sourceAllocations=resolveDepreciationMonthlySourceAllocations(
        route.monthly_source_allocations!==undefined||route.monthly_source_category_id!=null?route:settings,
      );
      destination=route.destination_category_id;
    }
    const relevant=isGlobal||scopeUnknown||
      sourceAllocations.some(allocation=>allocation.budget_category_id===row.budget_category_id&&allocation.ratio>0)||
      row.budget_category_id===destination;
    if(!relevant)continue;
    const decision=decisionById.get(row.id)??(isGlobal?groupDecision:undefined);
    const requiredAction=settings.method==="special"?"carry_or_settle":"continue_or_end";
    const ambiguousOrder = journalTimestamps.get(row.date)?.has(row.created_at) === true ||
      ownedTimestamps.get(row.date)?.has(row.created_at) === true;
    const needsOrder = ambiguousOrder && !decision?.same_day_order;
    boundaries.push({
      reset_log_id: row.id,
      date: row.date,
      category_id: isGlobal&&settings.method==="special"?destination??row.budget_category_id:row.budget_category_id,
      category_name: row.name,
      scope: isGlobal ? "all" : "category",
      scope_confirmation_required:scopeUnknown,
      action_kind:requiredAction,
      required_action: needsOrder ? "order" : requiredAction,
      old_reset_amount: row.amount,
      new_reset_amount: row.amount,
    });
  }
  return boundaries;
}

async function buildDepreciationBudgetPreview(
  c: RouteContext,
  schedule: DepreciationScheduleRow,
  rawSettings: DepreciationBudgetSettings,
): Promise<DepreciationBudgetPreview & {
  _revision: number;
  _expectedRows: Awaited<ReturnType<typeof buildOwnedDepreciationBudgetRows>>;
  _allocationIds: number[];
  _legacyReservations: typeof depreciationBudgetReservations.$inferSelect[];
  _legacyAllocations: typeof journalEntryBudgetAllocations.$inferSelect[];
}> {
  const globalRevision = await getDepreciationBudgetRevision(c.env.DB);
  const readDB = createRequestScopedD1ReadMemo(c.env.DB);
  const db = createDb({ ...c.env, DB: readDB });
  const [currentSchedule] = await db.select().from(depreciationSchedules).where(eq(depreciationSchedules.id,schedule.id));
  if (!currentSchedule || stableSerialize(currentSchedule) !== stableSerialize(schedule)) throw new Error("stale_depreciation_budget_preview");
  const settings = normalizeDepreciationBudgetSettings(rawSettings);
  let validationError = await validateBudgetCategoryIds(db, settings);
  if ((settings.routing_changes ?? []).some((route) => route.date < schedule.start_date)) {
    validationError ??= "routing_change_before_purchase";
  }
  const boundaries = await findRelevantResetBoundaries(c, schedule, settings, readDB);
  const missingDecisions = boundaries.some((boundary) => {
    const decision = settings.reset_decisions?.find((row) => row.reset_log_id === boundary.reset_log_id);
    if (!decision) return true;
    const validAction = boundary.action_kind === "carry_or_settle"
      ? ["carry", "settle"].includes(decision.action)
      : ["continue", "end"].includes(decision.action);
    return !validAction || (boundary.scope_confirmation_required&&!decision.scope) ||
      (boundary.required_action === "order" && !decision.same_day_order);
  });
  const scales = await getBudgetScaleOptions(db);
  const targetAmount = await getDepreciationPurchaseTarget(db, schedule);
  const specialCategoryId = schedule.budget_special_category_id ?? (settings.method === "special" ? -schedule.id : null);
  if(settings.method==="special"&&specialCategoryId!=null) {
    const baseSources=resolveDepreciationMonthlySourceAllocations(settings);
    if(baseSources.some(allocation=>allocation.ratio>0&&allocation.budget_category_id===specialCategoryId))
      validationError??="source_and_destination_must_differ";
    for(const route of settings.routing_changes??[]) {
      const routeSources=resolveDepreciationMonthlySourceAllocations(
        route.monthly_source_allocations!==undefined||route.monthly_source_category_id!=null?route:settings,
      );
      if(routeSources.some(allocation=>allocation.ratio>0&&allocation.budget_category_id===route.destination_category_id))
        validationError??="source_and_destination_must_differ";
    }
  }
  const expectedRows = await buildOwnedDepreciationBudgetRows(
    db, schedule, settings, targetAmount, specialCategoryId, scales,
  );
  const today = toLocalDateString();
  const futureIds = [...new Set(expectedRows.filter((row) => row.date >= today)
    .map((row) => row.budget_category_id).filter((id) => id > 0))];
  if (futureIds.length) {
    const futureCategories = await db.select({ is_archived: budgetCategories.is_archived })
      .from(budgetCategories).where(inArray(budgetCategories.id, futureIds));
    if (futureCategories.some((row) => row.is_archived === 1)) validationError ??= "budget_category_archived";
  }
  const allocations = await linkedAllocationIds(db, schedule);
  const currentOwned = await getOwnedBudgetRows(db, schedule.id);
  const [legacyReservations, legacyAllocations] = await Promise.all([
    db.select().from(depreciationBudgetReservations)
      .where(eq(depreciationBudgetReservations.schedule_id, schedule.id)),
    (await Promise.all(chunkForD1InClause(allocations.safeIds).map((chunk) =>
      db.select().from(journalEntryBudgetAllocations).where(inArray(journalEntryBudgetAllocations.id, chunk)),
    ))).flat(),
  ]);
  const previewAuditBytes = new TextEncoder().encode(JSON.stringify({
    schedule_id: schedule.id,
    revision: schedule.budget_revision + 1,
    action: "apply",
    request_key: "x".repeat(64),
    before_settings: schedule.budget_settings,
    after_settings: JSON.stringify(settings),
    before_events: JSON.stringify({
      owned: currentOwned,
      legacy_reservations: legacyReservations,
      legacy_allocations: legacyAllocations,
    }),
    after_events: JSON.stringify(expectedRows),
    created_at: "2026-10-19 00:00:00",
  })).byteLength;
  const auditTooLarge = previewAuditBytes > DEPRECIATION_BUDGET_AUDIT_ROW_MAX_BYTES;
  const changes = diffOwnedDepreciationBudgetRows(currentOwned, expectedRows, settings.method);
  const storedProgress = await getDepreciationBudgetProgress(db, schedule, scales);
  const projectedReceipts = expectedRows.filter((row) =>
    row.depreciation_event_side === "destination" &&
    (row.depreciation_event_key.startsWith("monthly:") || row.depreciation_event_key.startsWith("settlement:")) &&
    row.amount > 0,
  );
  const reimbursedUnits = projectedReceipts
    .filter((row) => row.date <= today)
    .reduce((sum, row) => sum + row.amount, 0);
  const futureUnits = projectedReceipts
    .filter((row) => row.date > today)
    .reduce((sum, row) => sum + row.amount, 0);
  const reimbursedAmount = fromStorageMoneyAmount(Math.min(targetAmount, reimbursedUnits), schedule.budget_currency || "JPY", scales);
  const remainingAmount = settings.method === "unallocated"
    ? 0
    : fromStorageMoneyAmount(Math.max(0, targetAmount - Math.min(targetAmount, reimbursedUnits)), schedule.budget_currency || "JPY", scales);
  const selectedEndIds=(settings.reset_decisions??[]).filter(row=>row.action==="end"||row.action==="settle").map(row=>row.reset_log_id);
  const stoppedByReset=selectedEndIds.length>0&&!!await c.env.DB.prepare(`SELECT id FROM budget_adjustment_logs
    WHERE id IN (${selectedEndIds.map(()=>"?").join(",")}) AND date<=? LIMIT 1`).bind(...selectedEndIds,today).first();
  const budgetEnded=!!(settings.end_date&&settings.end_date<=today)||stoppedByReset;
  const progress = {
    ...storedProgress,
    method: settings.method,
    purchase_category_id: settings.purchase_category_id ?? null,
    monthly_source_category_id: settings.monthly_source_category_id ?? null,
    destination_category_id: settings.method === "special"
      ? (specialCategoryId != null && specialCategoryId > 0 ? specialCategoryId : null)
      : settings.purchase_category_id ?? null,
    target_amount: fromStorageMoneyAmount(targetAmount, schedule.budget_currency || "JPY", scales),
    reimbursed_amount: reimbursedAmount,
    remaining_amount: remainingAmount,
    ended_unreimbursed_amount: budgetEnded ? remainingAmount : 0,
    future_amount: fromStorageMoneyAmount(futureUnits, schedule.budget_currency || "JPY", scales),
    status: settings.method === "unallocated" || remainingAmount <= 0
      ? "completed" as const
      : budgetEnded ? "ended" as const : "active" as const,
    settings,
  };
  const allLogs = await db.select().from(budgetAdjustmentLogs);
  const replacementLogs = [
    ...allLogs.filter((row) => row.depreciation_schedule_id !== schedule.id),
    ...expectedRows.map((row, index) => ({
      id: -1000000 - index,
      note: null,
      created_at: row.created_at ?? schedule.created_at,
      ...row,
      budget_category_id: row.special_category
        ? schedule.budget_special_category_id ?? -schedule.id
        : row.budget_category_id,
    })),
  ] as unknown as typeof allLogs;
  const extraCategories = settings.method === "special" && !schedule.budget_special_category_id
    ? [{
        id: -schedule.id, name: `予算分割振替（減価償却） ${schedule.id}`, sort_order: 0, rollover_months: -1,
        budget_group: "予算分割振替（減価償却）", goal_balance: null, balance_cap: null,
        overflow_budget_category_id: null, is_archived: 0, created_at: schedule.created_at,
      } as typeof budgetCategories.$inferSelect]
    : [];
  const sourceEntry = await db.select().from(journalEntries).where(eq(journalEntries.id,schedule.source_journal_entry_id));
  const resetRows = allLogs.filter(row => boundaries.some(boundary => boundary.reset_log_id === row.id));
  const points = [
    {date:schedule.start_date,created_at:sourceEntry[0]?.created_at ?? schedule.created_at,label:"purchase",reset_log_id:undefined as number|undefined},
    ...resetRows.map(row=>({date:row.date,created_at:row.created_at,label:"reset",reset_log_id:row.id})),
    ...(settings.routing_changes??[]).filter(row=>row.date<=today).map(row=>({date:row.date,created_at:"\uffff",label:"routing",reset_log_id:undefined as number|undefined})),
    {date:today,created_at:"\uffff",label:"current",reset_log_id:undefined as number|undefined},
  ].sort((a,b)=>a.date.localeCompare(b.date)||a.created_at.localeCompare(b.created_at));
  const ledgerAccounts = await db.select().from(accounts);
  const ledgerLines = await db.select({account_id:journalLines.account_id,debit:journalLines.debit,credit:journalLines.credit,
    currency:journalLines.currency,date:journalEntries.date,created_at:journalEntries.created_at})
    .from(journalLines).innerJoin(journalEntries,eq(journalEntries.id,journalLines.journal_entry_id));
  const visibleAt = (row:{date:string;created_at?:string|null},point:{date:string;created_at:string}) =>
    row.date<point.date || (row.date===point.date && (row.created_at??schedule.created_at)<=point.created_at);
  function receiptsAt(rows:typeof currentOwned, point:{date:string;created_at:string},receiptSettings:DepreciationBudgetSettings) {
    return [...getDepreciationBudgetReceiptGroups(rows, receiptSettings, schedule).values()]
      .filter((receipt) => visibleAt(receipt, point))
      .reduce((sum, receipt) => sum + receipt.amount, 0);
  }
  const timeline: DepreciationBudgetPreview["timeline"] = [];
  for (const point of points) {
    const {date}=point;
    const currentSummary = await computeBudgetSummaryForDate(db, date, schedule.budget_currency || "JPY", {
      through: point,
    });
    const simulatedSummary = await computeBudgetSummaryForDate(db, date, schedule.budget_currency || "JPY", {
      adjustmentLogs: replacementLogs,
      extraCategories,
      excludeLegacyScheduleId: schedule.id,
      excludeAllocationIds: allocations.safeIds,
      through: point,
    });
    const T=fromStorageMoneyAmount(budgetAccountDelta(ledgerLines.filter(row=>visibleAt(row,point)),ledgerAccounts,schedule.budget_currency||"JPY"),schedule.budget_currency||"JPY",scales);
    const beforeReceipts=receiptsAt(currentOwned,point,schedule.budget_settings?JSON.parse(schedule.budget_settings) as DepreciationBudgetSettings:{method:"unallocated"});
    const afterReceipts=receiptsAt(expectedRows as typeof currentOwned,point,settings);
    const units=(amount:number)=>fromStorageMoneyAmount(amount,schedule.budget_currency||"JPY",scales);
    timeline.push({
      date,
      label:point.label,
      created_at:point.created_at==="\uffff"?undefined:point.created_at,
      reset_log_id:point.reset_log_id,
      before: toBudgetSnapshot(currentSummary,T,units(beforeReceipts),schedule.budget_method==="unallocated"?0:units(Math.max(0,targetAmount-beforeReceipts))),
      after: toBudgetSnapshot(simulatedSummary,T,units(afterReceipts),settings.method==="unallocated"?0:units(Math.max(0,targetAmount-afterReceipts))),
    });
  }
  for(const boundary of boundaries) {
    const reset=allLogs.find(row=>row.id===boundary.reset_log_id);
    if(!reset)continue;
    const through={date:reset.date,created_at:reset.created_at};
    const oldBefore=await computeBudgetSummaryForDate(db,reset.date,schedule.budget_currency||"JPY",{adjustmentLogs:allLogs.filter(row=>row.id!==reset.id),through});
    const newBefore=await computeBudgetSummaryForDate(db,reset.date,schedule.budget_currency||"JPY",{adjustmentLogs:replacementLogs.filter(row=>row.id!==reset.id),extraCategories,
      excludeLegacyScheduleId:schedule.id,excludeAllocationIds:allocations.safeIds,through});
    boundary.old_reset_amount=-(oldBefore.categories.find(row=>row.category.id===reset.budget_category_id)?.available??0);
    boundary.new_reset_amount=-(newBefore.categories.find(row=>row.category.id===reset.budget_category_id)?.available??0);
  }
  const warnings = [
    ...(validationError ? [validationError] : []),
    ...(missingDecisions ? ["reset_decision_required"] : []),
    ...(allocations.ambiguousCount ? ["ambiguous_legacy_allocations"] : []),
    ...(settings.method === "unallocated" && !settings.confirm_unallocated ? ["unallocated_confirm_required"] : []),
    ...(auditTooLarge ? ["depreciation_budget_plan_too_large"] : []),
  ];
  const canApply = !validationError && !missingDecisions && allocations.ambiguousCount === 0 && !auditTooLarge;
  const token = await hashPreviewToken({
    scheduleId: schedule.id,
    scheduleRevision: schedule.budget_revision,
    globalRevision,
    sourceJournalId: schedule.source_journal_entry_id,
    targetAmount,
    settings,
    expectedRows,
    timeline,
    boundaries,
  });
  if (globalRevision !== await getDepreciationBudgetRevision(c.env.DB)) throw new Error("stale_depreciation_budget_preview");
  return {
    schedule_id: schedule.id,
    token,
    settings,
    progress,
    boundaries,
    timeline,
    changes,
    warnings,
    can_apply: canApply,
    _revision: globalRevision,
    _expectedRows: expectedRows,
    _allocationIds: allocations.safeIds,
    _legacyReservations: legacyReservations,
    _legacyAllocations: legacyAllocations,
  };
}

type DepreciationCreateBody = {
  purchase_date: string;
  description: string;
  asset_account_id: number;
  payment_account_id: number;
  expense_account_id: number;
  total_amount: number;
  months: number;
  currency?: string;
  purchase_lines?: Array<{
    account_id: number;
    debit: number;
    credit: number;
    currency?: string;
    credit_card_billing_offset_months?: number | null;
  }>;
  budget_settings?: DepreciationBudgetSettings;
  idempotency_key?: string;
};

async function nextJournalEntryId(DB: D1Database): Promise<number> {
  const row = await DB.prepare(`SELECT MAX(
    COALESCE((SELECT MAX(id) FROM journal_entries), 0),
    COALESCE((SELECT seq FROM sqlite_sequence WHERE name='journal_entries'), 0)
  ) AS max_id`).first<{ max_id: number }>();
  return (row?.max_id ?? 0) + 1;
}

async function createConfiguredDepreciation(c: RouteContext, body: DepreciationCreateBody) {
  const currency = (body.currency || "JPY").toUpperCase();
  if (!body.budget_settings) return c.json({ error: "budget_settings_required" }, 400);
  if (!body.idempotency_key || body.idempotency_key.length > 200) {
    return c.json({ error: "idempotency_key_required" }, 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.purchase_date) || !Number.isSafeInteger(body.months) || body.months < 1 || body.months > 600 ||
    !body.description || !body.asset_account_id || !body.payment_account_id || !body.expense_account_id) {
    return c.json({ error: "invalid_depreciation_fields" }, 400);
  }
  const db = createDb(c.env);
  // Every lookup below contributes to the accounting plan. The guard at the
  // head of the write batch makes sure none of those inputs changed meanwhile.
  const sourceRevision = await getDepreciationBudgetRevision(c.env.DB);
  const existing = await db.select().from(depreciationSchedules)
    .where(eq(depreciationSchedules.budget_idempotency_key, body.idempotency_key));
  if (existing[0]) {
    const [prior] = await db.select().from(depreciationBudgetRevisions).where(and(
      eq(depreciationBudgetRevisions.schedule_id, existing[0].id),
      eq(depreciationBudgetRevisions.action, "create"),
    ));
    const priorRequest = prior?.after_events ? (JSON.parse(prior.after_events) as { request?: string }).request : null;
    if (priorRequest !== stableSerialize(body)) return c.json({ error: "idempotency_conflict" }, 409);
    return c.json({ schedule_id: existing[0].id, source_journal_entry_id: existing[0].source_journal_entry_id, replayed: true });
  }
  const scales = await getBudgetScaleOptions(db);
  let totalAmount: number;
  try {
    totalAmount = toStorageMoneyAmount(body.total_amount, currency, scales);
  } catch {
    return c.json(invalidMoneyResponse("total_amount", currency), 400);
  }
  if (totalAmount <= 0) return c.json({ error: "invalid_depreciation_fields" }, 400);
  const settings = normalizeDepreciationBudgetSettings(body.budget_settings);
  const settingsError = await validateBudgetCategoryIds(db, settings);
  if (settingsError) return c.json({ error: settingsError }, 400);
  if ((settings.settlements?.length ?? 0) > 0 || (settings.reset_decisions?.length ?? 0) > 0 || settings.end_date) {
    return c.json({ error: "historical_budget_decisions_not_valid_on_create" }, 400);
  }
  if ((settings.routing_changes ?? []).some((route) => route.date < body.purchase_date)) {
    return c.json({ error: "routing_change_before_purchase" }, 400);
  }

  if (body.purchase_lines !== undefined && !Array.isArray(body.purchase_lines)) {
    return c.json({ error: "invalid_purchase_lines" }, 400);
  }
  const purchaseLines = body.purchase_lines === undefined
    ? [{ account_id: body.asset_account_id, debit: body.total_amount, credit: 0, currency },
      { account_id: body.payment_account_id, debit: 0, credit: body.total_amount, currency }]
    : body.purchase_lines;
  if (purchaseLines.length < 2 || purchaseLines.some((line) => !Number.isSafeInteger(line.account_id) || line.account_id <= 0 ||
    typeof line.debit !== "number" || typeof line.credit !== "number")) {
    return c.json({ error: "invalid_purchase_lines" }, 400);
  }
  const normalizedPurchaseLines = purchaseLines.map((line) => ({
    ...line,
    currency: (line.currency ?? currency).toUpperCase(),
  }));
  if (normalizedPurchaseLines.some((line) => line.currency !== currency)) {
    return c.json({ error: "purchase_lines_currency_mismatch" }, 400);
  }
  if (normalizedPurchaseLines.some((line) => line.credit_card_billing_offset_months != null &&
    (!Number.isSafeInteger(line.credit_card_billing_offset_months) || line.credit_card_billing_offset_months < 0))) {
    return c.json({ error: "invalid_credit_card_billing_offset" }, 400);
  }
  const lineMoneyError = findInvalidMoneyField(normalizedPurchaseLines.flatMap((line, index) => [
    { path: `purchase_lines[${index}].debit`, value: line.debit, currency },
    { path: `purchase_lines[${index}].credit`, value: line.credit, currency },
  ]));
  if (lineMoneyError) return c.json(invalidMoneyResponse(lineMoneyError, currency), 400);
  const balanceError = journalBalanceError(normalizedPurchaseLines, false, scales);
  if (balanceError) return c.json({ error: "invalid_purchase_journal", detail: balanceError }, 400);

  const accountIds = [...new Set([
    body.asset_account_id, body.payment_account_id, body.expense_account_id,
    ...normalizedPurchaseLines.map((line) => line.account_id),
  ])];
  const selectedAccounts = await db.select().from(accounts).where(inArray(accounts.id, accountIds));
  if (selectedAccounts.length !== accountIds.length) return c.json({ error: "account_not_found" }, 400);
  const assetAccount = selectedAccounts.find((account) => account.id === body.asset_account_id);
  const expenseAccount = selectedAccounts.find((account) => account.id === body.expense_account_id);
  if (assetAccount?.type !== "asset") return c.json({ error: "asset_account_must_be_asset" }, 400);
  if (isBudgetAccount(assetAccount)) return c.json({ error: "invalid_depreciation_asset_account" }, 400);
  if (expenseAccount?.type !== "expense") return c.json({ error: "expense_account_must_be_expense" }, 400);
  const storagePurchaseLines = normalizedPurchaseLines.map((line) => ({
    account_id: line.account_id,
    debit: toStorageMoneyAmount(line.debit, currency, scales),
    credit: toStorageMoneyAmount(line.credit, currency, scales),
    currency,
  }));
  const assetAcquisition = storagePurchaseLines.reduce((total, line) => total +
    (line.account_id === body.asset_account_id ? line.debit - line.credit : 0), 0);
  if (assetAcquisition < totalAmount) return c.json({ error: "purchase_asset_basis_insufficient" }, 400);
  const targetAmount = Math.min(
    Math.max(0, -budgetAccountDelta(storagePurchaseLines, selectedAccounts, currency)),
    totalAmount,
  );
  const monthlyAmounts = computeMonthlyAmounts(totalAmount, body.months, body.purchase_date);
  const createdAt = new Date().toISOString().replace("T", " ").slice(0, 19);
  const entryDates = monthlyAmounts.map((_, index) => index === 0 ? body.purchase_date : firstOfMonth(body.purchase_date, index));
  const syntheticSchedule = {
    id: -1,
    source_journal_entry_id: -1,
    asset_account_id: body.asset_account_id,
    expense_account_id: body.expense_account_id,
    total_amount: totalAmount,
    months: body.months,
    start_date: body.purchase_date,
    description: body.description,
    created_at: createdAt,
    budget_method: settings.method,
    budget_settings: JSON.stringify(settings),
    budget_revision: 1,
    budget_special_category_id: null,
    budget_target_amount: targetAmount,
    budget_currency: currency,
    budget_idempotency_key: body.idempotency_key,
  } as DepreciationScheduleRow;
  const expectedRows = await buildOwnedDepreciationBudgetRows(
    db,
    syntheticSchedule,
    settings,
    targetAmount,
    settings.method === "special" ? -1 : null,
    scales,
    {
      purchaseCreatedAt: createdAt,
      months: monthlyAmounts.map((amount, index) => ({
        journal_entry_id: null,
        month_number: index + 1,
        date: entryDates[index]!,
        created_at: createdAt,
        amount,
      })),
    },
  );
  const today = toLocalDateString();
  const futureCategoryIds = [...new Set(expectedRows
    .filter((row) => row.date >= today && row.budget_category_id > 0)
    .map((row) => row.budget_category_id))];
  if (futureCategoryIds.length) {
    const futureCategories = await db.select({ is_archived: budgetCategories.is_archived })
      .from(budgetCategories).where(inArray(budgetCategories.id, futureCategoryIds));
    if (futureCategories.some((row) => row.is_archived === 1)) return c.json({ error: "budget_category_archived" }, 400);
  }

  const sourceJournalEntryId = await nextJournalEntryId(c.env.DB);
  const monthJournalEntryIds = monthlyAmounts.map((_, index) => sourceJournalEntryId + index + 1);
  const persistedExpectedRows = expectedRows.map((row) => {
    const month = /^monthly:(\d+)(?::(?:category:\d+|unallocated))?$/.exec(row.depreciation_event_key);
    return {
      ...row,
      journal_entry_id: row.depreciation_event_key.startsWith("purchase:")
        ? sourceJournalEntryId
        : month ? monthJournalEntryIds[Number(month[1]) - 1] ?? null : row.journal_entry_id,
    };
  });
  const createAfterEvents = JSON.stringify({
    request: stableSerialize(body), targetAmount, events: persistedExpectedRows,
  });
  if (!depreciationBudgetAuditRowFits({
    schedule_id: sourceJournalEntryId,
    revision: 1,
    action: "create",
    request_key: body.idempotency_key,
    before_settings: null,
    after_settings: JSON.stringify(settings),
    before_events: "[]",
    after_events: createAfterEvents,
    created_at: createdAt,
  })) return c.json({ error: "depreciation_budget_plan_too_large" }, 400);
  const statements: D1PreparedStatement[] = [
    ...buildDepreciationBudgetRevisionGuard(c.env.DB, sourceRevision),
  ];
  statements.push(c.env.DB.prepare("INSERT INTO journal_entries(id,date,description,created_at) VALUES(?,?,?,?)")
    .bind(sourceJournalEntryId, body.purchase_date, body.description, createdAt));
  statements.push(c.env.DB.prepare(`INSERT INTO depreciation_schedules
    (source_journal_entry_id,asset_account_id,expense_account_id,total_amount,months,start_date,description,
     budget_method,budget_settings,budget_revision,budget_target_amount,budget_currency,budget_idempotency_key)
    VALUES(?,?,?,?,?,?,?,?, ?,1,?,?,?)`).bind(
      sourceJournalEntryId, body.asset_account_id, body.expense_account_id, totalAmount, body.months, body.purchase_date,
      body.description, settings.method, JSON.stringify(settings), targetAmount, currency, body.idempotency_key,
    ));
  if (settings.method === "special") {
    statements.push(c.env.DB.prepare(`INSERT INTO budget_categories
      (name,sort_order,rollover_months,budget_group,is_archived) VALUES(?,0,-1,'予算分割振替（減価償却）',0)`)
      .bind(`予算分割振替（減価償却） ${body.idempotency_key.slice(0, 72)}`));
    statements.push(c.env.DB.prepare("UPDATE depreciation_schedules SET budget_special_category_id=last_insert_rowid() WHERE budget_idempotency_key=?")
      .bind(body.idempotency_key));
  }
  statements.push(c.env.DB.prepare(`INSERT INTO journal_lines
    (journal_entry_id,account_id,debit,credit,currency,credit_card_billing_offset_months)
    SELECT ?,CAST(json_extract(value,'$.account_id') AS INTEGER),
      CAST(json_extract(value,'$.debit') AS INTEGER),CAST(json_extract(value,'$.credit') AS INTEGER),
      json_extract(value,'$.currency'),json_extract(value,'$.credit_card_billing_offset_months')
    FROM json_each(?)`).bind(sourceJournalEntryId, JSON.stringify(storagePurchaseLines.map((line, index) => ({
      ...line,
      credit_card_billing_offset_months: normalizedPurchaseLines[index]!.credit_card_billing_offset_months ?? null,
    })))));
  const monthlyJournalRows = monthlyAmounts.map((_, index) => ({
    id: monthJournalEntryIds[index],
    date: entryDates[index],
    description: `${body.description} 予算分割振替（減価償却） (${index + 1}/${body.months}ヶ月)`,
    created_at: createdAt,
  }));
  statements.push(c.env.DB.prepare(`INSERT INTO journal_entries(id,date,description,created_at)
    SELECT CAST(json_extract(value,'$.id') AS INTEGER),json_extract(value,'$.date'),
      json_extract(value,'$.description'),json_extract(value,'$.created_at') FROM json_each(?)`)
    .bind(JSON.stringify(monthlyJournalRows)));
  statements.push(c.env.DB.prepare(`INSERT INTO depreciation_entries(schedule_id,journal_entry_id,month_number)
    SELECT (SELECT id FROM depreciation_schedules WHERE budget_idempotency_key=?),
      CAST(json_extract(value,'$.journal_entry_id') AS INTEGER),CAST(json_extract(value,'$.month_number') AS INTEGER)
    FROM json_each(?)`).bind(body.idempotency_key, JSON.stringify(monthJournalEntryIds.map((journal_entry_id, index) => ({
      journal_entry_id, month_number: index + 1,
    })))));
  const monthlyJournalLines = monthlyAmounts.flatMap((amount, index) => [
    { journal_entry_id: monthJournalEntryIds[index], account_id: body.expense_account_id, debit: amount, credit: 0, currency },
    { journal_entry_id: monthJournalEntryIds[index], account_id: body.asset_account_id, debit: 0, credit: amount, currency },
  ]);
  statements.push(c.env.DB.prepare(`INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency)
    SELECT CAST(json_extract(value,'$.journal_entry_id') AS INTEGER),CAST(json_extract(value,'$.account_id') AS INTEGER),
      CAST(json_extract(value,'$.debit') AS INTEGER),CAST(json_extract(value,'$.credit') AS INTEGER),json_extract(value,'$.currency')
    FROM json_each(?)`).bind(JSON.stringify(monthlyJournalLines)));
  for (const rowChunk of chunkForD1InClause(persistedExpectedRows, DEPRECIATION_BUDGET_LOG_CHUNK_SIZE)) {
    statements.push(c.env.DB.prepare(`INSERT INTO budget_adjustment_logs
      (budget_category_id,year_month,amount,currency,date,adjustment_type,journal_entry_id,
       depreciation_schedule_id,depreciation_event_key,depreciation_event_side,created_at)
      SELECT CASE WHEN json_extract(value,'$.special_category')=1
          THEN (SELECT budget_special_category_id FROM depreciation_schedules WHERE budget_idempotency_key=?)
          ELSE CAST(json_extract(value,'$.budget_category_id') AS INTEGER) END,
        json_extract(value,'$.year_month'),CAST(json_extract(value,'$.amount') AS INTEGER),
        json_extract(value,'$.currency'),json_extract(value,'$.date'),json_extract(value,'$.adjustment_type'),
        CAST(json_extract(value,'$.journal_entry_id') AS INTEGER),
        (SELECT id FROM depreciation_schedules WHERE budget_idempotency_key=?),
        json_extract(value,'$.depreciation_event_key'),json_extract(value,'$.depreciation_event_side'),
        json_extract(value,'$.created_at') FROM json_each(?)`)
      .bind(body.idempotency_key, body.idempotency_key, JSON.stringify(rowChunk)));
  }
  statements.push(c.env.DB.prepare(`INSERT INTO depreciation_budget_revisions
    (schedule_id,revision,action,request_key,before_settings,after_settings,before_events,after_events,created_at)
    VALUES((SELECT id FROM depreciation_schedules WHERE budget_idempotency_key=?),1,'create',?,NULL,?,?,?,?)`)
    .bind(body.idempotency_key, body.idempotency_key, JSON.stringify(settings), "[]", createAfterEvents, createdAt));

  try {
    await c.env.DB.batch(statements);
  } catch (error) {
    const sameRequest = await db.select().from(depreciationSchedules)
      .where(eq(depreciationSchedules.budget_idempotency_key, body.idempotency_key));
    if (sameRequest[0]) {
      const [prior] = await db.select().from(depreciationBudgetRevisions).where(and(
        eq(depreciationBudgetRevisions.schedule_id, sameRequest[0].id),
        eq(depreciationBudgetRevisions.action, "create"),
      ));
      const priorRequest = prior?.after_events ? (JSON.parse(prior.after_events) as { request?: string }).request : null;
      if (priorRequest !== stableSerialize(body)) return c.json({ error: "idempotency_conflict" }, 409);
      return c.json({ schedule_id: sameRequest[0].id, source_journal_entry_id: sameRequest[0].source_journal_entry_id, replayed: true });
    }
    if (String(error).includes("stale_depreciation_budget_preview")) {
      return c.json({ error: "stale_budget_snapshot" }, 409);
    }
    throw error;
  }
  const [schedule] = await db.select().from(depreciationSchedules)
    .where(eq(depreciationSchedules.budget_idempotency_key, body.idempotency_key));
  return c.json({
    schedule_id: schedule!.id,
    source_journal_entry_id: schedule!.source_journal_entry_id,
    monthly_amounts: monthlyAmounts.map((amount) => fromStorageMoneyAmount(amount, currency, scales)),
    entry_dates: entryDates,
    replayed: false,
  }, 201);
}
async function updateConfiguredDepreciation(
  c: RouteContext,
  schedule: DepreciationScheduleRow,
  body: {
    purchase_date?: string; description?: string; total_amount?: number; months?: number;
    asset_account_id?: number; expense_account_id?: number; payment_account_id?: number;
    currency?: string; budget_settings?: DepreciationBudgetSettings; idempotency_key?: string;
    purchase_lines?: Array<{
      account_id: number; debit: number; credit: number; currency?: string;
      credit_card_billing_offset_months?: number | null;
    }>;
  },
) {
  if (body.budget_settings) return c.json({ error: "budget_repair_required" }, 409);
  const currency = schedule.budget_currency || "JPY";
  if (body.currency && body.currency.toUpperCase() !== currency) return c.json({ error: "currency_change_requires_budget_repair" }, 409);
  const db = createDb(c.env);
  if (body.idempotency_key) {
    const [prior] = await db.select().from(depreciationBudgetRevisions).where(and(
      eq(depreciationBudgetRevisions.schedule_id, schedule.id),
      eq(depreciationBudgetRevisions.request_key, body.idempotency_key),
    ));
    if (prior) {
      const priorRequest = prior.after_events ? (JSON.parse(prior.after_events) as { request?: string }).request : null;
      return priorRequest === stableSerialize(body)
        ? c.json({ schedule_id: schedule.id, replayed: true })
        : c.json({ error: "idempotency_conflict" }, 409);
    }
  }
  const scales = await getBudgetScaleOptions(db);
  let totalAmount = schedule.total_amount;
  if (body.total_amount !== undefined) {
    try { totalAmount = toStorageMoneyAmount(body.total_amount, currency, scales); }
    catch { return c.json(invalidMoneyResponse("total_amount", currency), 400); }
  }
  const newPurchaseDate = body.purchase_date ?? schedule.start_date;
  const newDescription = body.description ?? schedule.description;
  const newMonths = body.months ?? schedule.months;
  const newAssetAccountId = body.asset_account_id ?? schedule.asset_account_id;
  const newExpenseAccountId = body.expense_account_id ?? schedule.expense_account_id;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newPurchaseDate) || !Number.isSafeInteger(newMonths) || newMonths < 1 || newMonths > 600 || totalAmount <= 0) {
    return c.json({ error: "invalid_depreciation_fields" }, 400);
  }

  const sourceRevision = await getDepreciationBudgetRevision(c.env.DB);
  const [currentSchedule] = await db.select().from(depreciationSchedules).where(eq(depreciationSchedules.id, schedule.id));
  if (!currentSchedule || stableSerialize(currentSchedule) !== stableSerialize(schedule)) return c.json({ error: "stale_schedule" }, 409);
  const allocationLinks = await linkedAllocationIds(db, schedule);
  if (allocationLinks.ambiguousCount) return c.json({ error: "ambiguous_legacy_allocations" }, 409);
  const purchaseLines = await db.select().from(journalLines)
    .where(eq(journalLines.journal_entry_id, schedule.source_journal_entry_id));
  if (purchaseLines.length === 0) return c.json({ error: "purchase_journal_missing" }, 409);
  const existingDebits = purchaseLines.filter((line) => line.debit > 0);
  const existingCredits = purchaseLines.filter((line) => line.credit > 0);
  const simplePurchaseLines = purchaseLines.length === 2 && existingDebits.length === 1 && existingCredits.length === 1 &&
    existingDebits[0]!.account_id === schedule.asset_account_id;
  const explicitPurchaseLines = body.purchase_lines !== undefined;
  if (!explicitPurchaseLines && !simplePurchaseLines &&
      (body.asset_account_id !== undefined || body.payment_account_id !== undefined)) {
    return c.json({ error: "compound_purchase_lines_required" }, 409);
  }
  if (explicitPurchaseLines && !Array.isArray(body.purchase_lines)) return c.json({ error: "invalid_purchase_lines" }, 400);
  const paymentAccountId = body.payment_account_id ?? (existingCredits.length === 1 ? existingCredits[0]!.account_id : undefined);
  const simpleLineEdit = !explicitPurchaseLines && simplePurchaseLines &&
    (body.asset_account_id !== undefined || body.payment_account_id !== undefined || body.total_amount !== undefined);
  if (simpleLineEdit && !paymentAccountId) return c.json({ error: "payment_account_selection_required" }, 409);
  const replacementLines = explicitPurchaseLines
    ? body.purchase_lines!
    : simpleLineEdit
      ? [{ account_id: newAssetAccountId, debit: fromStorageMoneyAmount(totalAmount, currency, scales), credit: 0, currency },
        { account_id: paymentAccountId!, debit: 0, credit: fromStorageMoneyAmount(totalAmount, currency, scales), currency,
          credit_card_billing_offset_months: existingCredits.find((line) => line.account_id === paymentAccountId)?.credit_card_billing_offset_months ?? null }]
      : null;
  if (replacementLines && (replacementLines.length < 2 || replacementLines.some((line) =>
    !Number.isSafeInteger(line.account_id) || line.account_id <= 0 || typeof line.debit !== "number" || typeof line.credit !== "number"))) {
    return c.json({ error: "invalid_purchase_lines" }, 400);
  }
  const normalizedReplacementLines = replacementLines?.map((line) => ({ ...line, currency: (line.currency ?? currency).toUpperCase() }));
  if (normalizedReplacementLines?.some((line) => line.currency !== currency)) {
    return c.json({ error: "purchase_lines_currency_mismatch" }, 400);
  }
  if (normalizedReplacementLines?.some((line) => line.credit_card_billing_offset_months != null &&
    (!Number.isSafeInteger(line.credit_card_billing_offset_months) || line.credit_card_billing_offset_months < 0))) {
    return c.json({ error: "invalid_credit_card_billing_offset" }, 400);
  }
  if (normalizedReplacementLines) {
    const lineMoneyError = findInvalidMoneyField(normalizedReplacementLines.flatMap((line, index) => [
      { path: `purchase_lines[${index}].debit`, value: line.debit, currency },
      { path: `purchase_lines[${index}].credit`, value: line.credit, currency },
    ]));
    if (lineMoneyError) return c.json(invalidMoneyResponse(lineMoneyError, currency), 400);
    const balanceError = journalBalanceError(normalizedReplacementLines, false, scales);
    if (balanceError) return c.json({ error: "invalid_purchase_journal", detail: balanceError }, 400);
    if (!normalizedReplacementLines.some((line) => line.account_id === newAssetAccountId && line.debit > 0)) {
      return c.json({ error: "purchase_asset_line_required" }, 400);
    }
  }
  const selectedAccountIds = [...new Set([
    newAssetAccountId, newExpenseAccountId,
    ...(paymentAccountId == null ? [] : [paymentAccountId]),
    ...purchaseLines.map((line) => line.account_id),
    ...(normalizedReplacementLines ?? []).map((line) => line.account_id),
  ])];
  const selectedAccounts = await db.select().from(accounts).where(inArray(accounts.id, selectedAccountIds));
  if (selectedAccounts.length !== selectedAccountIds.length) return c.json({ error: "account_not_found" }, 400);
  if (selectedAccounts.find((account) => account.id === newAssetAccountId)?.type !== "asset") {
    return c.json({ error: "asset_account_must_be_asset" }, 400);
  }
  if (isBudgetAccount(selectedAccounts.find((account) => account.id === newAssetAccountId))) {
    return c.json({ error: "invalid_depreciation_asset_account" }, 400);
  }
  if (selectedAccounts.find((account) => account.id === newExpenseAccountId)?.type !== "expense") {
    return c.json({ error: "expense_account_must_be_expense" }, 400);
  }
  const targetPurchaseLines = normalizedReplacementLines
    ? normalizedReplacementLines.map((line) => ({
        account_id: line.account_id,
        debit: toStorageMoneyAmount(line.debit, currency, scales),
        credit: toStorageMoneyAmount(line.credit, currency, scales),
        currency,
      }))
    : purchaseLines.map((line) => ({ account_id: line.account_id, debit: line.debit, credit: line.credit, currency: line.currency }));
  const assetAcquisition = targetPurchaseLines.reduce((total, line) => total +
    (line.account_id === newAssetAccountId ? line.debit - line.credit : 0), 0);
  if (assetAcquisition < totalAmount) return c.json({ error: "purchase_asset_basis_insufficient" }, 400);
  const targetAmount = Math.min(Math.max(0, -budgetAccountDelta(targetPurchaseLines, selectedAccounts, currency)), totalAmount);
  const settings = schedule.budget_settings
    ? normalizeDepreciationBudgetSettings(JSON.parse(schedule.budget_settings) as DepreciationBudgetSettings)
    : null;
  if (!settings) return c.json({ error: "budget_configuration_missing" }, 409);

  // Accounting edits preserve the saved routing/reset choices. If a date move
  // changes which historical boundaries apply, require a fresh explicit repair
  // instead of silently dropping or reinterpreting those decisions.
  const oldBoundaries = await findRelevantResetBoundaries(c, schedule, settings);
  const nextSchedule = { ...schedule, start_date: newPurchaseDate, total_amount: totalAmount, months: newMonths,
    asset_account_id: newAssetAccountId, expense_account_id: newExpenseAccountId };
  const nextBoundaries = await findRelevantResetBoundaries(c, nextSchedule, settings);
  const oldBoundaryIds = oldBoundaries.map((boundary) => boundary.reset_log_id).sort((a, b) => a - b);
  const nextBoundaryIds = nextBoundaries.map((boundary) => boundary.reset_log_id).sort((a, b) => a - b);
  if (stableSerialize(oldBoundaryIds) !== stableSerialize(nextBoundaryIds)) {
    return c.json({ error: "purchase_date_crosses_reset_repair_required" }, 409);
  }
  const missingDecision = nextBoundaries.some((boundary) => {
    const decision = settings.reset_decisions?.find((row) => row.reset_log_id === boundary.reset_log_id);
    if (!decision) return true;
    const validAction = boundary.action_kind === "carry_or_settle"
      ? decision.action === "carry" || decision.action === "settle"
      : decision.action === "continue" || decision.action === "end";
    return !validAction || (boundary.scope_confirmation_required && !decision.scope) ||
      (boundary.required_action === "order" && !decision.same_day_order);
  });
  if (missingDecision) return c.json({ error: "reset_decision_required" }, 409);

  const amounts = computeMonthlyAmounts(totalAmount, newMonths, newPurchaseDate);
  const dates = amounts.map((_, index) => index === 0 ? newPurchaseDate : firstOfMonth(newPurchaseDate, index));
  const createdAt = new Date().toISOString().replace("T", " ").slice(0, 19);
  const [purchaseHeader] = await db.select({ created_at: journalEntries.created_at })
    .from(journalEntries).where(eq(journalEntries.id, schedule.source_journal_entry_id));
  const oldMonthAnchors = await db.select({
    journal_entry_id: depreciationEntries.journal_entry_id,
    month_number: depreciationEntries.month_number,
    date: journalEntries.date,
    created_at: journalEntries.created_at,
  }).from(depreciationEntries)
    .innerJoin(journalEntries, eq(depreciationEntries.journal_entry_id, journalEntries.id))
    .where(eq(depreciationEntries.schedule_id, schedule.id));
  const oldAnchorByMonth = new Map(oldMonthAnchors.map((row) => [row.month_number, row]));
  const monthCreatedAts = dates.map((date, index) => {
    const old = oldAnchorByMonth.get(index + 1);
    return old?.date === date ? old.created_at : old?.created_at ?? purchaseHeader?.created_at ?? schedule.created_at;
  });
  const hypotheticalMonths = amounts.map((amount, index) => ({
    journal_entry_id: null,
    month_number: index + 1,
    date: dates[index]!,
    created_at: monthCreatedAts[index]!,
    amount,
  }));
  let expectedRows;
  try {
    expectedRows = await buildOwnedDepreciationBudgetRows(
      db,
      nextSchedule,
      settings,
      targetAmount,
      schedule.budget_special_category_id,
      scales,
      { months: hypotheticalMonths, purchaseCreatedAt: purchaseHeader?.created_at ?? schedule.created_at },
    );
  } catch (error) {
    if (error instanceof DepreciationBudgetPlanError) {
      const status = error.code === "settlement_exceeds_remaining_principal" ? 409 : 400;
      return c.json({ error: error.code }, status);
    }
    throw error;
  }
  const today = toLocalDateString();
  const futureCategoryIds = [...new Set(expectedRows
    .filter((row) => row.date >= today && row.budget_category_id > 0)
    .map((row) => row.budget_category_id))];
  if (futureCategoryIds.length) {
    const futureCategories = await db.select({ is_archived: budgetCategories.is_archived })
      .from(budgetCategories).where(inArray(budgetCategories.id, futureCategoryIds));
    if (futureCategories.some((row) => row.is_archived === 1)) return c.json({ error: "budget_category_archived" }, 409);
  }
  const linesChanged = normalizedReplacementLines != null;
  const firstMonthJournalId = await nextJournalEntryId(c.env.DB);
  const monthJournalEntryIds = amounts.map((_, index) => firstMonthJournalId + index);
  const oldMonthJournalIds = (await db.select({ journal_entry_id: depreciationEntries.journal_entry_id })
    .from(depreciationEntries).where(eq(depreciationEntries.schedule_id, schedule.id)))
    .map((row) => row.journal_entry_id);
  const monthlyJournalRows = amounts.map((_, index) => ({
    id: monthJournalEntryIds[index]!,
    date: dates[index]!,
    description: `${newDescription} 予算分割振替（減価償却） (${index + 1}/${newMonths}ヶ月)`,
    created_at: monthCreatedAts[index]!,
  }));
  const monthlyTagCopyPairs = monthJournalEntryIds.flatMap((replacementJournalId, index) => {
    const sourceJournalId = oldAnchorByMonth.get(index + 1)?.journal_entry_id;
    return sourceJournalId == null ? [] : [{ sourceJournalId, replacementJournalId }];
  });
  const persistedExpectedRows = expectedRows.map((row) => {
    const month = /^monthly:(\d+)(?::(?:category:\d+|unallocated))?$/.exec(row.depreciation_event_key);
    return {
      ...row,
      journal_entry_id: row.depreciation_event_key.startsWith("purchase:")
        ? schedule.source_journal_entry_id
        : month ? monthJournalEntryIds[Number(month[1]) - 1] ?? null : row.journal_entry_id,
    };
  });
  const statements: D1PreparedStatement[] = [
    ...buildDepreciationBudgetRevisionGuard(c.env.DB, sourceRevision),
    ...buildJournalHistoryStatements(c.env.DB, oldMonthJournalIds, "deleted"),
    ...buildJournalHistoryStatements(c.env.DB, [schedule.source_journal_entry_id], "edited"),
    c.env.DB.prepare(`INSERT INTO journal_entries(id,date,description,created_at)
      SELECT CAST(json_extract(value,'$.id') AS INTEGER),json_extract(value,'$.date'),
        json_extract(value,'$.description'),json_extract(value,'$.created_at') FROM json_each(?)`)
      .bind(JSON.stringify(monthlyJournalRows)),
    ...buildMonthlyExpenseTagCopyStatements(c.env.DB, monthlyTagCopyPairs),
    c.env.DB.prepare("DELETE FROM journal_entries WHERE id IN (SELECT journal_entry_id FROM depreciation_entries WHERE schedule_id=?)").bind(schedule.id),
    c.env.DB.prepare("DELETE FROM budget_adjustment_logs WHERE depreciation_schedule_id=?").bind(schedule.id),
    c.env.DB.prepare("DELETE FROM depreciation_budget_reservations WHERE schedule_id=?").bind(schedule.id),
    c.env.DB.prepare(`UPDATE journal_entries SET date=?,description=? WHERE id=?`)
      .bind(newPurchaseDate, newDescription, schedule.source_journal_entry_id),
  ];
  for (const allocationChunk of chunkForD1InClause(allocationLinks.safeIds)) {
    const placeholders = allocationChunk.map(() => "?").join(",");
    statements.push(c.env.DB.prepare(`DELETE FROM journal_entry_budget_allocations WHERE id IN (${placeholders})`)
      .bind(...allocationChunk));
  }
  if (linesChanged) {
    statements.push(c.env.DB.prepare("DELETE FROM journal_lines WHERE journal_entry_id=?").bind(schedule.source_journal_entry_id));
    const purchaseLineRows = normalizedReplacementLines!.map((line) => ({
      account_id: line.account_id,
      debit: toStorageMoneyAmount(line.debit, currency, scales),
      credit: toStorageMoneyAmount(line.credit, currency, scales),
      currency,
      credit_card_billing_offset_months: line.credit_card_billing_offset_months ?? null,
    }));
    statements.push(c.env.DB.prepare(`INSERT INTO journal_lines
      (journal_entry_id,account_id,debit,credit,currency,credit_card_billing_offset_months)
      SELECT ?,CAST(json_extract(value,'$.account_id') AS INTEGER),
        CAST(json_extract(value,'$.debit') AS INTEGER),CAST(json_extract(value,'$.credit') AS INTEGER),
        json_extract(value,'$.currency'),json_extract(value,'$.credit_card_billing_offset_months') FROM json_each(?)`)
      .bind(schedule.source_journal_entry_id, JSON.stringify(purchaseLineRows)));
  }
  statements.push(c.env.DB.prepare(`UPDATE depreciation_schedules SET start_date=?,description=?,total_amount=?,months=?,
    asset_account_id=?,expense_account_id=?,budget_target_amount=?,budget_revision=budget_revision+1 WHERE id=?`)
    .bind(newPurchaseDate, newDescription, totalAmount, newMonths, newAssetAccountId, newExpenseAccountId, targetAmount, schedule.id));
  statements.push(c.env.DB.prepare(`INSERT INTO depreciation_entries(schedule_id,journal_entry_id,month_number)
    SELECT ?,CAST(json_extract(value,'$.journal_entry_id') AS INTEGER),
      CAST(json_extract(value,'$.month_number') AS INTEGER) FROM json_each(?)`)
    .bind(schedule.id, JSON.stringify(monthJournalEntryIds.map((journal_entry_id, index) => ({
      journal_entry_id, month_number: index + 1,
    })))));
  const monthlyJournalLines = amounts.flatMap((amount, index) => [
    { journal_entry_id: monthJournalEntryIds[index]!, account_id: newExpenseAccountId, debit: amount, credit: 0, currency },
    { journal_entry_id: monthJournalEntryIds[index]!, account_id: newAssetAccountId, debit: 0, credit: amount, currency },
  ]);
  statements.push(c.env.DB.prepare(`INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency)
    SELECT CAST(json_extract(value,'$.journal_entry_id') AS INTEGER),CAST(json_extract(value,'$.account_id') AS INTEGER),
      CAST(json_extract(value,'$.debit') AS INTEGER),CAST(json_extract(value,'$.credit') AS INTEGER),json_extract(value,'$.currency')
    FROM json_each(?)`).bind(JSON.stringify(monthlyJournalLines)));
  for (const rowChunk of chunkForD1InClause(persistedExpectedRows, DEPRECIATION_BUDGET_LOG_CHUNK_SIZE)) {
    statements.push(c.env.DB.prepare(`INSERT INTO budget_adjustment_logs
      (budget_category_id,year_month,amount,currency,date,adjustment_type,journal_entry_id,
       depreciation_schedule_id,depreciation_event_key,depreciation_event_side,created_at)
      SELECT CASE WHEN json_extract(value,'$.special_category')=1
          THEN (SELECT budget_special_category_id FROM depreciation_schedules WHERE id=?)
          ELSE CAST(json_extract(value,'$.budget_category_id') AS INTEGER) END,
        json_extract(value,'$.year_month'),CAST(json_extract(value,'$.amount') AS INTEGER),
        json_extract(value,'$.currency'),json_extract(value,'$.date'),json_extract(value,'$.adjustment_type'),
        CAST(json_extract(value,'$.journal_entry_id') AS INTEGER),?,
        json_extract(value,'$.depreciation_event_key'),json_extract(value,'$.depreciation_event_side'),
        json_extract(value,'$.created_at') FROM json_each(?)`)
      .bind(schedule.id, schedule.id, JSON.stringify(rowChunk)));
  }
  const beforeEvents = await getOwnedBudgetRows(db, schedule.id);
  const accountingAfterEvents = JSON.stringify({
    request: stableSerialize(body), targetAmount, amounts, dates, events: persistedExpectedRows,
  });
  if (!depreciationBudgetAuditRowFits({
    schedule_id: schedule.id,
    revision: schedule.budget_revision + 1,
    action: "accounting_edit",
    request_key: body.idempotency_key ?? null,
    before_settings: schedule.budget_settings,
    after_settings: schedule.budget_settings,
    before_events: JSON.stringify(beforeEvents),
    after_events: accountingAfterEvents,
    created_at: createdAt,
  })) return c.json({ error: "depreciation_budget_plan_too_large" }, 400);
  statements.push(c.env.DB.prepare(`INSERT INTO depreciation_budget_revisions
    (schedule_id,revision,action,request_key,before_settings,after_settings,before_events,after_events,created_at)
    VALUES(?,?,'accounting_edit',?,?,?,?,?,?)`).bind(
      schedule.id, schedule.budget_revision + 1, body.idempotency_key ?? null,
      schedule.budget_settings, schedule.budget_settings,
      JSON.stringify(beforeEvents), accountingAfterEvents, createdAt,
    ));
  try {
    await c.env.DB.batch(statements);
  } catch (error) {
    if (String(error).includes("stale_depreciation_budget_preview")) return c.json({ error: "stale_schedule" }, 409);
    throw error;
  }
  return c.json({ schedule_id: schedule.id, monthly_amounts: amounts.map((amount) => fromStorageMoneyAmount(amount, currency, scales)), entry_dates: dates });
}

// ── routes ───────────────────────────────────────────────────────────────────

router.post("/:id/budget/preview", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: "invalid_id" }, 400);
  const body = await c.req.json<{ settings?: DepreciationBudgetSettings }>();
  if (!body.settings) return c.json({ error: "settings_required" }, 400);
  const db = createDb(c.env);
  const [schedule] = await db.select().from(depreciationSchedules).where(eq(depreciationSchedules.id, id));
  if (!schedule) return c.json({ error: "not_found" }, 404);
  let preview: Awaited<ReturnType<typeof buildDepreciationBudgetPreview>>;
  try {
    preview = await buildDepreciationBudgetPreview(c, schedule, body.settings);
  } catch (error) {
    if(String(error).includes("stale_depreciation_budget_preview")) return c.json({error:"stale_preview"},409);
    if (error instanceof DepreciationBudgetPlanError) return c.json({ error: error.code }, 400);
    throw error;
  }
  const {
    _revision: _revision,
    _expectedRows: _expectedRows,
    _allocationIds: _allocationIds,
    _legacyReservations: _legacyReservations,
    _legacyAllocations: _legacyAllocations,
    ...payload
  } = preview;
  return c.json(payload);
});

router.post("/:id/budget/apply", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: "invalid_id" }, 400);
  const body = await c.req.json<ApplyDepreciationBudgetInput>();
  if (!body.token || !body.settings) return c.json({ error: "token_and_settings_required" }, 400);
  if (!body.confirmed) return c.json({ error: "confirmation_required" }, 400);
  const db = createDb(c.env);
  const [schedule] = await db.select().from(depreciationSchedules).where(eq(depreciationSchedules.id, id));
  if (!schedule) return c.json({ error: "not_found" }, 404);

  const replay = await db.select().from(depreciationBudgetRevisions).where(and(
    eq(depreciationBudgetRevisions.schedule_id, id),
    eq(depreciationBudgetRevisions.request_key, body.token),
  ));
  if (replay.length) {
    const progress = await getDepreciationBudgetProgress(db, schedule);
    return c.json({ schedule_id: id, budget: progress, replayed: true });
  }

  let preview: Awaited<ReturnType<typeof buildDepreciationBudgetPreview>>;
  try {
    preview = await buildDepreciationBudgetPreview(c, schedule, body.settings);
  } catch (error) {
    if(String(error).includes("stale_depreciation_budget_preview")) return c.json({error:"stale_preview"},409);
    if (error instanceof DepreciationBudgetPlanError) return c.json({ error: error.code }, 400);
    throw error;
  }
  if (preview.token !== body.token) return c.json({ error: "stale_preview" }, 409);
  if (preview.warnings.includes("depreciation_budget_plan_too_large")) {
    return c.json({ error: "depreciation_budget_plan_too_large" }, 400);
  }
  if (!preview.can_apply) return c.json({ error: "budget_plan_not_applicable", warnings: preview.warnings }, 409);

  const oldSettings = schedule.budget_settings;
  const normalizedSettings = normalizeDepreciationBudgetSettings(body.settings);
  const sameSettings = schedule.budget_method === normalizedSettings.method &&
    oldSettings === JSON.stringify(normalizedSettings);
  const oldEvents = await getOwnedBudgetRows(db, id);
  const reservationCount = preview._legacyReservations;
  const legacyAllocationRows = preview._legacyAllocations;
  if (sameSettings && preview.changes.length === 0 && reservationCount.length === 0 && preview._allocationIds.length === 0) {
    return c.json({ schedule_id: id, budget: await getDepreciationBudgetProgress(db, schedule), replayed: false, unchanged: true });
  }

  const createdAt = new Date().toISOString().replace("T", " ").slice(0, 19);
  const specialCategoryNeedsCreate = normalizedSettings.method === "special" && schedule.budget_special_category_id == null;
  const targetAmount = await getDepreciationPurchaseTarget(db, schedule);
  const applyRows = preview._expectedRows.map((row) => ({
    ...row,
    created_at: row.created_at ?? createdAt,
  }));
  const applyAuditFits = depreciationBudgetAuditRowFits({
    schedule_id: id,
    revision: schedule.budget_revision + 1,
    action: "apply",
    request_key: body.token,
    before_settings: oldSettings,
    after_settings: JSON.stringify(normalizedSettings),
    before_events: JSON.stringify({
      owned: oldEvents,
      legacy_reservations: reservationCount,
      legacy_allocations: legacyAllocationRows,
    }),
    after_events: JSON.stringify(preview._expectedRows),
    created_at: createdAt,
  });
  if (!applyAuditFits) return c.json({ error: "depreciation_budget_plan_too_large" }, 400);
  const statements: D1PreparedStatement[] = [
    ...buildDepreciationBudgetRevisionGuard(c.env.DB, preview._revision),
  ];
  if (specialCategoryNeedsCreate) {
    statements.push(c.env.DB.prepare(`INSERT INTO budget_categories
      (name,sort_order,rollover_months,budget_group,is_archived) VALUES(?,0,-1,'予算分割振替（減価償却）',0)`)
      .bind(`予算分割振替（減価償却） ${schedule.id}`));
    statements.push(c.env.DB.prepare("UPDATE depreciation_schedules SET budget_special_category_id=last_insert_rowid() WHERE id=?").bind(id));
  }
  statements.push(c.env.DB.prepare("DELETE FROM budget_adjustment_logs WHERE depreciation_schedule_id=?").bind(id));
  statements.push(c.env.DB.prepare("DELETE FROM depreciation_budget_reservations WHERE schedule_id=?").bind(id));
  for(const chunk of chunkForD1InClause(preview._allocationIds)) {
    const placeholders = chunk.map(() => "?").join(",");
    statements.push(c.env.DB.prepare(`DELETE FROM journal_entry_budget_allocations WHERE id IN (${placeholders})`)
      .bind(...chunk));
  }
  statements.push(c.env.DB.prepare(`UPDATE depreciation_schedules SET budget_method=?,budget_settings=?,
    budget_revision=budget_revision+1,budget_target_amount=?,budget_currency=?
    WHERE id=?`).bind(
      normalizedSettings.method,
      JSON.stringify(normalizedSettings),
      targetAmount,
      schedule.budget_currency || "JPY",
      id,
    ));
  for (const rowChunk of chunkForD1InClause(applyRows, DEPRECIATION_BUDGET_LOG_CHUNK_SIZE)) {
    statements.push(c.env.DB.prepare(`INSERT INTO budget_adjustment_logs
      (budget_category_id,year_month,amount,currency,date,adjustment_type,journal_entry_id,
       depreciation_schedule_id,depreciation_event_key,depreciation_event_side,created_at)
      SELECT CASE WHEN json_extract(value,'$.special_category')=1 OR CAST(json_extract(value,'$.budget_category_id') AS INTEGER)=0
          THEN (SELECT budget_special_category_id FROM depreciation_schedules WHERE id=?)
          ELSE CAST(json_extract(value,'$.budget_category_id') AS INTEGER) END,
        json_extract(value,'$.year_month'),CAST(json_extract(value,'$.amount') AS INTEGER),
        json_extract(value,'$.currency'),json_extract(value,'$.date'),json_extract(value,'$.adjustment_type'),
        CAST(json_extract(value,'$.journal_entry_id') AS INTEGER),?,
        json_extract(value,'$.depreciation_event_key'),json_extract(value,'$.depreciation_event_side'),
        json_extract(value,'$.created_at') FROM json_each(?)`)
      .bind(id, id, JSON.stringify(rowChunk)));
  }
  statements.push(c.env.DB.prepare(`INSERT INTO depreciation_budget_revisions
    (schedule_id,revision,action,request_key,before_settings,after_settings,before_events,after_events,created_at)
    VALUES(?,?,'apply',?,?,?,?,?,?)`).bind(
      id,
      schedule.budget_revision + 1,
      body.token,
      oldSettings,
      JSON.stringify(normalizedSettings),
      JSON.stringify({owned:oldEvents,legacy_reservations:reservationCount,legacy_allocations:legacyAllocationRows}),
      JSON.stringify(preview._expectedRows),
      createdAt,
    ));

  try {
    await c.env.DB.batch(statements);
  } catch (error) {
    const message = String(error);
    if (message.includes("stale_depreciation_budget_preview") || message.includes("depreciation_budget_apply_guard")) {
      return c.json({ error: "stale_preview" }, 409);
    }
    throw error;
  }
  const [updated] = await db.select().from(depreciationSchedules).where(eq(depreciationSchedules.id, id));
  return c.json({ schedule_id: id, budget: await getDepreciationBudgetProgress(db, updated!), replayed: false });
});

// GET /api/depreciation — list all schedules
router.get("/", async (c) => {
  const db = createDb(c.env);

  const schedules = await db
    .select()
    .from(depreciationSchedules)
    .orderBy(sql`${depreciationSchedules.start_date} DESC`);

  if (schedules.length === 0) return c.json([]);

  const scales = await getBudgetScaleOptions(db);

  const scheduleIds = schedules.map((s) => s.id);

  const entries = (
    await Promise.all(
      chunkForD1InClause(scheduleIds).map((chunk) =>
        db
          .select()
          .from(depreciationEntries)
          .where(inArray(depreciationEntries.schedule_id, chunk))
          .orderBy(depreciationEntries.schedule_id, depreciationEntries.month_number),
      ),
    )
  ).flat().sort((a, b) => a.schedule_id - b.schedule_id || a.month_number - b.month_number);

  // Fetch account names
  const accountIds = [
    ...new Set(
      schedules.flatMap((s) => [s.asset_account_id, s.expense_account_id]),
    ),
  ];
  const accountRows = (
    await Promise.all(
      chunkForD1InClause(accountIds).map((chunk) =>
        db
          .select({ id: accounts.id, name: accounts.name })
          .from(accounts)
          .where(inArray(accounts.id, chunk)),
      ),
    )
  ).flat();
  const accountMap = new Map(accountRows.map((a) => [a.id, a.name]));

  // Fetch entry dates and amounts for each schedule
  const entryJournalIds = entries.map((e) => e.journal_entry_id);
  const journalRows =
    entryJournalIds.length > 0
      ? (
          await Promise.all(
            chunkForD1InClause(entryJournalIds).map((chunk) =>
              db
                .select({
                  id: journalEntries.id,
                  date: journalEntries.date,
                })
                .from(journalEntries)
                .where(inArray(journalEntries.id, chunk)),
            ),
          )
        ).flat()
      : [];
  const journalDateMap = new Map(journalRows.map((j) => [j.id, j.date]));

  // Fetch debit amounts for depreciation lines
  const lineRows =
    entryJournalIds.length > 0
      ? (
          await Promise.all(
            chunkForD1InClause(entryJournalIds).map((chunk) =>
              db
                .select({
                  journal_entry_id: journalLines.journal_entry_id,
                  debit: journalLines.debit,
                  account_id: journalLines.account_id,
                })
                .from(journalLines)
                .where(inArray(journalLines.journal_entry_id, chunk)),
            ),
          )
        ).flat()
      : [];

  // Per journal entry → debit amount (the expense side)
  const entryAmountMap = new Map<number, number>();
  for (const line of lineRows) {
    if (line.debit > 0) {
      entryAmountMap.set(line.journal_entry_id, line.debit);
    }
  }

  const entriesBySchedule = new Map<number, typeof entries>();
  for (const e of entries) {
    const arr = entriesBySchedule.get(e.schedule_id) ?? [];
    arr.push(e);
    entriesBySchedule.set(e.schedule_id, arr);
  }

  const budgets = new Map<number, Awaited<ReturnType<typeof getDepreciationBudgetProgress>>>();
  for (const schedule of schedules) {
    budgets.set(schedule.id, await getDepreciationBudgetProgress(db, schedule, scales));
  }

  return c.json(
    schedules.map((s) => {
      const sEntries = (entriesBySchedule.get(s.id) ?? []).sort(
        (a, b) => a.month_number - b.month_number,
      );
      const currency = s.budget_currency || "JPY";
      return {
        id: s.id,
        source_journal_entry_id: s.source_journal_entry_id,
        asset_account_id: s.asset_account_id,
        asset_account_name: accountMap.get(s.asset_account_id) ?? "",
        expense_account_id: s.expense_account_id,
        expense_account_name: accountMap.get(s.expense_account_id) ?? "",
        total_amount: fromStorageMoneyAmount(s.total_amount, currency, scales),
        months: s.months,
        start_date: s.start_date,
        description: s.description,
        created_at: s.created_at,
        budget: budgets.get(s.id)!,
        monthly_amounts: sEntries.map((e) =>
          fromStorageMoneyAmount(entryAmountMap.get(e.journal_entry_id) ?? 0, currency, scales),
        ),
        entry_dates: sEntries.map(
          (e) => journalDateMap.get(e.journal_entry_id) ?? "",
        ),
      };
    }),
  );
});

// POST /api/depreciation — create schedule + all journal entries
router.post("/", async (c) => {
  const body = await c.req.json<DepreciationCreateBody>();
  const invalidMoneyField = findInvalidMoneyField([
    { path: "total_amount", value: body.total_amount, currency: body.currency || "JPY" },
  ]);
  if (invalidMoneyField) return c.json(invalidMoneyResponse(invalidMoneyField, body.currency), 400);
  return createConfiguredDepreciation(c, body);
});
// PATCH /api/depreciation/:id — update schedule (regenerates all monthly entries)
router.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const body = await c.req.json<{
    purchase_date?: string;
    description?: string;
    total_amount?: number;
    months?: number;
    asset_account_id?: number;
    expense_account_id?: number;
    payment_account_id?: number;
    currency?: string;
    budget_settings?: DepreciationBudgetSettings;
    idempotency_key?: string;
    purchase_lines?: Array<{
      account_id: number; debit: number; credit: number; currency?: string;
      credit_card_billing_offset_months?: number | null;
    }>;
  }>();

  const invalidMoneyField = findInvalidMoneyField([
    { path: "total_amount", value: body.total_amount, currency: body.currency || "JPY" },
  ]);
  if (invalidMoneyField) {
    return c.json(invalidMoneyResponse(invalidMoneyField), 400);
  }

  const db = createDb(c.env);

  const [schedule] = await db
    .select()
    .from(depreciationSchedules)
    .where(eq(depreciationSchedules.id, id));
  if (!schedule) return c.json({ error: "Not found" }, 404);

  if (schedule.budget_method) return updateConfiguredDepreciation(c, schedule, body);

  const newPurchaseDate = body.purchase_date ?? schedule.start_date;
  const newDescription = body.description ?? schedule.description;
  const newTotalAmount = body.total_amount ?? schedule.total_amount;
  const newMonths = body.months ?? schedule.months;
  const newAssetAccountId = body.asset_account_id ?? schedule.asset_account_id;
  const newExpenseAccountId =
    body.expense_account_id ?? schedule.expense_account_id;
  const existingPurchaseLines = await db.select().from(journalLines)
    .where(eq(journalLines.journal_entry_id, schedule.source_journal_entry_id));
  const shouldReplacePurchaseLines = body.asset_account_id !== undefined ||
    body.total_amount !== undefined || body.payment_account_id !== undefined;
  let paymentAccountId = body.payment_account_id;
  if (shouldReplacePurchaseLines && paymentAccountId == null) {
    paymentAccountId = existingPurchaseLines.find((line) => line.credit > 0)?.account_id;
  }
  const purchaseLinesChanged = shouldReplacePurchaseLines && (
    existingPurchaseLines.length !== 2 ||
    existingPurchaseLines.find((line) => line.debit > 0)?.account_id !== newAssetAccountId ||
    existingPurchaseLines.find((line) => line.debit > 0)?.debit !== newTotalAmount ||
    existingPurchaseLines.find((line) => line.credit > 0)?.account_id !== paymentAccountId ||
    existingPurchaseLines.find((line) => line.credit > 0)?.credit !== newTotalAmount
  );
  const scheduleChanged = newPurchaseDate !== schedule.start_date ||
    newDescription !== schedule.description || newTotalAmount !== schedule.total_amount ||
    newMonths !== schedule.months || newAssetAccountId !== schedule.asset_account_id ||
    newExpenseAccountId !== schedule.expense_account_id || purchaseLinesChanged;
  if (!scheduleChanged) {
    const monthlyAmounts = computeMonthlyAmounts(newTotalAmount, newMonths, newPurchaseDate);
    return c.json({
      schedule_id: schedule.id,
      monthly_amounts: monthlyAmounts,
      entry_dates: monthlyAmounts.map((_, index) => index === 0 ? newPurchaseDate : firstOfMonth(newPurchaseDate, index)),
    });
  }

  // Prepare the complete legacy schedule replacement before writing so the
  // purchase edit, old-row snapshots, and regenerated monthly rows are atomic.
  const newAmounts = computeMonthlyAmounts(
    newTotalAmount,
    newMonths,
    newPurchaseDate,
  );
  const entryDates: string[] = [];
  for (let i = 0; i < newMonths; i++) {
    entryDates.push(
      i === 0 ? newPurchaseDate : firstOfMonth(newPurchaseDate, i),
    );
  }

  const patchBudgetRatios = await db
    .select()
    .from(budgetCategoryAccounts)
    .where(eq(budgetCategoryAccounts.account_id, newExpenseAccountId));
  const reservationRows = buildBudgetReservations(
    id,
    newTotalAmount,
    patchBudgetRatios,
  );
  const existingDepEntries = await db.select()
    .from(depreciationEntries).where(eq(depreciationEntries.schedule_id, id));
  const oldJournalIds = existingDepEntries.map((entry) => entry.journal_entry_id);
  const firstMonthJournalId = await nextJournalEntryId(c.env.DB);
  const newMonthlyJournalIds = newAmounts.map((_, index) => firstMonthJournalId + index);
  const newJournalEntries = newAmounts.map((_, index) => ({
    id: newMonthlyJournalIds[index]!,
    date: entryDates[index]!,
    description: `${newDescription} 予算分割振替（減価償却） (${index + 1}/${newMonths}ヶ月)`,
  }));
  const oldMonthlyJournalIdByMonth = new Map(existingDepEntries.map((entry) => [entry.month_number, entry.journal_entry_id]));
  const monthlyTagCopyPairs = newMonthlyJournalIds.flatMap((replacementJournalId, index) => {
    const sourceJournalId = oldMonthlyJournalIdByMonth.get(index + 1);
    return sourceJournalId == null ? [] : [{ sourceJournalId, replacementJournalId }];
  });
  const newMonthlyJournalLines = newAmounts.flatMap((amount, index) => [
    { journal_entry_id: newMonthlyJournalIds[index]!, account_id: newExpenseAccountId, debit: amount, credit: 0 },
    { journal_entry_id: newMonthlyJournalIds[index]!, account_id: newAssetAccountId, debit: 0, credit: amount },
  ]);
  const newBudgetAllocations = newAmounts.flatMap((amount, index) =>
    buildBudgetAllocations(newMonthlyJournalIds[index]!, amount, patchBudgetRatios)
      .map((row) => ({ ...row, source: "depreciation" })),
  );
  const statements: D1PreparedStatement[] = [
    ...buildJournalHistoryStatements(c.env.DB, [schedule.source_journal_entry_id], "edited"),
    ...buildJournalHistoryStatements(c.env.DB, oldJournalIds, "deleted"),
    c.env.DB.prepare(`INSERT INTO journal_entries(id,date,description)
      SELECT CAST(json_extract(value,'$.id') AS INTEGER),json_extract(value,'$.date'),json_extract(value,'$.description')
      FROM json_each(?)`).bind(JSON.stringify(newJournalEntries)),
    ...buildMonthlyExpenseTagCopyStatements(c.env.DB, monthlyTagCopyPairs),
    prepareMutation(c.env.DB, db.update(journalEntries)
      .set({ date: newPurchaseDate, description: newDescription })
      .where(eq(journalEntries.id, schedule.source_journal_entry_id))),
  ];
  if (purchaseLinesChanged) {
    statements.push(prepareMutation(c.env.DB, db.delete(journalLines)
      .where(eq(journalLines.journal_entry_id, schedule.source_journal_entry_id))));
    if (paymentAccountId != null) {
      statements.push(prepareMutation(c.env.DB, db.insert(journalLines).values([
        { journal_entry_id: schedule.source_journal_entry_id, account_id: newAssetAccountId, debit: newTotalAmount, credit: 0 },
        { journal_entry_id: schedule.source_journal_entry_id, account_id: paymentAccountId, debit: 0, credit: newTotalAmount },
      ])));
    }
  }
  for (const ids of chunkForD1InClause(oldJournalIds)) {
    statements.push(prepareMutation(c.env.DB, db.delete(journalEntries).where(inArray(journalEntries.id, ids))));
  }
  statements.push(prepareMutation(c.env.DB, db.delete(depreciationBudgetReservations)
    .where(eq(depreciationBudgetReservations.schedule_id, id))));
  if (reservationRows.length > 0) {
    statements.push(prepareMutation(c.env.DB, db.insert(depreciationBudgetReservations).values(reservationRows)));
  }
  for (const rows of chunkForD1InClause(newMonthlyJournalLines, 200)) {
    statements.push(c.env.DB.prepare(`INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit)
      SELECT CAST(json_extract(value,'$.journal_entry_id') AS INTEGER),CAST(json_extract(value,'$.account_id') AS INTEGER),
      CAST(json_extract(value,'$.debit') AS INTEGER),CAST(json_extract(value,'$.credit') AS INTEGER) FROM json_each(?)`)
      .bind(JSON.stringify(rows)));
  }
  for (const rows of chunkForD1InClause(newMonthlyJournalIds.map((journal_entry_id, index) => ({ journal_entry_id, month_number: index + 1 })), 200)) {
    statements.push(c.env.DB.prepare(`INSERT INTO depreciation_entries(schedule_id,journal_entry_id,month_number)
      SELECT ?,CAST(json_extract(value,'$.journal_entry_id') AS INTEGER),CAST(json_extract(value,'$.month_number') AS INTEGER)
      FROM json_each(?)`).bind(id, JSON.stringify(rows)));
  }
  for (const rows of chunkForD1InClause(newBudgetAllocations, 200)) {
    statements.push(c.env.DB.prepare(`INSERT INTO journal_entry_budget_allocations(journal_entry_id,budget_category_id,amount,source)
      SELECT CAST(json_extract(value,'$.journal_entry_id') AS INTEGER),CAST(json_extract(value,'$.budget_category_id') AS INTEGER),
      CAST(json_extract(value,'$.amount') AS INTEGER),json_extract(value,'$.source') FROM json_each(?)`)
      .bind(JSON.stringify(rows)));
  }

  statements.push(prepareMutation(c.env.DB, db.update(depreciationSchedules).set({
      start_date: newPurchaseDate,
      description: newDescription,
      total_amount: newTotalAmount,
      months: newMonths,
      asset_account_id: newAssetAccountId,
      expense_account_id: newExpenseAccountId,
  }).where(eq(depreciationSchedules.id, id))));
  const mutationRevision = await readBudgetMutationRevision(c.env.DB);
  const batchResult = await runBudgetGuardedBatch(c.env.DB, mutationRevision, statements);
  if (!batchResult) return c.json({ error: "stale_schedule" }, 409);

  return c.json({
    schedule_id: id,
    monthly_amounts: newAmounts,
    entry_dates: entryDates,
  });
});

// DELETE /api/depreciation/:id — delete schedule + all its entries
router.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: "invalid_id" }, 400);
  const db = createDb(c.env);
  const expectedRevision = await getDepreciationBudgetRevision(c.env.DB);
  const [schedule] = await db.select().from(depreciationSchedules).where(eq(depreciationSchedules.id, id));
  if (!schedule) return c.json({ error: "not_found" }, 404);
  const ownedEvents = await getOwnedBudgetRows(db, id);
  const scheduledJournalIds = (await db.select({ journal_entry_id: depreciationEntries.journal_entry_id })
    .from(depreciationEntries).where(eq(depreciationEntries.schedule_id, id)))
    .map((row) => row.journal_entry_id);
  const createdAt = new Date().toISOString().replace("T", " ").slice(0, 19);
  const statements: D1PreparedStatement[] = [
    ...buildDepreciationBudgetRevisionGuard(c.env.DB, expectedRevision),
    ...buildJournalHistoryStatements(c.env.DB, [...scheduledJournalIds, schedule.source_journal_entry_id], "deleted"),
  ];
  statements.push(c.env.DB.prepare(`DELETE FROM journal_entries WHERE id IN
    (SELECT journal_entry_id FROM depreciation_entries WHERE schedule_id=?)`).bind(id));
  statements.push(c.env.DB.prepare("DELETE FROM journal_entries WHERE id=?").bind(schedule.source_journal_entry_id));
  statements.push(c.env.DB.prepare(`INSERT INTO depreciation_budget_revisions
    (schedule_id,revision,action,before_settings,after_settings,before_events,after_events,created_at)
    VALUES(?,?,'delete',?,NULL,?,'[]',?)`).bind(
      id, schedule.budget_revision + 1, schedule.budget_settings, JSON.stringify(ownedEvents), createdAt,
    ));
  statements.push(c.env.DB.prepare("DELETE FROM depreciation_schedules WHERE id=?").bind(id));
  try {
    await c.env.DB.batch(statements);
  } catch (error) {
    if (String(error).includes("stale_depreciation_budget_preview")) return c.json({ error: "stale_schedule" }, 409);
    throw error;
  }
  return c.json({ success: true });
});
// GET /api/depreciation/report?year=YYYY or ?year_month=YYYY-MM
router.get("/report", async (c) => {
  const year = c.req.query("year");
  const yearMonth = c.req.query("year_month");

  if (!year && !yearMonth) {
    return c.json({ error: "year or year_month query param required" }, 400);
  }

  const db = createDb(c.env);

  const allSchedules = await db.select().from(depreciationSchedules);
  if (allSchedules.length === 0) {
    return c.json({
      period: year ?? yearMonth,
      total_depreciation: 0,
      entries: [],
    });
  }

  const scheduleIds = allSchedules.map((s) => s.id);

  // Fetch all depreciation entries linked to those schedules
  const depEntries = (
    await Promise.all(
      chunkForD1InClause(scheduleIds).map((chunk) =>
        db
          .select()
          .from(depreciationEntries)
          .where(inArray(depreciationEntries.schedule_id, chunk)),
      ),
    )
  ).flat();

  if (depEntries.length === 0) {
    return c.json({
      period: year ?? yearMonth,
      total_depreciation: 0,
      entries: [],
    });
  }

  const journalIds = depEntries.map((e) => e.journal_entry_id);

  // Fetch journal entries to filter by date
  const journalRows = (
    await Promise.all(
      chunkForD1InClause(journalIds).map((chunk) =>
        db
          .select({ id: journalEntries.id, date: journalEntries.date })
          .from(journalEntries)
          .where(inArray(journalEntries.id, chunk)),
      ),
    )
  ).flat();

  // Filter by period
  const filteredJournalIds = new Set(
    journalRows
      .filter((j) => {
        if (yearMonth) return j.date.startsWith(yearMonth);
        if (year) return j.date.startsWith(year);
        return false;
      })
      .map((j) => j.id),
  );

  if (filteredJournalIds.size === 0) {
    return c.json({
      period: year ?? yearMonth,
      total_depreciation: 0,
      entries: [],
    });
  }

  // Fetch line amounts
  const filteredIds = [...filteredJournalIds];
  const lineRows = (
    await Promise.all(
      chunkForD1InClause(filteredIds).map((chunk) =>
        db
          .select({
            journal_entry_id: journalLines.journal_entry_id,
            debit: journalLines.debit,
          })
          .from(journalLines)
          .where(inArray(journalLines.journal_entry_id, chunk)),
      ),
    )
  ).flat();

  // Sum debit per journal entry
  const amountByJournal = new Map<number, number>();
  for (const line of lineRows) {
    if (line.debit > 0) amountByJournal.set(line.journal_entry_id, line.debit);
  }

  // Map depreciationEntry → journal entry → amount, grouped by schedule
  const amountBySchedule = new Map<number, number>();
  for (const de of depEntries) {
    if (!filteredJournalIds.has(de.journal_entry_id)) continue;
    const amt = amountByJournal.get(de.journal_entry_id) ?? 0;
    amountBySchedule.set(
      de.schedule_id,
      (amountBySchedule.get(de.schedule_id) ?? 0) + amt,
    );
  }

  // Fetch account names
  const accountIds = [...new Set(allSchedules.map((s) => s.asset_account_id))];
  const accountRows = (
    await Promise.all(
      chunkForD1InClause(accountIds).map((chunk) =>
        db
          .select({ id: accounts.id, name: accounts.name })
          .from(accounts)
          .where(inArray(accounts.id, chunk)),
      ),
    )
  ).flat();
  const accountMap = new Map(accountRows.map((a) => [a.id, a.name]));

  const resultEntries = allSchedules
    .filter((s) => (amountBySchedule.get(s.id) ?? 0) > 0)
    .map((s) => ({
      schedule_id: s.id,
      description: s.description,
      asset_account_name: accountMap.get(s.asset_account_id) ?? "",
      total_amount: s.total_amount,
      months: s.months,
      start_date: s.start_date,
      amount_in_period: amountBySchedule.get(s.id) ?? 0,
    }));

  const totalDepreciation = resultEntries.reduce(
    (s, e) => s + e.amount_in_period,
    0,
  );

  return c.json({
    period: year ?? yearMonth,
    total_depreciation: totalDepreciation,
    entries: resultEntries,
  });
});

export { router as depreciationRouter };
