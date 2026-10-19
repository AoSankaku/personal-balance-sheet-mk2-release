import { eq, and, sql, inArray, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { Hono } from "hono";
import { createDb, type Env } from "../db";
import {
  budgetCategories,
  budgetCategoryAccounts,
  budgetCategoryAccountTargets,
  budgetAllocations,
  budgetFilters,
  budgetFilterSteps,
  budgetFilterStepAllocations,
  journalLines,
  journalEntries,
  journalEntryBudgetAllocations,
  budgetAdjustmentLogs,
  budgetFundingAllocations,
  budgetSettings,
  accounts,
  depreciationEntries,
  depreciationSchedules,
  depreciationBudgetReservations,
} from "../db/schema";
import { loadCurrencyDecimalPlaces } from "../lib/currencyPrecision";
import type {
  BudgetCategory,
  BudgetHistoryResponse,
  BudgetCategorySummary,
  BudgetSummary,
  BudgetFilter,
} from "@balance-sheet/shared";
import {
  applyBudgetBalanceCaps,
  calculateDepreciationBudgetMonth,
  calculateReferenceSpentFromBudgetAllocations,
  calculateNextCarryover,
  findLatestResetDateForPeriod,
  findLatestResetPointForPeriod,
  groupBudgetEntryAllocationsByMonth,
  isAfterBudgetResetPoint,
  shouldShowCarryoverForPeriod,
  sumBudgetAdjustmentLogsAfterResetsByPeriod,
  type DateRange,
} from "../lib/budgetSummary";
import { sumBudgetFundingAfterResetsByPeriod } from "../lib/budgetFunding";
import { filterBudgetCategoriesForVisibility } from "../lib/budgetCategoryArchive";
import { replayBudgetHistory } from "../../../shared/budgetHistory";
import { toLocalDateString } from "../lib/appDate";
import {
  categoryHasDepreciationReferences,
  DepreciationResetError,
  getDepreciationResetPlans,
  isManagedDepreciationReset,
  prepareDepreciationReset,
} from "../lib/depreciationBudgetReset";
import type { DepreciationResetInputDecision } from "../../../shared/depreciationBudget";
import { prepareMutation, readBudgetMutationRevision, runBudgetGuardedBatch } from "../lib/d1Mutation";
import {
  findInvalidMoneyField,
  fromStorageMoneyAmount,
  invalidMoneyResponse,
  type MoneyScaleOptions,
  rescaleStorageMoneyAmount,
  toStorageMoneyAmount,
} from "../lib/moneyValidation";

type D1QueryResult<T> = { results?: T[] };

const router = new Hono<{ Bindings: Env }>();
const sourceFundingEntries = alias(
  journalEntries,
  "source_budget_funding_entries",
);
const depreciationSourceEntries = alias(
  journalEntries,
  "depreciation_source_entries",
);

function normalizeCurrency(currency: string | null | undefined): string {
  return (currency || "JPY").toUpperCase();
}

function normalizeCalendarWeekStart(value: unknown): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 &&
    value <= 6
    ? (value as 0 | 1 | 2 | 3 | 4 | 5 | 6)
    : 0;
}

async function loadMoneyScaleOptions(
  db: ReturnType<typeof createDb>,
): Promise<MoneyScaleOptions> {
  return { decimalPlacesByCurrency: await loadCurrencyDecimalPlaces(db) };
}

function decimalPlacesForCurrency(
  scaleOptions: MoneyScaleOptions,
  currency: string | null | undefined,
) {
  return scaleOptions.decimalPlacesByCurrency?.[normalizeCurrency(currency)];
}

function normalizeNote(note: string | null | undefined): string | null {
  const trimmed = note?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function buildTargetAccountMap(
  rows: {
    budget_category_id: number;
    account_id: number;
    account_name: string | null;
    ratio: number;
  }[],
) {
  const map = new Map<
    number,
    { account_id: number; account_name?: string; ratio: number }[]
  >();
  for (const row of rows) {
    const list = map.get(row.budget_category_id) ?? [];
    list.push({
      account_id: row.account_id,
      account_name: row.account_name ?? undefined,
      ratio: row.ratio,
    });
    map.set(row.budget_category_id, list);
  }
  return map;
}

async function fetchBudgetCategoryTargetRows(db: ReturnType<typeof createDb>) {
  return db
    .select({
      budget_category_id: budgetCategoryAccountTargets.budget_category_id,
      account_id: budgetCategoryAccountTargets.account_id,
      account_name: accounts.name,
      ratio: budgetCategoryAccountTargets.ratio,
    })
    .from(budgetCategoryAccountTargets)
    .innerJoin(accounts, eq(budgetCategoryAccountTargets.account_id, accounts.id))
    .where(
      and(
        eq(accounts.type, "asset"),
        eq(accounts.category, "cash"),
        eq(accounts.is_depreciable, 0),
        ne(accounts.include_in_allocatable, 0),
      ),
    );
}

async function filterValidBudgetPlacementTargets(
  db: ReturnType<typeof createDb>,
  targets: { account_id: number; ratio: number }[],
) {
  const normalizedTargets = targets.filter(
    (target) => target.account_id && target.ratio > 0,
  );
  if (normalizedTargets.length === 0) return [];

  const validAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        inArray(
          accounts.id,
          normalizedTargets.map((target) => target.account_id),
        ),
        eq(accounts.type, "asset"),
        eq(accounts.category, "cash"),
        eq(accounts.is_depreciable, 0),
        ne(accounts.include_in_allocatable, 0),
      ),
    );
  const validIds = new Set(validAccounts.map((account) => account.id));
  return normalizedTargets.filter((target) => validIds.has(target.account_id));
}

function hasOverflowCycle(
  rows: { id: number; overflow_budget_category_id: number | null }[],
  id: number,
  targetId: number | null | undefined,
): boolean {
  if (targetId == null) return false;
  const nextById = new Map(
    rows.map((row) => [row.id, row.overflow_budget_category_id]),
  );
  let current: number | null | undefined = targetId;
  const seen = new Set<number>();
  while (current != null) {
    if (current === id) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    current = nextById.get(current);
  }
  return false;
}

// GET /api/budget/categories — list all categories with account_ids
router.get("/categories", async (c) => {
  const db = createDb(c.env);
  const includeArchived = c.req.query("include_archived") === "1";

  const allCats = await db
    .select()
    .from(budgetCategories)
    .orderBy(budgetCategories.sort_order, budgetCategories.name);
  const cats = filterBudgetCategoriesForVisibility(allCats, includeArchived);

  const links = await db.select().from(budgetCategoryAccounts);
  const targetMap = buildTargetAccountMap(
    await fetchBudgetCategoryTargetRows(db),
  );

  const result: BudgetCategory[] = cats.map((cat) => ({
    id: cat.id,
    name: cat.name,
    sort_order: cat.sort_order,
    rollover_months: cat.rollover_months,
    budget_group: cat.budget_group,
    goal_balance: cat.goal_balance ?? null,
    balance_cap: cat.balance_cap ?? null,
    overflow_budget_category_id: cat.overflow_budget_category_id ?? null,
    is_archived: cat.is_archived === 1,
    account_ids: links
      .filter((l) => l.budget_category_id === cat.id)
      .map((l) => l.account_id),
    target_accounts: targetMap.get(cat.id) ?? [],
    created_at: cat.created_at,
  }));

  return c.json(result);
});

// POST /api/budget/categories — create category + account links
router.post("/categories", async (c) => {
  const body = await c.req.json<{
    name: string;
    sort_order?: number;
    rollover_months?: number;
    budget_group?: string;
    goal_balance?: number | null;
    balance_cap?: number | null;
    overflow_budget_category_id?: number | null;
    is_archived?: boolean;
    account_ids?: number[];
    target_accounts?: { account_id: number; ratio: number }[];
  }>();

  if (!body.name) {
    return c.json({ error: "name is required" }, 400);
  }

  const invalidMoneyField = findInvalidMoneyField([
    { path: "goal_balance", value: body.goal_balance, nullable: true },
    { path: "balance_cap", value: body.balance_cap, nullable: true },
  ]);
  if (invalidMoneyField) {
    return c.json(invalidMoneyResponse(invalidMoneyField), 400);
  }

  const db = createDb(c.env);

  // Reject if another budget category or account with the same name already exists
  const [dupCat] = await db
    .select({ id: budgetCategories.id })
    .from(budgetCategories)
    .where(eq(budgetCategories.name, body.name));
  if (dupCat) {
    return c.json(
      { error: "name_conflict", conflict_type: "budget_category" },
      409,
    );
  }
  const [nameConflict] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.name, body.name));
  if (nameConflict) {
    return c.json({ error: "name_conflict", conflict_type: "account" }, 409);
  }

  const targetAccounts = await filterValidBudgetPlacementTargets(
    db,
    body.target_accounts ?? [],
  );

  const [cat] = await db
    .insert(budgetCategories)
    .values({
      name: body.name,
      sort_order: body.sort_order ?? 0,
      rollover_months: -1,
      budget_group: body.budget_group ?? "日常支出",
      goal_balance: body.goal_balance ?? null,
      balance_cap: body.balance_cap ?? null,
      overflow_budget_category_id: body.overflow_budget_category_id ?? null,
      is_archived: body.is_archived ? 1 : 0,
    })
    .returning();

  if (!cat) return c.json({ error: "insert failed" }, 500);

  if (body.account_ids && body.account_ids.length > 0) {
    await db.insert(budgetCategoryAccounts).values(
      body.account_ids.map((aid) => ({
        budget_category_id: cat.id,
        account_id: aid,
      })),
    );
  }

  if (targetAccounts.length > 0) {
    await db.insert(budgetCategoryAccountTargets).values(
      targetAccounts.map((target) => ({
        budget_category_id: cat.id,
        account_id: target.account_id,
        ratio: target.ratio,
      })),
    );
  }

  const result: BudgetCategory = {
    id: cat.id,
    name: cat.name,
    sort_order: cat.sort_order,
    rollover_months: cat.rollover_months,
    budget_group: cat.budget_group,
    goal_balance: cat.goal_balance ?? null,
    balance_cap: cat.balance_cap ?? null,
    overflow_budget_category_id: cat.overflow_budget_category_id ?? null,
    is_archived: cat.is_archived === 1,
    account_ids: body.account_ids ?? [],
    target_accounts: targetAccounts,
    created_at: cat.created_at,
  };

  return c.json(result, 201);
});

