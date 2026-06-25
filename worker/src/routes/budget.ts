import { eq, and, sql, inArray, ne } from "drizzle-orm";
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
  budgetSettings,
  accounts,
} from "../db/schema";
import { loadCurrencyDecimalPlaces } from "../lib/currencyPrecision";
import type {
  BudgetCategory,
  BudgetCategorySummary,
  BudgetSummary,
  BudgetFilter,
} from "@balance-sheet/shared";
import {
  applyBudgetBalanceCaps,
  calculateSpentFromBudgetAllocations,
  calculateNextCarryover,
  findLatestResetDateForPeriod,
  findLatestResetPointForPeriod,
  groupBudgetEntryAllocationsByMonth,
  isAfterBudgetResetPoint,
  shouldShowCarryoverForPeriod,
  sumBudgetAdjustmentLogsAfterResetsByPeriod,
} from "../lib/budgetSummary";
import { filterBudgetCategoriesForVisibility } from "../lib/budgetCategoryArchive";
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

function normalizeCurrency(currency: string | null | undefined): string {
  return (currency || "JPY").toUpperCase();
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
    return c.json(invalidMoneyResponse(invalidMoneyField, body.currency), 400);
  }

  const db = createDb(c.env);

  // Reject if renaming to a name that conflicts with an account
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
    await db
      .update(budgetCategories)
      .set(updates)
      .where(eq(budgetCategories.id, id));
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
  await db.delete(budgetCategories).where(eq(budgetCategories.id, id));
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
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO budget_adjustment_logs
        (budget_category_id, year_month, amount, currency, date, adjustment_type, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
    ).bind(
      body.budget_category_id,
      body.year_month,
      toStorageMoneyAmount(body.adhoc_delta, currency, scaleOptions),
      currency,
      logDate,
      adjustmentType,
      normalizeNote(body.note),
    ),
  ];

  if (body.archive_category) {
    statements.push(
      c.env.DB.prepare(
        "UPDATE budget_categories SET is_archived = 1 WHERE id = ?",
      ).bind(body.budget_category_id),
    );
  }

  const results = await c.env.DB.batch(statements);
  const logEntry = (
    results[0] as D1QueryResult<typeof budgetAdjustmentLogs.$inferSelect>
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
        is_business_owner: newIsBusinessOwner,
        business_advance_account_id: newAdvanceAccountId,
        business_loss_account_id: newLossAccountId,
        business_advance_budget_category_id: newAdvanceBudgetCategoryId,
      },
    });

  return c.json({
    preferred_payment_account_ids: newIds,
    preferred_filter_ids: newFilterIds,
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

  // Journal-entry-backed expense allocations (simple / multiline)
  const journalAllocRows = await db
    .select({
      id: journalEntryBudgetAllocations.id,
      journal_entry_id: journalEntryBudgetAllocations.journal_entry_id,
      budget_category_id: journalEntryBudgetAllocations.budget_category_id,
      amount: journalEntryBudgetAllocations.amount,
      currency: journalEntryBudgetAllocations.currency,
      source: journalEntryBudgetAllocations.source,
      date: journalEntries.date,
      created_at: journalEntryBudgetAllocations.created_at,
    })
    .from(journalEntryBudgetAllocations)
    .innerJoin(
      journalEntries,
      eq(journalEntryBudgetAllocations.journal_entry_id, journalEntries.id),
    );

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
      | "multiline";
    adjustment_type?: "allocation" | "reset" | "transfer";
    journal_entry_id?: number;
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
        row.adjustment_type === "reset"
          ? "reset"
          : row.adjustment_type === "transfer"
            ? "transfer"
            : "allocation",
      journal_entry_id: row.journal_entry_id ?? undefined,
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
    })),
  ];

  const filtered = combined.filter((row) => {
    if (normalizeCurrency(row.currency) !== currency) return false;
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
  const scaleOptions = await loadMoneyScaleOptions(db);

  const [existing] = await db
    .select()
    .from(budgetAdjustmentLogs)
    .where(eq(budgetAdjustmentLogs.id, id));

  if (!existing) return c.json({ error: "not found" }, 404);

  await db.delete(budgetAdjustmentLogs).where(eq(budgetAdjustmentLogs.id, id));

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

  const [existing] = await db
    .select()
    .from(budgetAdjustmentLogs)
    .where(eq(budgetAdjustmentLogs.id, id));

  if (!existing) return c.json({ error: "not found" }, 404);

  const invalidMoneyField = findInvalidMoneyField([
    {
      path: "amount",
      value: body.amount,
      currency: existing.currency,
      decimalPlaces: decimalPlacesForCurrency(scaleOptions, existing.currency),
    },
  ]);
  if (invalidMoneyField) {
    return c.json(invalidMoneyResponse(invalidMoneyField, existing.currency), 400);
  }

  const updates: Record<string, unknown> = {};
  if (body.amount !== undefined) {
    updates.amount = toStorageMoneyAmount(
      body.amount,
      existing.currency,
      scaleOptions,
    );
  }
  if (body.date !== undefined) updates.date = body.date;
  if ("note" in body) updates.note = normalizeNote(body.note);

  if (Object.keys(updates).length > 0) {
    await db
      .update(budgetAdjustmentLogs)
      .set(updates)
      .where(eq(budgetAdjustmentLogs.id, id));
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
    journal_entry_id: number;
    budget_category_id: number;
    amount: number;
    date: string;
    created_at: string;
  }[]
> {
  const rows = await db
    .select({
      journal_entry_id: journalEntryBudgetAllocations.journal_entry_id,
      budget_category_id: journalEntryBudgetAllocations.budget_category_id,
      amount: journalEntryBudgetAllocations.amount,
      date: journalEntries.date,
      created_at: journalEntries.created_at,
    })
    .from(journalEntryBudgetAllocations)
    .innerJoin(
      journalEntries,
      eq(journalEntryBudgetAllocations.journal_entry_id, journalEntries.id),
    )
    .where(
      and(
        sql`${journalEntries.date} >= ${dateStart}`,
        sql`${journalEntries.date} <= ${dateEnd}`,
        eq(journalEntryBudgetAllocations.currency, currency),
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
router.get("/summary", async (c) => {
  const ym = c.req.query("year_month");
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
    return c.json({ error: "year_month must be YYYY-MM" }, 400);
  }
  const currency = normalizeCurrency(c.req.query("currency"));

  const db = createDb(c.env);
  const scaleOptions = await loadMoneyScaleOptions(db);

  const [year, month] = ym.split("-").map(Number) as [number, number];
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

  // 1. Fetch categories + links first to determine per-category rollover depths
  const allCats = await db
    .select()
    .from(budgetCategories)
    .orderBy(budgetCategories.sort_order, budgetCategories.name);
  const cats = filterBudgetCategoriesForVisibility(allCats);

  const links = await db.select().from(budgetCategoryAccounts);
  const targetMap = buildTargetAccountMap(
    await fetchBudgetCategoryTargetRows(db),
  );

  const [oldestBudgetLog, oldestEntryAlloc] =
    await Promise.all([
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
    ]);

  const oldestYm = [
    oldestBudgetLog[0]?.min_ym,
    oldestEntryAlloc[0]?.min_ym,
  ]
    .filter((value): value is string => Boolean(value))
    .sort()[0];
  const maxRolloverMonths =
    oldestYm && oldestYm < ym
      ? (() => {
          const [oy, om] = oldestYm.split("-").map(Number) as [number, number];
          return (year - oy) * 12 + (month - om);
        })()
      : 0;

  // Build list of all year-months: index 0 = oldest (maxRolloverMonths ago), last = current
  const monthsList: string[] = [];
  for (let i = maxRolloverMonths; i >= 0; i--) {
    monthsList.push(subtractMonths(year, month, i));
  }
  // monthsList[maxRolloverMonths] === ym

  // Compute date ranges per month
  const monthDateRanges = monthsList.map((mym, idx) => {
    const start = `${mym}-01`;
    const end = monthEndDate(mym);
    // For current month, use effectiveEnd
    return { start, end: idx === maxRolloverMonths ? effectiveEnd : end };
  });
  const monthDateRangeMap = new Map(
    monthsList.map((mym, idx) => [mym, monthDateRanges[idx]!]),
  );

  // 2. Batch fetch budget adjustment logs for all months (includes income-linked and manual)
  // Note: adhoc is the single source of truth for budget "income"
  const adhocLogRows =
    monthsList.length > 0
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
              inArray(budgetAdjustmentLogs.year_month, monthsList),
              eq(budgetAdjustmentLogs.currency, currency),
            ),
          )
      : [];
  const decodedAdhocLogRows = adhocLogRows.map((row) => ({
    ...row,
    amount: fromStorageMoneyAmount(row.amount, currency, scaleOptions),
  }));

  // Build map: `${catId}:${yearMonth}` → totalAmount
  const adhocSumMap = sumBudgetAdjustmentLogsAfterResetsByPeriod(
    decodedAdhocLogRows,
    monthDateRangeMap,
  );

  function adhocFor(catId: number, yearMonthKey: string): number {
    return adhocSumMap.get(`${catId}:${yearMonthKey}`) ?? 0;
  }

  function resetPointFor(catId: number, yearMonthKey: string) {
    const range = monthDateRangeMap.get(yearMonthKey);
    if (!range) return null;
    return findLatestResetPointForPeriod(decodedAdhocLogRows, catId, range);
  }

  // 4. Compute monthly income (current month only)
  const incomeAccountRows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.type, "income"));

  const incomeAccountIds = incomeAccountRows.map((r) => r.id);

  let monthlyIncome = 0;
  if (incomeAccountIds.length > 0) {
    const incomeRows = await db
      .select({
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
          sql`${journalEntries.date} >= ${monthStart}`,
          sql`${journalEntries.date} <= ${effectiveEnd}`,
          eq(journalLines.currency, currency),
        ),
      );
    monthlyIncome = fromStorageMoneyAmount(
      incomeRows[0]?.total ?? 0,
      currency,
      scaleOptions,
    );
  }

  // 5. Fetch explicit entry budget allocations for the complete range once,
  // then partition them by month in memory. This avoids one D1 query per
  // historical month.
  const entryAllocsForRange =
    monthDateRanges.length > 0
      ? await fetchEntryAllocsForPeriod(
          db,
          monthDateRanges[0]!.start,
          monthDateRanges.at(-1)!.end,
          currency,
          scaleOptions,
        )
      : [];
  const entryAllocsByMonth = groupBudgetEntryAllocationsByMonth(
    entryAllocsForRange,
    monthDateRangeMap,
  );
  const monthEntryAllocsAll = monthsList.map(
    (yearMonth) => entryAllocsByMonth.get(yearMonth) ?? [],
  );

  // 6. Per category: N-level carryover
  const categorySummaries: BudgetCategorySummary[] = [];

  for (const cat of cats) {
    const accountIds = links
      .filter((l) => l.budget_category_id === cat.id)
      .map((l) => l.account_id);

    // Current month (index maxRolloverMonths)
    const currentResetPoint = resetPointFor(cat.id, ym);
    const budgetBase = adhocFor(cat.id, ym);

    const spent = calculateSpentFromBudgetAllocations(
      cat.id,
      monthEntryAllocsAll[maxRolloverMonths].filter((entryAlloc) =>
        isAfterBudgetResetPoint(entryAlloc, currentResetPoint),
      ),
    );

    let carryover = 0;
    for (let i = 0; i < maxRolloverMonths; i++) {
      const mym = monthsList[i];
      const resetPoint = resetPointFor(cat.id, mym);
      const base = adhocFor(cat.id, mym);
      const mSpent = calculateSpentFromBudgetAllocations(
        cat.id,
        monthEntryAllocsAll[i].filter((entryAlloc) =>
          isAfterBudgetResetPoint(entryAlloc, resetPoint),
        ),
      );
      carryover = calculateNextCarryover({
        budgetBase: base,
        carryover: resetPoint ? 0 : carryover,
        spent: mSpent,
        isInPositiveRolloverWindow: true,
      });
    }

    const visibleCarryover = currentResetPoint ? 0 : carryover;
    const totalBudget = budgetBase + visibleCarryover;

    // Count distinct months with non-zero contributions (for goal prediction)
    let monthsWithContributions = 0;
    for (let i = 0; i < maxRolloverMonths; i++) {
      const mym = monthsList[i];
      if (adhocFor(cat.id, mym) !== 0) monthsWithContributions++;
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
        monthDateRanges[maxRolloverMonths]!,
      ),
      reset_date: findLatestResetDateForPeriod(
        decodedAdhocLogRows,
        cat.id,
        monthDateRanges[maxRolloverMonths]!,
      ),
      total_budget: totalBudget,
      spent,
      available: totalBudget - spent,
      months_with_contributions: monthsWithContributions,
    });
  }

  applyBudgetBalanceCaps(categorySummaries);

  const summary: BudgetSummary = {
    year_month: ym,
    currency,
    monthly_income: monthlyIncome,
    categories: categorySummaries,
    total_budget: categorySummaries.reduce((s, c) => s + c.total_budget, 0),
    total_spent: categorySummaries.reduce((s, c) => s + c.spent, 0),
    total_available: categorySummaries.reduce((s, c) => s + c.available, 0),
  };

  return c.json(summary);
});

// ── Helper: build BudgetFilter response object from DB rows ──────────────────
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