// PATCH /api/budget/categories/:id — update category; replace account links
router.patch("/categories/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{
    name?: string;
    sort_order?: number;
    rollover_months?: number;
    budget_group?: string;
    goal_balance?: number | null;
    balance_cap?: number | null;
    overflow_budget_category_id?: number | null;
    is_archived?: boolean;
    account_ids?: number[];
    target_accounts?: { account_id: number; ratio: number }[];
  }>();

  const invalidMoneyField = findInvalidMoneyField([
    { path: "goal_balance", value: body.goal_balance, nullable: true },
    { path: "balance_cap", value: body.balance_cap, nullable: true },
  ]);
  if (invalidMoneyField) {
    return c.json(invalidMoneyResponse(invalidMoneyField), 400);
  }

  const db = createDb(c.env);

  // Reject if renaming to a name that conflicts with an account
  const archiveRevision = body.is_archived ? await readBudgetMutationRevision(c.env.DB) : null;
  if (body.is_archived && await categoryHasDepreciationReferences(c.env.DB,id,toLocalDateString())) {
    return c.json({ error: "depreciation_routing_required" },409);
  }
  if (body.name !== undefined) {
    const [existing] = await db
      .select({ name: budgetCategories.name })
      .from(budgetCategories)
      .where(eq(budgetCategories.id, id));
    if (existing && body.name !== existing.name) {
      const [dupCat] = await db
        .select({ id: budgetCategories.id })
        .from(budgetCategories)
        .where(
          and(
            eq(budgetCategories.name, body.name),
            ne(budgetCategories.id, id),
          ),
        );
      if (dupCat) {
        return c.json(
          { error: "name_conflict", conflict_type: "budget_category" },
          409,
        );
      }
      const [nameConflict] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.name, body.name));
      if (nameConflict) {
        return c.json(
          { error: "name_conflict", conflict_type: "account" },
          409,
        );
      }
    }
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.sort_order !== undefined) updates.sort_order = body.sort_order;
  if (body.rollover_months !== undefined)
    updates.rollover_months = body.rollover_months;
  if (body.budget_group !== undefined) updates.budget_group = body.budget_group;
  if ("goal_balance" in body) updates.goal_balance = body.goal_balance ?? null;
  if ("balance_cap" in body) updates.balance_cap = body.balance_cap ?? null;
  if ("overflow_budget_category_id" in body) {
    const targetId = body.overflow_budget_category_id ?? null;
    const rows = await db
      .select({
        id: budgetCategories.id,
        overflow_budget_category_id:
          budgetCategories.overflow_budget_category_id,
      })
      .from(budgetCategories);
    if (hasOverflowCycle(rows, id, targetId)) {
      return c.json({ error: "overflow_cycle" }, 400);
    }
    updates.overflow_budget_category_id = targetId;
  }
  if (body.is_archived !== undefined)
    updates.is_archived = body.is_archived ? 1 : 0;

  if (Object.keys(updates).length > 0) {
    const update = db
      .update(budgetCategories)
      .set(updates)
      .where(eq(budgetCategories.id, id));
    if (archiveRevision !== null) {
      if (!await runBudgetGuardedBatch(c.env.DB,archiveRevision,[prepareMutation(c.env.DB,update)]))
        return c.json({error:"depreciation_preview_stale"},409);
    } else await update;
  }

  if (body.account_ids !== undefined) {
    await db
      .delete(budgetCategoryAccounts)
      .where(eq(budgetCategoryAccounts.budget_category_id, id));

    if (body.account_ids.length > 0) {
      await db.insert(budgetCategoryAccounts).values(
        body.account_ids.map((aid) => ({
          budget_category_id: id,
          account_id: aid,
        })),
      );
    }
  }

  if (body.target_accounts !== undefined) {
    await db
      .delete(budgetCategoryAccountTargets)
      .where(eq(budgetCategoryAccountTargets.budget_category_id, id));

    const targetAccounts = await filterValidBudgetPlacementTargets(
      db,
      body.target_accounts,
    );
    if (targetAccounts.length > 0) {
      await db.insert(budgetCategoryAccountTargets).values(
        targetAccounts.map((target) => ({
          budget_category_id: id,
          account_id: target.account_id,
          ratio: target.ratio,
        })),
      );
    }
  }

  const [cat] = await db
    .select()
    .from(budgetCategories)
    .where(eq(budgetCategories.id, id));

  if (!cat) return c.json({ error: "not found" }, 404);

  const links = await db
    .select()
    .from(budgetCategoryAccounts)
    .where(eq(budgetCategoryAccounts.budget_category_id, id));
  const targetMap = buildTargetAccountMap(
    await fetchBudgetCategoryTargetRows(db),
  );

  const result: BudgetCategory = {
    id: cat.id,
    name: cat.name,
    sort_order: cat.sort_order,
    rollover_months: cat.rollover_months,
    budget_group: cat.budget_group,
    goal_balance: cat.goal_balance ?? null,
    balance_cap: cat.balance_cap ?? null,
    overflow_budget_category_id: cat.overflow_budget_category_id ?? null,
    is_archived: cat.is_archived === 1,
    account_ids: links.map((l) => l.account_id),
    target_accounts: targetMap.get(cat.id) ?? [],
    created_at: cat.created_at,
  };

  return c.json(result);
});

// DELETE /api/budget/categories/:id — cascade-deletes via FK
router.delete("/categories/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const db = createDb(c.env);
  const revision = await readBudgetMutationRevision(c.env.DB);
  if (await categoryHasDepreciationReferences(c.env.DB,id,toLocalDateString(),true)) {
    return c.json({ error: "depreciation_category_in_use" },409);
  }
  if (!await runBudgetGuardedBatch(c.env.DB,revision,[prepareMutation(c.env.DB,
    db.delete(budgetCategories).where(eq(budgetCategories.id,id)))])) return c.json({error:"depreciation_preview_stale"},409);
  return c.json({ success: true });
});

// POST /api/budget/allocations — upsert allocation
router.post("/allocations", async (c) => {
  const body = await c.req.json<{
    budget_category_id: number;
    year_month: string;
    currency?: string;
    fixed_amount?: number;
    income_ratio?: number;
    adhoc_amount?: number;
  }>();

  if (!body.budget_category_id || !body.year_month) {
    return c.json(
      { error: "budget_category_id and year_month are required" },
      400,
    );
  }

  const db = createDb(c.env);
  const scaleOptions = await loadMoneyScaleOptions(db);
  const invalidMoneyField = findInvalidMoneyField([
    {
      path: "fixed_amount",
      value: body.fixed_amount,
      currency: body.currency,
      decimalPlaces: decimalPlacesForCurrency(scaleOptions, body.currency),
    },
    {
      path: "adhoc_amount",
      value: body.adhoc_amount,
      currency: body.currency,
      decimalPlaces: decimalPlacesForCurrency(scaleOptions, body.currency),
    },
  ]);
  if (invalidMoneyField) {
    return c.json(invalidMoneyResponse(invalidMoneyField, body.currency), 400);
  }

  const currency = normalizeCurrency(body.currency);

  const values = {
    fixed_amount: toStorageMoneyAmount(
      body.fixed_amount ?? 0,
      currency,
      scaleOptions,
    ),
    income_ratio: body.income_ratio ?? 0,
    adhoc_amount: toStorageMoneyAmount(
      body.adhoc_amount ?? 0,
      currency,
      scaleOptions,
    ),
  };

  const [row] = await db
    .insert(budgetAllocations)
    .values({
      budget_category_id: body.budget_category_id,
      year_month: body.year_month,
      currency,
      ...values,
    })
    .onConflictDoUpdate({
      target: [
        budgetAllocations.budget_category_id,
        budgetAllocations.year_month,
        budgetAllocations.currency,
      ],
      set: values,
    })
    .returning();

  return c.json(
    row
      ? {
          ...row,
          fixed_amount: fromStorageMoneyAmount(
            row.fixed_amount,
            row.currency,
            scaleOptions,
          ),
          adhoc_amount: fromStorageMoneyAmount(
            row.adhoc_amount,
            row.currency,
            scaleOptions,
          ),
        }
      : row,
    201,
  );
});

// PATCH /api/budget/allocations — write delta as a log entry (budget_adjustment_logs only)
router.get("/depreciation-reset-plans", async (c) => {
  const id = Number(c.req.query("category_id"));
  const date = c.req.query("date") ?? toLocalDateString();
  if (!Number.isInteger(id) || id <= 0 || !isValidIsoDate(date)) return c.json({ error: "invalid reset query" },400);
  const scaleOptions = await loadMoneyScaleOptions(createDb(c.env));
  return c.json({plans: await getDepreciationResetPlans(c.env.DB,id,date,normalizeCurrency(c.req.query("currency")),scaleOptions)});
});

router.patch("/allocations", async (c) => {
  const body = await c.req.json<{
    budget_category_id: number;
    year_month: string;
    currency?: string;
    adhoc_delta: number;
    date?: string;
    note?: string | null;
    adjustment_type?: "allocation" | "reset";
    archive_category?: boolean;
    depreciation_decisions?: DepreciationResetInputDecision[];
  }>();

  if (!body.budget_category_id || !body.year_month) {
    return c.json(
      { error: "budget_category_id and year_month are required" },
      400,
    );
  }

  const db = createDb(c.env);
  const scaleOptions = await loadMoneyScaleOptions(db);
  const invalidMoneyField = findInvalidMoneyField([
    {
      path: "adhoc_delta",
      value: body.adhoc_delta,
      currency: body.currency,
      decimalPlaces: decimalPlacesForCurrency(scaleOptions, body.currency),
    },
  ]);
  if (invalidMoneyField) {
    return c.json(invalidMoneyResponse(invalidMoneyField, body.currency), 400);
  }

  const logDate = body.date ?? `${body.year_month}-01`;
  const currency = normalizeCurrency(body.currency);
  const adjustmentType =
    body.adjustment_type === "reset" ? "reset" : "allocation";
  if (body.archive_category && adjustmentType !== "reset") {
    return c.json({ error: "archive_category requires reset adjustment" }, 400);
  }
  const expectedRevision = await c.env.DB.prepare("SELECT revision FROM depreciation_budget_state WHERE id=1").first<{revision:number}>();
  const nextId = await c.env.DB.prepare("SELECT COALESCE(MAX(id),0)+1 AS id FROM budget_adjustment_logs").first<{id:number}>();
  const resetId = nextId!.id;
  const createdAt = new Date().toISOString().replace("T"," ").replace("Z","");
  let resetPlan: Awaited<ReturnType<typeof prepareDepreciationReset>> | null = null;
  if (adjustmentType === "reset") {
    try {
      resetPlan = await prepareDepreciationReset(c.env.DB, {categoryId:body.budget_category_id,
        date:logDate,currency,resetId,createdAt,decisions:body.depreciation_decisions ?? [],scaleOptions,
        archive:!!body.archive_category});
    } catch (error) {
      if (error instanceof DepreciationResetError) return c.json({error:error.code,plans:error.plans},409);
      throw error;
    }
  }
  if (resetPlan?.skipReset) return c.json({ok:true,carried:true,budget_category_id:body.budget_category_id});
  const statements = [
    c.env.DB.prepare("DELETE FROM depreciation_budget_apply_guard WHERE id=1"),
    c.env.DB.prepare("INSERT INTO depreciation_budget_apply_guard(id,expected_revision) VALUES(1,?)").bind(expectedRevision!.revision),
    c.env.DB.prepare(
      `INSERT INTO budget_adjustment_logs
        (id, budget_category_id, year_month, amount, currency, date, adjustment_type, note,created_at,reset_scope)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
    ).bind(
      resetId,
      body.budget_category_id,
      body.year_month,
      toStorageMoneyAmount(body.adhoc_delta, currency, scaleOptions),
      currency,
      logDate,
      adjustmentType,
      normalizeNote(body.note),
      createdAt,
      adjustmentType==="reset"?"category":null,
    ),
    ...(resetPlan?.statements ?? []),
  ];

  if (body.archive_category) {
    statements.push(
      c.env.DB.prepare(
        "UPDATE budget_categories SET is_archived = 1 WHERE id = ?",
      ).bind(body.budget_category_id),
    );
  }

  let results;
  try { results = await c.env.DB.batch(statements); }
  catch (error) {
    if (String(error).includes("depreciation_budget") || String(error).includes("stale")) return c.json({error:"depreciation_preview_stale"},409);
    throw error;
  }
  const logEntry = (
    results[2] as D1QueryResult<typeof budgetAdjustmentLogs.$inferSelect>
  ).results?.[0];

  if (!logEntry) return c.json({ error: "insert failed" }, 500);

  const [cat] = await db
    .select()
    .from(budgetCategories)
    .where(eq(budgetCategories.id, body.budget_category_id));

  return c.json({
    id: logEntry.id,
    budget_category_id: logEntry.budget_category_id,
    budget_category_name: cat?.name ?? null,
    year_month: logEntry.year_month,
    amount: fromStorageMoneyAmount(
      logEntry.amount,
      logEntry.currency,
      scaleOptions,
    ),
    currency: logEntry.currency,
    date: logEntry.date,
    created_at: logEntry.created_at,
    note: logEntry.note ?? null,
    type: adjustmentType === "reset" ? ("reset" as const) : ("manual" as const),
    adjustment_type: adjustmentType,
  });
});

// GET /api/budget/settings — get all settings fields
router.get("/settings", async (c) => {
  const db = createDb(c.env);
  const [row] = await db.select().from(budgetSettings);
  const ids: number[] = row?.preferred_payment_account_ids
    ? (JSON.parse(row.preferred_payment_account_ids) as number[])
    : [];
  const filterIds: number[] = row?.preferred_filter_ids
    ? (JSON.parse(row.preferred_filter_ids) as number[])
    : [];
  return c.json({
    preferred_payment_account_ids: ids,
    preferred_filter_ids: filterIds,
    calendar_week_start: normalizeCalendarWeekStart(row?.calendar_week_start),
    is_business_owner: Boolean(row?.is_business_owner ?? 0),
    business_advance_account_id: row?.business_advance_account_id ?? null,
    business_loss_account_id: row?.business_loss_account_id ?? null,
    business_advance_budget_category_id:
      row?.business_advance_budget_category_id ?? null,
  });
});

// PATCH /api/budget/settings — upsert settings fields
router.patch("/settings", async (c) => {
  const body = await c.req.json<{
    preferred_payment_account_ids?: number[];
    preferred_filter_ids?: number[];
    calendar_week_start?: number;
    is_business_owner?: boolean;
    business_advance_account_id?: number | null;
    business_loss_account_id?: number | null;
    business_advance_budget_category_id?: number | null;
  }>();

  const db = createDb(c.env);
  const [current] = await db.select().from(budgetSettings);
  const currentIds: number[] = current?.preferred_payment_account_ids
    ? (JSON.parse(current.preferred_payment_account_ids) as number[])
    : [];
  const currentFilterIds: number[] = current?.preferred_filter_ids
    ? (JSON.parse(current.preferred_filter_ids) as number[])
    : [];

  let newIds = currentIds;
  if ("preferred_payment_account_ids" in body) {
    const arr = body.preferred_payment_account_ids ?? [];
    if (!Array.isArray(arr) || arr.length > 5) {
      return c.json(
        {
          error:
            "preferred_payment_account_ids must be an array of up to 5 IDs",
        },
        400,
      );
    }
    newIds = arr.filter((id) => typeof id === "number" && id > 0);
  }

  let newFilterIds = currentFilterIds;
  if ("preferred_filter_ids" in body) {
    const arr = body.preferred_filter_ids ?? [];
    if (!Array.isArray(arr) || arr.length > 5) {
      return c.json(
        { error: "preferred_filter_ids must be an array of up to 5 IDs" },
        400,
      );
    }
    newFilterIds = arr.filter((id) => typeof id === "number" && id > 0);
  }

  const newCalendarWeekStart =
    "calendar_week_start" in body
      ? body.calendar_week_start
      : normalizeCalendarWeekStart(current?.calendar_week_start);
  if (
    typeof newCalendarWeekStart !== "number" ||
    !Number.isInteger(newCalendarWeekStart) ||
    newCalendarWeekStart < 0 ||
    newCalendarWeekStart > 6
  ) {
    return c.json(
      { error: "calendar_week_start must be an integer from 0 to 6" },
      400,
    );
  }

  const newIsBusinessOwner =
    "is_business_owner" in body
      ? body.is_business_owner
        ? 1
        : 0
      : (current?.is_business_owner ?? 0);

  const newAdvanceAccountId =
    "business_advance_account_id" in body
      ? (body.business_advance_account_id ?? null)
      : (current?.business_advance_account_id ?? null);

  const newLossAccountId =
    "business_loss_account_id" in body
      ? (body.business_loss_account_id ?? null)
      : (current?.business_loss_account_id ?? null);

  const newAdvanceBudgetCategoryId =
    "business_advance_budget_category_id" in body
      ? (body.business_advance_budget_category_id ?? null)
      : (current?.business_advance_budget_category_id ?? null);

  await db
    .insert(budgetSettings)
    .values({
      id: 1,
      preferred_payment_account_ids: JSON.stringify(newIds),
      preferred_filter_ids: JSON.stringify(newFilterIds),
      calendar_week_start: newCalendarWeekStart,
      is_business_owner: newIsBusinessOwner,
      business_advance_account_id: newAdvanceAccountId,
      business_loss_account_id: newLossAccountId,
      business_advance_budget_category_id: newAdvanceBudgetCategoryId,
    })
    .onConflictDoUpdate({
      target: budgetSettings.id,
      set: {
        preferred_payment_account_ids: JSON.stringify(newIds),
        preferred_filter_ids: JSON.stringify(newFilterIds),
        calendar_week_start: newCalendarWeekStart,
        is_business_owner: newIsBusinessOwner,
        business_advance_account_id: newAdvanceAccountId,
        business_loss_account_id: newLossAccountId,
        business_advance_budget_category_id: newAdvanceBudgetCategoryId,
      },
    });

  return c.json({
    preferred_payment_account_ids: newIds,
    preferred_filter_ids: newFilterIds,
    calendar_week_start: normalizeCalendarWeekStart(newCalendarWeekStart),
    is_business_owner: Boolean(newIsBusinessOwner),
    business_advance_account_id: newAdvanceAccountId,
    business_loss_account_id: newLossAccountId,
    business_advance_budget_category_id: newAdvanceBudgetCategoryId,
  });
});

// GET /api/budget/adjustment-logs — list budget adjustment log entries (manual + income) and expense allocations
// Query params: ?from=YYYY-MM-DD&to=YYYY-MM-DD (optional date range)
router.get("/adjustment-logs", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  const resetsOnly = c.req.query("resets_only") === "1";
  const currency = normalizeCurrency(c.req.query("currency"));

  const db = createDb(c.env);
  const scaleOptions = await loadMoneyScaleOptions(db);

  const cats = await db.select().from(budgetCategories);
  const catMap = new Map(cats.map((cat) => [cat.id, cat.name]));

  // All budget adjustment logs (manual: journal_entry_id IS NULL, income: journal_entry_id IS NOT NULL)
  const adjLogs = await db
    .select()
    .from(budgetAdjustmentLogs)
    .orderBy(sql`${budgetAdjustmentLogs.date} DESC`);

  // Journal-entry-backed expense allocations are needed even for reset-only
  // responses because they determine the reset's effective amount.
  const journalAllocRows = await db
    .select({
      id: journalEntryBudgetAllocations.id,
      journal_entry_id: journalEntryBudgetAllocations.journal_entry_id,
      budget_category_id: journalEntryBudgetAllocations.budget_category_id,
      amount: journalEntryBudgetAllocations.amount,
      currency: journalEntryBudgetAllocations.currency,
      source: journalEntryBudgetAllocations.source,
      is_reference: journalEntryBudgetAllocations.is_reference,
      date: journalEntries.date,
      // Use the journal's stable creation time so later allocation edits do
      // not move historical spending across a same-day reset.
      created_at: journalEntries.created_at,
    })
    .from(journalEntryBudgetAllocations)
    .innerJoin(
      journalEntries,
      eq(journalEntryBudgetAllocations.journal_entry_id, journalEntries.id),
    );

  const fundingRows = await db
    .select({
      id: budgetFundingAllocations.id,
      journal_entry_id: budgetFundingAllocations.journal_entry_id,
      budget_category_id: budgetFundingAllocations.budget_category_id,
      kind: budgetFundingAllocations.kind,
      effect: budgetFundingAllocations.effect,
      amount: budgetFundingAllocations.amount,
      currency: budgetFundingAllocations.currency,
      created_at: budgetFundingAllocations.created_at,
      date: journalEntries.date,
      source_date: sourceFundingEntries.date,
      source_created_at: sourceFundingEntries.created_at,
    })
    .from(budgetFundingAllocations)
    .innerJoin(
      journalEntries,
      eq(budgetFundingAllocations.journal_entry_id, journalEntries.id),
    )
    .leftJoin(
      sourceFundingEntries,
      eq(
        budgetFundingAllocations.source_journal_entry_id,
        sourceFundingEntries.id,
      ),
    );

  const decodedAdjustmentHistory = adjLogs.map((row) => ({
    budget_category_id: row.budget_category_id,
    year_month: row.year_month,
    amount: fromStorageMoneyAmount(row.amount, row.currency, scaleOptions),
    currency: normalizeCurrency(row.currency),
    date: row.date,
    adjustment_type: row.adjustment_type,
    created_at: row.created_at,
  }));

  type LogEntry = {
    id: number;
    budget_category_id: number;
    budget_category_name: string | null;
    year_month: string;
    amount: number;
    currency: string;
    date: string;
    created_at: string;
    note?: string | null;
    type:
      | "manual"
      | "reset"
      | "income"
      | "transfer"
      | "simple"
      | "multiline"
      | "funding";
    adjustment_type?: "allocation" | "reset" | "transfer";
    journal_entry_id?: number;
    is_reference?: boolean;
    depreciation_schedule_id?: number | null;
    depreciation_event_key?: string | null;
  };

  const combined: LogEntry[] = [
    ...adjLogs.map((row) => ({
      id: row.id,
      budget_category_id: row.budget_category_id,
      budget_category_name: catMap.get(row.budget_category_id) ?? null,
      year_month: row.year_month,
      amount: fromStorageMoneyAmount(row.amount, row.currency, scaleOptions),
      currency: row.currency,
      date: row.date,
      created_at: row.created_at,
      note: row.note ?? null,
      type: (row.adjustment_type === "reset"
        ? "reset"
        : row.adjustment_type === "transfer"
          ? "transfer"
        : row.journal_entry_id != null
          ? "income"
          : "manual") as "reset" | "transfer" | "income" | "manual",
      adjustment_type:
        (row.adjustment_type === "reset"
          ? "reset"
          : row.adjustment_type === "transfer"
            ? "transfer"
            : "allocation") as "allocation" | "reset" | "transfer",
      journal_entry_id: row.journal_entry_id ?? undefined,
      depreciation_schedule_id: row.depreciation_schedule_id,
      depreciation_event_key: row.depreciation_event_key,
    })),
    ...journalAllocRows.map((row) => ({
      id: row.id,
      budget_category_id: row.budget_category_id,
      budget_category_name: catMap.get(row.budget_category_id) ?? null,
      year_month: row.date.slice(0, 7),
      amount: fromStorageMoneyAmount(row.amount, row.currency, scaleOptions),
      currency: row.currency,
      date: row.date,
      created_at: row.created_at,
      note: null,
      type: (row.source === "simple" ? "simple" : "multiline") as
        | "simple"
        | "multiline",
      journal_entry_id: row.journal_entry_id,
      is_reference: row.is_reference === 1,
    })),
    ...fundingRows.flatMap((row) => {
      if (row.budget_category_id == null) return [];

      const yearMonth = row.date.slice(0, 7);
      const fundingAmount = fromStorageMoneyAmount(
        row.amount,
        row.currency,
        scaleOptions,
      );
      const effectiveAmount =
        sumBudgetFundingAfterResetsByPeriod(
          [
            {
              journal_entry_id: row.journal_entry_id,
              budget_category_id: row.budget_category_id,
              kind: row.kind,
              effect: row.effect,
              amount: fundingAmount,
              date: row.date,
              created_at: row.created_at,
              source_date: row.source_date,
              source_created_at: row.source_created_at,
            },
          ],
          decodedAdjustmentHistory.filter((log) =>
            log.currency === normalizeCurrency(row.currency) &&
            log.adjustment_type === "reset" &&
            (log.date < row.date ||
              (log.date === row.date && log.created_at <= row.created_at)),
          ),
          new Map([
            [
              yearMonth,
              { start: `${yearMonth}-01`, end: monthEndDate(yearMonth) },
            ],
          ]),
        ).get(`${row.budget_category_id}:${yearMonth}`)?.net ?? 0;

      return [
        {
          id: row.id,
          budget_category_id: row.budget_category_id,
          budget_category_name:
            catMap.get(row.budget_category_id) ?? null,
          year_month: yearMonth,
          amount: effectiveAmount,
          currency: row.currency,
          date: row.date,
          created_at: row.created_at,
          note: null,
          type: "funding" as const,
          journal_entry_id: row.journal_entry_id,
          is_reference: effectiveAmount === 0,
        },
      ];
    }),
  ];

  // Recompute reset amounts using full history before applying query filters.
  const replayed = replayBudgetHistory(
    combined.filter((row) => normalizeCurrency(row.currency) === currency),
  ).logs;
  const filtered = replayed.filter((row) => {
    if (resetsOnly && row.adjustment_type !== "reset") return false;
    if (from && row.date < from) return false;
    if (to && row.date > to) return false;
    return true;
  });

  filtered.sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      b.created_at.localeCompare(a.created_at) ||
      b.id - a.id,
  );

  return c.json(filtered);
});

// DELETE /api/budget/adjustment-logs/:id — delete a log entry (manual or income-linked)
router.delete("/adjustment-logs/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const db = createDb(c.env);
  const mutationRevision=await readBudgetMutationRevision(c.env.DB);
  const scaleOptions = await loadMoneyScaleOptions(db);

  const [existing] = await db
    .select()
    .from(budgetAdjustmentLogs)
    .where(eq(budgetAdjustmentLogs.id, id));

  if (!existing) return c.json({ error: "not found" }, 404);

  if (existing.depreciation_schedule_id != null) return c.json({error:"managed_depreciation_budget"},409);
  if(existing.adjustment_type==="reset"&&await isManagedDepreciationReset(c.env.DB,id)) return c.json({error:"managed_depreciation_reset"},409);
  if(!await runBudgetGuardedBatch(c.env.DB,mutationRevision,[prepareMutation(c.env.DB,
    db.delete(budgetAdjustmentLogs).where(eq(budgetAdjustmentLogs.id,id)))])) return c.json({error:"depreciation_preview_stale"},409);

  return c.json({ ok: true });
});

// PATCH /api/budget/adjustment-logs/:id — edit a manual log entry
router.patch("/adjustment-logs/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{
    amount?: number;
    date?: string;
    note?: string | null;
  }>();
  const db = createDb(c.env);
  const mutationRevision=await readBudgetMutationRevision(c.env.DB);
  const scaleOptions = await loadMoneyScaleOptions(db);

  const [existing] = await db
    .select()
    .from(budgetAdjustmentLogs)
    .where(eq(budgetAdjustmentLogs.id, id));

  if (!existing) return c.json({ error: "not found" }, 404);

  if (existing.depreciation_schedule_id != null) return c.json({error:"managed_depreciation_budget"},409);
  if(body.date!==undefined&&existing.adjustment_type==="reset"&&await isManagedDepreciationReset(c.env.DB,id)) return c.json({error:"managed_depreciation_reset"},409);
  if (body.date !== undefined && !isValidIsoDate(body.date)) {
    return c.json({ error: "date must be a valid YYYY-MM-DD date" }, 400);
  }

  const isReset = existing.adjustment_type === "reset";
  if (body.amount !== undefined && !isReset) {
    const invalidMoneyField = findInvalidMoneyField([
      {
        path: "amount",
        value: body.amount,
        currency: existing.currency,
        decimalPlaces: decimalPlacesForCurrency(
          scaleOptions,
          existing.currency,
        ),
      },
    ]);
    if (invalidMoneyField) {
      return c.json(
        invalidMoneyResponse(invalidMoneyField, existing.currency),
        400,
      );
    }
  }

  const updates: Record<string, unknown> = {};
  if (body.amount !== undefined && !isReset) {
    updates.amount = toStorageMoneyAmount(
      body.amount,
      existing.currency,
      scaleOptions,
    );
  }
  if (body.date !== undefined) {
    updates.date = body.date;
    updates.year_month = body.date.slice(0, 7);
  }
  if ("note" in body) updates.note = normalizeNote(body.note);

  if (Object.keys(updates).length > 0) {
    const update=db
      .update(budgetAdjustmentLogs)
      .set(updates)
      .where(eq(budgetAdjustmentLogs.id, id));
    if(!await runBudgetGuardedBatch(c.env.DB,mutationRevision,[prepareMutation(c.env.DB,update)]))
      return c.json({error:"depreciation_preview_stale"},409);
  }

  const [updated] = await db
    .select()
    .from(budgetAdjustmentLogs)
    .where(eq(budgetAdjustmentLogs.id, id));

  if (!updated) return c.json({ error: "not found" }, 404);

  const [cat] = await db
    .select()
    .from(budgetCategories)
    .where(eq(budgetCategories.id, updated.budget_category_id));

  return c.json({
    id: updated.id,
    budget_category_id: updated.budget_category_id,
    budget_category_name: cat?.name ?? null,
    year_month: updated.year_month,
    amount: fromStorageMoneyAmount(updated.amount, updated.currency, scaleOptions),
    currency: updated.currency,
    date: updated.date,
    created_at: updated.created_at,
    note: updated.note ?? null,
    type:
      updated.adjustment_type === "reset"
        ? ("reset" as const)
        : updated.adjustment_type === "transfer"
          ? ("transfer" as const)
        : ("manual" as const),
    adjustment_type:
      updated.adjustment_type === "reset"
        ? "reset"
        : updated.adjustment_type === "transfer"
          ? "transfer"
          : "allocation",
  });
});

// Helper: fetch per-entry budget allocations for a date range
async function fetchEntryAllocsForPeriod(
  db: ReturnType<typeof createDb>,
  dateStart: string,
  dateEnd: string,
  currency: string,
  scaleOptions: MoneyScaleOptions,
): Promise<
  {
    allocation_id: number;
    journal_entry_id: number;
    budget_category_id: number;
    amount: number;
    is_reference: number;
    depreciation_schedule_id: number | null;
    date: string;
    created_at: string;
  }[]
> {
  const rows = await db
    .select({
      allocation_id: journalEntryBudgetAllocations.id,
      journal_entry_id: journalEntryBudgetAllocations.journal_entry_id,
      budget_category_id: journalEntryBudgetAllocations.budget_category_id,
      amount: journalEntryBudgetAllocations.amount,
      is_reference: journalEntryBudgetAllocations.is_reference,
      depreciation_schedule_id: depreciationEntries.schedule_id,
      date: journalEntries.date,
      created_at: journalEntries.created_at,
    })
    .from(journalEntryBudgetAllocations)
    .innerJoin(
      journalEntries,
      eq(journalEntryBudgetAllocations.journal_entry_id, journalEntries.id),
    )
    .leftJoin(
      depreciationEntries,
      eq(depreciationEntries.journal_entry_id, journalEntries.id),
    )
    .leftJoin(depreciationSchedules,eq(depreciationSchedules.id,depreciationEntries.schedule_id))
    .where(
      and(
        sql`${journalEntries.date} >= ${dateStart}`,
        sql`${journalEntries.date} <= ${dateEnd}`,
        eq(journalEntryBudgetAllocations.currency, currency),
        sql`${depreciationSchedules.budget_method} IS NULL`,
      ),
    );
  return rows.map((row) => ({
    ...row,
    amount: fromStorageMoneyAmount(row.amount, currency, scaleOptions),
  }));
}

// Helper: compute year-month string N months before a given year/month
function subtractMonths(year: number, month: number, n: number): string {
  let y = year;
  let m = month - n;
  while (m <= 0) {
    y--;
    m += 12;
  }
  while (m > 12) {
    y++;
    m -= 12;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

// Helper: compute last day of a year-month as YYYY-MM-DD
function monthEndDate(ym: string): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const nm =
    m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return new Date(new Date(nm + "-01").getTime() - 86400000)
    .toISOString()
    .slice(0, 10);
}

// GET /api/budget/summary?year_month=YYYY-MM[&as_of=YYYY-MM-DD] — compute full budget summary
function yearMonthIndex(ym: string): number {
  const [year, month] = ym.split("-").map(Number) as [number, number];
  return year * 12 + month;
}

function listYearMonths(from: string, to: string): string[] {
  const months: string[] = [];
  const [fromYear, fromMonth] = from.split("-").map(Number) as [number, number];
  const [toYear, toMonth] = to.split("-").map(Number) as [number, number];
  const totalMonths = (toYear - fromYear) * 12 + (toMonth - fromMonth);

  for (let i = 0; i <= totalMonths; i++) {
    months.push(subtractMonths(fromYear, fromMonth + i, 0));
  }
  return months;
}

type BudgetSummaryTarget = {
  yearMonth: string;
  effectiveEnd?: string;
};

/** Read-only hypothetical inputs used by the depreciation correction preview. */
export interface BudgetSummaryOverrides {
  adjustmentLogs?: (typeof budgetAdjustmentLogs.$inferSelect)[];
  extraCategories?: (typeof budgetCategories.$inferSelect)[];
  excludeLegacyScheduleId?: number;
  excludeAllocationIds?: number[];
  through?: {date: string; created_at: string};
}

export async function computeBudgetSummaries(
  db: ReturnType<typeof createDb>,
  currency: string,
  scaleOptions: MoneyScaleOptions,
  targets: BudgetSummaryTarget[],
  overrides: BudgetSummaryOverrides = {},
): Promise<BudgetSummary[]> {
  if (targets.length === 0) return [];

  const targetMonths = [...targets.map((target) => target.yearMonth)].sort();
  const firstTargetYm = targetMonths[0]!;
  const lastTargetYm = targetMonths.at(-1)!;

  const [
    allCats,
    links,
    targetRows,
    oldestBudgetLog,
    oldestEntryAlloc,
    oldestFunding,
    depreciationCategoryRows,
  ] =
    await Promise.all([
      db
        .select()
        .from(budgetCategories)
        .orderBy(budgetCategories.sort_order, budgetCategories.name),
      db.select().from(budgetCategoryAccounts),
      fetchBudgetCategoryTargetRows(db),
      db
        .select({
          min_ym: sql<string>`MIN(${budgetAdjustmentLogs.year_month})`,
        })
        .from(budgetAdjustmentLogs)
        .where(eq(budgetAdjustmentLogs.currency, currency)),
      db
        .select({
          min_ym: sql<string>`MIN(substr(${journalEntries.date}, 1, 7))`,
        })
        .from(journalEntryBudgetAllocations)
        .innerJoin(
          journalEntries,
          eq(journalEntryBudgetAllocations.journal_entry_id, journalEntries.id),
        )
        .where(eq(journalEntryBudgetAllocations.currency, currency)),
      db
        .select({
          min_ym: sql<string>`MIN(substr(${journalEntries.date}, 1, 7))`,
        })
        .from(budgetFundingAllocations)
        .innerJoin(
          journalEntries,
          eq(budgetFundingAllocations.journal_entry_id, journalEntries.id),
        )
        .where(eq(budgetFundingAllocations.currency, currency)),
      db.selectDistinct({id:budgetAdjustmentLogs.budget_category_id}).from(budgetAdjustmentLogs)
        .where(sql`${budgetAdjustmentLogs.depreciation_schedule_id} IS NOT NULL`),
    ]);

  const depreciationCategoryIds = new Set(depreciationCategoryRows.map(row => row.id));
  const cats = [...allCats,...overrides.extraCategories ?? []].filter(cat =>
    cat.is_archived !== 1 || depreciationCategoryIds.has(cat.id));
  const targetMap = buildTargetAccountMap(targetRows);
  const oldestYm = [
    oldestBudgetLog[0]?.min_ym,
    oldestEntryAlloc[0]?.min_ym,
    oldestFunding[0]?.min_ym,
    ...overrides.adjustmentLogs?.map(row => row.year_month) ?? [],
  ]
    .filter((value): value is string => Boolean(value))
    .sort()[0];
  const calculationStartYm =
    oldestYm && oldestYm < firstTargetYm ? oldestYm : firstTargetYm;

  const allMonths = listYearMonths(calculationStartYm, lastTargetYm);
  const fullMonthDateRangeMap = new Map<string, DateRange>(
    allMonths.map((yearMonth) => [
      yearMonth,
      { start: `${yearMonth}-01`, end: monthEndDate(yearMonth) },
    ]),
  );

  const storedAdhocLogRows =
    allMonths.length > 0
      ? await db
          .select({
            budget_category_id: budgetAdjustmentLogs.budget_category_id,
            year_month: budgetAdjustmentLogs.year_month,
            amount: budgetAdjustmentLogs.amount,
            date: budgetAdjustmentLogs.date,
            adjustment_type: budgetAdjustmentLogs.adjustment_type,
            created_at: budgetAdjustmentLogs.created_at,
          })
          .from(budgetAdjustmentLogs)
          .where(
            and(
              inArray(budgetAdjustmentLogs.year_month, allMonths),
              eq(budgetAdjustmentLogs.currency, currency),
            ),
          )
      : [];
  const isVisible = (row: {date:string;created_at:string}) => !overrides.through ||
    row.date < overrides.through.date || (row.date === overrides.through.date && row.created_at <= overrides.through.created_at);
  const adhocLogRows = (overrides.adjustmentLogs ?? storedAdhocLogRows)
    .filter(row => (!("currency" in row) || row.currency === currency) && isVisible(row));
  const decodedAdhocLogRows = adhocLogRows.map((row) => ({
    ...row,
    amount: fromStorageMoneyAmount(row.amount, currency, scaleOptions),
  }));

  const fundingRows =
    allMonths.length > 0
      ? await db
          .select({
            journal_entry_id: budgetFundingAllocations.journal_entry_id,
            budget_category_id:
              budgetFundingAllocations.budget_category_id,
            kind: budgetFundingAllocations.kind,
            effect: budgetFundingAllocations.effect,
            amount: budgetFundingAllocations.amount,
            date: journalEntries.date,
            created_at: budgetFundingAllocations.created_at,
            source_date: sourceFundingEntries.date,
            source_created_at: sourceFundingEntries.created_at,
          })
          .from(budgetFundingAllocations)
          .innerJoin(
            journalEntries,
            eq(budgetFundingAllocations.journal_entry_id, journalEntries.id),
          )
          .leftJoin(
            sourceFundingEntries,
            eq(
              budgetFundingAllocations.source_journal_entry_id,
              sourceFundingEntries.id,
            ),
          )
          .where(
            and(
              eq(budgetFundingAllocations.currency, currency),
              sql`${journalEntries.date} >= ${calculationStartYm + "-01"}`,
              sql`${journalEntries.date} <= ${monthEndDate(lastTargetYm)}`,
            ),
          )
      : [];
  const decodedFundingRows = fundingRows.filter(isVisible).map((row) => ({
    ...row,
    amount: fromStorageMoneyAmount(row.amount, currency, scaleOptions),
  }));

  const depreciationReservationRows =
    allMonths.length > 0
      ? await db
          .select({
            schedule_id: depreciationBudgetReservations.schedule_id,
            budget_category_id:
              depreciationBudgetReservations.budget_category_id,
            amount: depreciationBudgetReservations.amount,
            date: depreciationSourceEntries.date,
            created_at: depreciationSourceEntries.created_at,
          })
          .from(depreciationBudgetReservations)
          .innerJoin(
            depreciationSchedules,
            eq(
              depreciationSchedules.id,
              depreciationBudgetReservations.schedule_id,
            ),
          )
          .innerJoin(
            depreciationSourceEntries,
            eq(
              depreciationSourceEntries.id,
              depreciationSchedules.source_journal_entry_id,
            ),
          )
          .where(
            and(
              eq(depreciationBudgetReservations.currency, currency),
              sql`${depreciationSchedules.budget_method} IS NULL`,
              sql`${depreciationSourceEntries.date} >= ${calculationStartYm + "-01"}`,
              sql`${depreciationSourceEntries.date} <= ${monthEndDate(lastTargetYm)}`,
            ),
          )
      : [];
  const decodedDepreciationReservationRows = depreciationReservationRows
    .filter(row => row.schedule_id !== overrides.excludeLegacyScheduleId && isVisible(row)).map(
    (row) => ({
      ...row,
      amount: fromStorageMoneyAmount(row.amount, currency, scaleOptions),
    }),
  );

  const incomeAccountRows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.type, "income"));
  const incomeAccountIds = incomeAccountRows.map((row) => row.id);
  let incomeRowsForRange: {
    year_month: string;
    date: string;
    total: number;
  }[] = [];
  if (incomeAccountIds.length > 0) {
    incomeRowsForRange = await db
      .select({
        year_month: sql<string>`substr(${journalEntries.date}, 1, 7)`,
        date: journalEntries.date,
        total: sql<number>`COALESCE(SUM(${journalLines.credit} - ${journalLines.debit}), 0)`,
      })
      .from(journalLines)
      .innerJoin(
        journalEntries,
        eq(journalLines.journal_entry_id, journalEntries.id),
      )
      .where(
        and(
          inArray(journalLines.account_id, incomeAccountIds),
          sql`${journalEntries.date} >= ${firstTargetYm + "-01"}`,
          sql`${journalEntries.date} <= ${monthEndDate(lastTargetYm)}`,
          eq(journalLines.currency, currency),
        ),
      )
      .groupBy(sql`substr(${journalEntries.date}, 1, 7)`, journalEntries.date);
  }

  const firstRange = fullMonthDateRangeMap.get(calculationStartYm);
  const lastRange = fullMonthDateRangeMap.get(lastTargetYm);
  const entryAllocsForRange =
    firstRange && lastRange
      ? await fetchEntryAllocsForPeriod(
          db,
          firstRange.start,
          lastRange.end,
          currency,
          scaleOptions,
        )
      : [];
  const entryAllocsByMonth = groupBudgetEntryAllocationsByMonth(
    entryAllocsForRange.filter(row =>
      row.depreciation_schedule_id !== overrides.excludeLegacyScheduleId &&
      !overrides.excludeAllocationIds?.includes(row.allocation_id) && isVisible(row)),
    fullMonthDateRangeMap,
  );

  return targets.map((target) => {
    const ym = target.yearMonth;
    const targetIndex = allMonths.indexOf(ym);
    const monthsForTarget = allMonths.slice(0, targetIndex + 1);
    const monthDateRangeMap = new Map<string, DateRange>();
    for (const monthKey of monthsForTarget) {
      const range = fullMonthDateRangeMap.get(monthKey)!;
      monthDateRangeMap.set(
        monthKey,
        monthKey === ym && target.effectiveEnd
          ? { start: range.start, end: target.effectiveEnd }
          : range,
      );
    }

    const adhocSumMap = sumBudgetAdjustmentLogsAfterResetsByPeriod(
      decodedAdhocLogRows,
      monthDateRangeMap,
    );
    const fundingSumMap = sumBudgetFundingAfterResetsByPeriod(
      decodedFundingRows,
      decodedAdhocLogRows,
      monthDateRangeMap,
    );

    function adhocFor(catId: number, yearMonthKey: string): number {
      return adhocSumMap.get(`${catId}:${yearMonthKey}`) ?? 0;
    }

    function fundingFor(catId: number, yearMonthKey: string) {
      return (
        fundingSumMap.get(`${catId}:${yearMonthKey}`) ?? {
          net: 0,
          borrowed: 0,
          lent: 0,
          restored: 0,
          discarded: 0,
          converted_to_own: 0,
          reset_cutoff: 0,
        }
      );
    }

    function resetPointFor(catId: number, yearMonthKey: string) {
      const range = monthDateRangeMap.get(yearMonthKey);
      if (!range) return null;
      return findLatestResetPointForPeriod(decodedAdhocLogRows, catId, range);
    }

    function entryAllocsForMonth(yearMonthKey: string) {
      const range = monthDateRangeMap.get(yearMonthKey);
      if (!range) return [];
      return (entryAllocsByMonth.get(yearMonthKey) ?? []).filter(
        (entryAlloc) =>
          entryAlloc.date >= range.start && entryAlloc.date <= range.end,
      );
    }

    function depreciationReservationsForMonth(yearMonthKey: string) {
      const range = monthDateRangeMap.get(yearMonthKey);
      if (!range) return [];
      return decodedDepreciationReservationRows.filter(
        (reservation) =>
          reservation.date >= range.start && reservation.date <= range.end,
      );
    }

    function monthlyIncomeForTarget(): number {
      const range = monthDateRangeMap.get(ym);
      if (!range) return 0;
      const total = incomeRowsForRange
        .filter(
          (row) =>
            row.year_month === ym &&
            row.date >= range.start &&
            row.date <= range.end,
        )
        .reduce((sum, row) => sum + (row.total ?? 0), 0);
      return fromStorageMoneyAmount(total, currency, scaleOptions);
    }

    const categorySummaries: BudgetCategorySummary[] = [];
    for (const cat of cats) {
      const accountIds = links
        .filter((link) => link.budget_category_id === cat.id)
        .map((link) => link.account_id);
      const currentRange = monthDateRangeMap.get(ym)!;
      const currentResetPoint = resetPointFor(cat.id, ym);
      const currentFunding = fundingFor(cat.id, ym);
      const ownBudgetBase = adhocFor(cat.id, ym);
      const budgetBase = ownBudgetBase + currentFunding.net;
      const referenceSpent = calculateReferenceSpentFromBudgetAllocations(
        cat.id,
        entryAllocsForMonth(ym).filter((entryAlloc) =>
          isAfterBudgetResetPoint(entryAlloc, currentResetPoint),
        ),
      );

      let carryover = 0;
      let cashBasisCarryover = 0;
      let fundingCarryover = 0;
      let borrowedFundingCarryover = 0;
      let lentFundingCarryover = 0;
      const activeDepreciationReservations = new Map<number, number>();

      function spendingForMonth(monthKey: string) {
        const resetPoint = resetPointFor(cat.id, monthKey);
        return calculateDepreciationBudgetMonth({
          budgetCategoryId: cat.id,
          resetPoint,
          reservations: depreciationReservationsForMonth(monthKey),
          allocations: entryAllocsForMonth(monthKey),
          activeReservations: activeDepreciationReservations,
        });
      }

      for (const monthKey of monthsForTarget.slice(0, -1)) {
        const resetPoint = resetPointFor(cat.id, monthKey);
        const monthlyFunding = fundingFor(cat.id, monthKey);
        const base = adhocFor(cat.id, monthKey) + monthlyFunding.net;
        const monthlySpending = spendingForMonth(monthKey);
        carryover = calculateNextCarryover({
          budgetBase: base,
          carryover: resetPoint ? 0 : carryover,
          spent: monthlySpending.spent,
          isInPositiveRolloverWindow: true,
        });
        cashBasisCarryover = calculateNextCarryover({
          budgetBase: base,
          carryover: resetPoint ? 0 : cashBasisCarryover,
          spent: monthlySpending.cash_basis_spent,
          isInPositiveRolloverWindow: true,
        });
        fundingCarryover =
          (resetPoint ? 0 : fundingCarryover) + monthlyFunding.net;
        borrowedFundingCarryover =
          (resetPoint ? 0 : borrowedFundingCarryover) +
          monthlyFunding.borrowed;
        lentFundingCarryover =
          (resetPoint ? 0 : lentFundingCarryover) + monthlyFunding.lent;
      }

      const currentSpending = spendingForMonth(ym);
      const spent = currentSpending.spent;
      const visibleCarryover = currentResetPoint ? 0 : carryover;
      const visibleCashBasisCarryover = currentResetPoint
        ? 0
        : cashBasisCarryover;
      const fundingAdjustment =
        (currentResetPoint ? 0 : fundingCarryover) + currentFunding.net;
      const borrowedFunding =
        (currentResetPoint ? 0 : borrowedFundingCarryover) +
        currentFunding.borrowed;
      const lentFunding =
        (currentResetPoint ? 0 : lentFundingCarryover) +
        currentFunding.lent;
      const fundingHistory = monthsForTarget.reduce(
        (totals, monthKey) => {
          const monthly = fundingFor(cat.id, monthKey);
          totals.restored += monthly.restored;
          totals.discarded += monthly.discarded;
          totals.convertedToOwn += monthly.converted_to_own;
          totals.resetCutoff += monthly.reset_cutoff;
          return totals;
        },
        {
          restored: 0,
          discarded: 0,
          convertedToOwn: 0,
          resetCutoff: 0,
        },
      );
      const totalBudget = budgetBase + visibleCarryover;
      const cashBasisTotalBudget = budgetBase + visibleCashBasisCarryover;
      let monthsWithContributions = 0;
      for (const monthKey of monthsForTarget.slice(0, -1)) {
        if (adhocFor(cat.id, monthKey) !== 0) monthsWithContributions++;
      }
      if (budgetBase !== 0) monthsWithContributions++;

      categorySummaries.push({
        category: {
          id: cat.id,
          name: cat.name,
          sort_order: cat.sort_order,
          rollover_months: cat.rollover_months,
          budget_group: cat.budget_group,
          goal_balance: cat.goal_balance ?? null,
          balance_cap: cat.balance_cap ?? null,
          overflow_budget_category_id: cat.overflow_budget_category_id ?? null,
          is_archived: cat.is_archived === 1,
          account_ids: accountIds,
          target_accounts: targetMap.get(cat.id) ?? [],
          created_at: cat.created_at,
        },
        budget_base: budgetBase,
        carryover: visibleCarryover,
        show_carryover: shouldShowCarryoverForPeriod(
          decodedAdhocLogRows,
          cat.id,
          currentRange,
        ),
        reset_date: findLatestResetDateForPeriod(
          decodedAdhocLogRows,
          cat.id,
          currentRange,
        ),
        total_budget: totalBudget,
        spent,
        reference_spent: referenceSpent,
        reference_reserve: 0,
        depreciation_spent: currentSpending.recognized_depreciation,
        depreciation_reserve: currentSpending.reservation_remaining,
        depreciation_reservation_added: currentSpending.reservation_added,
        uncovered_depreciation_spent:
          currentSpending.uncovered_depreciation,
        cash_basis_carryover: visibleCashBasisCarryover,
        cash_basis_total_budget: cashBasisTotalBudget,
        cash_basis_available:
          cashBasisTotalBudget - currentSpending.cash_basis_spent,
        available: totalBudget - spent,
        funding_adjustment: fundingAdjustment,
        borrowed_funding: borrowedFunding,
        lent_funding: lentFunding,
        restored_funding: fundingHistory.restored,
        discarded_funding: fundingHistory.discarded,
        converted_to_own_funding: fundingHistory.convertedToOwn,
        reset_cutoff_funding: fundingHistory.resetCutoff,
        months_with_contributions: monthsWithContributions,
      });
    }

    const cashBasisSummaries = categorySummaries.map((summary) => ({
      ...summary,
      carryover: summary.cash_basis_carryover ?? summary.carryover,
      total_budget: summary.cash_basis_total_budget ?? summary.total_budget,
      available: summary.cash_basis_available ?? summary.available,
    }));
    applyBudgetBalanceCaps(categorySummaries);
    applyBudgetBalanceCaps(cashBasisSummaries);
    const cashBasisByCategoryId = new Map(
      cashBasisSummaries.map((summary) => [summary.category.id, summary]),
    );
    for (const summary of categorySummaries) {
      const cashBasis = cashBasisByCategoryId.get(summary.category.id);
      summary.depreciation_non_cash_offset = Math.max(
        0,
        Math.max(cashBasis?.available ?? summary.available, 0) -
          Math.max(summary.available, 0),
      );
    }

    return {
      year_month: ym,
      currency,
      monthly_income: monthlyIncomeForTarget(),
      categories: categorySummaries,
      total_budget: categorySummaries.reduce((s, c) => s + c.total_budget, 0),
      total_spent: categorySummaries.reduce((s, c) => s + c.spent, 0),
      total_reference_spent: categorySummaries.reduce(
        (s, c) => s + (c.reference_spent ?? 0),
        0,
      ),
      total_reference_reserve: categorySummaries.reduce(
        (s, c) => s + (c.reference_reserve ?? 0),
        0,
      ),
      total_depreciation_reserve: categorySummaries.reduce(
        (s, c) => s + (c.depreciation_reserve ?? 0),
        0,
      ),
      total_depreciation_non_cash_offset: categorySummaries.reduce(
        (s, c) => s + (c.depreciation_non_cash_offset ?? 0),
        0,
      ),
      total_available: categorySummaries.reduce((s, c) => s + c.available, 0),
    };
  });
}

export async function computeBudgetSummaryForDate(db: ReturnType<typeof createDb>, date: string, currency: string,
  overrides: BudgetSummaryOverrides = {}) {
  return (await computeBudgetSummaries(db,currency,await loadMoneyScaleOptions(db),
    [{yearMonth:date.slice(0,7),effectiveEnd:date}],overrides))[0]!;
}

router.get("/summary", async (c) => {
  const ym = c.req.query("year_month");
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
    return c.json({ error: "year_month must be YYYY-MM" }, 400);
  }
  const currency = normalizeCurrency(c.req.query("currency"));

  const db = createDb(c.env);
  const scaleOptions = await loadMoneyScaleOptions(db);

  const monthStart = `${ym}-01`;
  const monthEnd = monthEndDate(ym);

  // Optional as_of date: clamp to [monthStart, monthEnd]
  const asOfRaw = c.req.query("as_of");
  const effectiveEnd =
    asOfRaw &&
    /^\d{4}-\d{2}-\d{2}$/.test(asOfRaw) &&
    asOfRaw >= monthStart &&
    asOfRaw <= monthEnd
      ? asOfRaw
      : monthEnd;

  const computedSummaries = await computeBudgetSummaries(
    db,
    currency,
    scaleOptions,
    [{ yearMonth: ym, effectiveEnd }],
  );

  return c.json(computedSummaries[0]);
});

// GET /api/budget/history?from=YYYY-MM&to=YYYY-MM[&currency=JPY]
router.get("/history", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (
    !from ||
    !to ||
    !/^\d{4}-\d{2}$/.test(from) ||
    !/^\d{4}-\d{2}$/.test(to)
  ) {
    return c.json({ error: "from and to must be YYYY-MM" }, 400);
  }
  if (yearMonthIndex(from) > yearMonthIndex(to)) {
    return c.json({ error: "from must be before or equal to to" }, 400);
  }

  const currency = normalizeCurrency(c.req.query("currency"));
  const db = createDb(c.env);
  const scaleOptions = await loadMoneyScaleOptions(db);
  const summaries = await computeBudgetSummaries(
    db,
    currency,
    scaleOptions,
    listYearMonths(from, to).map((yearMonth) => ({ yearMonth })),
  );

  const response: BudgetHistoryResponse = {
    from,
    to,
    currency,
    summaries,
  };
  return c.json(response);
});

// Helper: build BudgetFilter response object from DB rows
async function fetchFilterWithSteps(
  db: ReturnType<typeof createDb>,
  filterId: number,
  scaleOptions?: MoneyScaleOptions,
): Promise<BudgetFilter | null> {
  const effectiveScaleOptions = scaleOptions ?? (await loadMoneyScaleOptions(db));
  const [filter] = await db
    .select()
    .from(budgetFilters)
    .where(eq(budgetFilters.id, filterId));
  if (!filter) return null;

  const steps = await db
    .select()
    .from(budgetFilterSteps)
    .where(eq(budgetFilterSteps.filter_id, filterId))
    .orderBy(budgetFilterSteps.step_order);

  const allAllocs =
    steps.length > 0
      ? await db
          .select()
          .from(budgetFilterStepAllocations)
          .where(
            inArray(
              budgetFilterStepAllocations.step_id,
              steps.map((s) => s.id),
            ),
          )
      : [];

  return {
    id: filter.id,
    name: filter.name,
    is_active: filter.is_active === 1,
    currency: filter.currency,
    created_at: filter.created_at,
    steps: steps.map((s) => ({
      id: s.id,
      filter_id: s.filter_id,
      step_order: s.step_order,
      step_type: s.step_type as "fixed" | "capped" | "remainder",
      allocations: allAllocs
        .filter((a) => a.step_id === s.id)
        .map((a) => ({
          id: a.id,
          step_id: a.step_id,
          budget_category_id: a.budget_category_id,
          amount:
            a.amount == null
              ? null
              : fromStorageMoneyAmount(
                  a.amount,
                  filter.currency,
                  effectiveScaleOptions,
                ),
          ratio: a.ratio,
        })),
    })),
  };
}

// GET /api/budget/filters — list all filters with steps
router.get("/filters", async (c) => {
  const db = createDb(c.env);
  const scaleOptions = await loadMoneyScaleOptions(db);

  const filters = await db
    .select()
    .from(budgetFilters)
    .orderBy(budgetFilters.created_at);

  const steps = await db.select().from(budgetFilterSteps);
  const allAllocs = await db.select().from(budgetFilterStepAllocations);

  const result: BudgetFilter[] = filters.map((f) => {
    const fSteps = steps
      .filter((s) => s.filter_id === f.id)
      .sort((a, b) => a.step_order - b.step_order);
    return {
      id: f.id,
      name: f.name,
      is_active: f.is_active === 1,
      currency: f.currency,
      created_at: f.created_at,
      steps: fSteps.map((s) => ({
        id: s.id,
        filter_id: s.filter_id,
        step_order: s.step_order,
        step_type: s.step_type as "fixed" | "capped" | "remainder",
        allocations: allAllocs
          .filter((a) => a.step_id === s.id)
          .map((a) => ({
            id: a.id,
            step_id: a.step_id,
            budget_category_id: a.budget_category_id,
            amount:
              a.amount == null
                ? null
                : fromStorageMoneyAmount(a.amount, f.currency, scaleOptions),
            ratio: a.ratio,
          })),
      })),
    };
  });

  return c.json(result);
});

// POST /api/budget/filters — create filter with nested steps
router.post("/filters", async (c) => {
  const body = await c.req.json<{
    name: string;
    currency?: string;
    steps: {
      step_order: number;
      step_type: string;
      allocations: {
        budget_category_id: number;
        amount?: number;
        ratio?: number;
      }[];
    }[];
  }>();

  if (!body.name) return c.json({ error: "name is required" }, 400);

  const db = createDb(c.env);
  const scaleOptions = await loadMoneyScaleOptions(db);
  const currency = normalizeCurrency(body.currency);
  const invalidMoneyField = findInvalidMoneyField(
    (body.steps ?? []).flatMap((step, stepIndex) =>
      (step.allocations ?? []).map((allocation, allocationIndex) => ({
        path: `steps[${stepIndex}].allocations[${allocationIndex}].amount`,
        value: allocation.amount,
        currency,
        decimalPlaces: decimalPlacesForCurrency(scaleOptions, currency),
        nullable: true,
      })),
    ),
  );
  if (invalidMoneyField) {
    return c.json(
      invalidMoneyResponse(invalidMoneyField, body.currency),
      400,
    );
  }

  const [filter] = await db
    .insert(budgetFilters)
    .values({
      name: body.name,
      currency,
    })
    .returning();

  if (!filter) return c.json({ error: "insert failed" }, 500);

  for (const step of body.steps ?? []) {
    const [dbStep] = await db
      .insert(budgetFilterSteps)
      .values({
        filter_id: filter.id,
        step_order: step.step_order,
        step_type: step.step_type as "fixed" | "capped" | "remainder",
      })
      .returning();

    if (dbStep && step.allocations?.length > 0) {
      await db.insert(budgetFilterStepAllocations).values(
        step.allocations.map((a) => ({
          step_id: dbStep.id,
          budget_category_id: a.budget_category_id,
          amount:
            a.amount == null
              ? null
              : toStorageMoneyAmount(a.amount, filter.currency, scaleOptions),
          ratio: a.ratio ?? null,
        })),
      );
    }
  }

  const result = await fetchFilterWithSteps(db, filter.id, scaleOptions);
  return c.json(result, 201);
});

// PATCH /api/budget/filters/:id — update name/is_active and optionally replace steps
router.patch("/filters/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{
    name?: string;
    currency?: string;
    is_active?: boolean;
    steps?: {
      step_order: number;
      step_type: string;
      allocations: {
        budget_category_id: number;
        amount?: number;
        ratio?: number;
      }[];
    }[];
  }>();

  const db = createDb(c.env);
  const scaleOptions = await loadMoneyScaleOptions(db);

  const [existing] = await db
    .select()
    .from(budgetFilters)
    .where(eq(budgetFilters.id, id));
  if (!existing) return c.json({ error: "not found" }, 404);

  const filterCurrency = normalizeCurrency(body.currency ?? existing.currency);
  const invalidMoneyField = findInvalidMoneyField(
    (body.steps ?? []).flatMap((step, stepIndex) =>
      (step.allocations ?? []).map((allocation, allocationIndex) => ({
        path: `steps[${stepIndex}].allocations[${allocationIndex}].amount`,
        value: allocation.amount,
        currency: filterCurrency,
        decimalPlaces: decimalPlacesForCurrency(scaleOptions, filterCurrency),
        nullable: true,
      })),
    ),
  );
  if (invalidMoneyField) {
    return c.json(invalidMoneyResponse(invalidMoneyField, filterCurrency), 400);
  }

  const updates: Record<string, unknown> = {};
  if (body.is_active !== undefined) updates.is_active = body.is_active ? 1 : 0;
  if (body.name !== undefined) updates.name = body.name;
  if (body.currency !== undefined)
    updates.currency = filterCurrency;

  if (Object.keys(updates).length > 0) {
    await db.update(budgetFilters).set(updates).where(eq(budgetFilters.id, id));
  }

  if (filterCurrency !== existing.currency && body.steps === undefined) {
    const existingSteps = await db
      .select({ id: budgetFilterSteps.id })
      .from(budgetFilterSteps)
      .where(eq(budgetFilterSteps.filter_id, id));
    if (existingSteps.length > 0) {
      const existingAllocs = await db
        .select()
        .from(budgetFilterStepAllocations)
        .where(
          inArray(
            budgetFilterStepAllocations.step_id,
            existingSteps.map((step) => step.id),
          ),
        );
      await Promise.all(
        existingAllocs.map((allocation) =>
          db
            .update(budgetFilterStepAllocations)
            .set({
              amount: rescaleStorageMoneyAmount(
                allocation.amount,
                existing.currency,
                filterCurrency,
                scaleOptions,
              ),
            })
            .where(eq(budgetFilterStepAllocations.id, allocation.id)),
        ),
      );
    }
  }

  // Replace steps if provided
  if (body.steps !== undefined) {
    const existingSteps = await db
      .select()
      .from(budgetFilterSteps)
      .where(eq(budgetFilterSteps.filter_id, id));
    if (existingSteps.length > 0) {
      await db.delete(budgetFilterStepAllocations).where(
        inArray(
          budgetFilterStepAllocations.step_id,
          existingSteps.map((s) => s.id),
        ),
      );
      await db
        .delete(budgetFilterSteps)
        .where(eq(budgetFilterSteps.filter_id, id));
    }
    for (const step of body.steps) {
      const [dbStep] = await db
        .insert(budgetFilterSteps)
        .values({
          filter_id: id,
          step_order: step.step_order,
          step_type: step.step_type as "fixed" | "capped" | "remainder",
        })
        .returning();
      if (dbStep && step.allocations?.length > 0) {
        await db.insert(budgetFilterStepAllocations).values(
          step.allocations.map((a) => ({
            step_id: dbStep.id,
            budget_category_id: a.budget_category_id,
            amount:
              a.amount == null
                ? null
                : toStorageMoneyAmount(a.amount, filterCurrency, scaleOptions),
            ratio: a.ratio ?? null,
          })),
        );
      }
    }
  }

  const result = await fetchFilterWithSteps(db, id, scaleOptions);
  return c.json(result);
});

// DELETE /api/budget/filters/:id — delete only if not used
router.delete("/filters/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const db = createDb(c.env);

  const [existing] = await db
    .select()
    .from(budgetFilters)
    .where(eq(budgetFilters.id, id));
  if (!existing) return c.json({ error: "not found" }, 404);

  await db.delete(budgetFilters).where(eq(budgetFilters.id, id));
  return c.json({ success: true });
});

// POST /api/budget/filters/:id/copy — duplicate filter; new filter is unused
router.post("/filters/:id/copy", async (c) => {
  const id = Number(c.req.param("id"));
  const db = createDb(c.env);
  const scaleOptions = await loadMoneyScaleOptions(db);

  const source = await fetchFilterWithSteps(db, id, scaleOptions);
  if (!source) return c.json({ error: "not found" }, 404);

  const [newFilter] = await db
    .insert(budgetFilters)
    .values({
      name: `${source.name} (コピー)`,
      is_active: 1,
      currency: source.currency,
    })
    .returning();

  if (!newFilter) return c.json({ error: "insert failed" }, 500);

  for (const step of source.steps) {
    const [dbStep] = await db
      .insert(budgetFilterSteps)
      .values({
        filter_id: newFilter.id,
        step_order: step.step_order,
        step_type: step.step_type,
      })
      .returning();

    if (dbStep && step.allocations.length > 0) {
      await db.insert(budgetFilterStepAllocations).values(
        step.allocations.map((a) => ({
          step_id: dbStep.id,
          budget_category_id: a.budget_category_id,
          amount:
            a.amount == null
              ? null
              : toStorageMoneyAmount(a.amount, source.currency, scaleOptions),
          ratio: a.ratio,
        })),
      );
    }
  }

  const result = await fetchFilterWithSteps(db, newFilter.id, scaleOptions);
  return c.json(result, 201);
});

export { router as budgetRouter };
