import { and, asc, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { Hono } from "hono";
import {
  hasDuplicatePlannedExpenseCategoryName,
  hasDuplicatePlannedExpenseItemName,
  type CreatePlannedExpenseInput,
  type CreatePlannedExpenseCategoryInput,
  type PlannedExpense,
  type PlannedExpenseCategory,
  type PlannedExpenseKind,
  type PlannedExpenseMonthlyMode,
  type PlannedExpenseRecurrenceType,
  type PlannedExpenseRecurrenceUnit,
  type PlannedExpenseStatus,
  type PlannedExpenseWeekFallback,
  type ProductAvailabilityStatus,
  type ProductMetadata,
  type ProductMetadataLookupInput,
  type ProductSourceSite,
  normalizePlannedExpenseWeekFallback,
  resolveMonthlyPayday,
  resolvePlannedExpenseWeekdayRuleDate,
  type ShoppingPlanType,
  type UpdatePlannedExpenseInput,
  type UpdatePlannedExpenseCategoryInput,
} from "@balance-sheet/shared";
import { createDb, type Env } from "../db";
import {
  accounts,
  budgetCategories,
  plannedExpenseCategories,
  plannedExpenses,
  productMetadataCache,
} from "../db/schema";
import { lookupProductMetadata } from "../lib/productMetadata";
import { loadCurrencyDecimalPlaces } from "../lib/currencyPrecision";
import {
  isWishlistClosedStatus,
  selectWishlistClosedItemIdsToDelete,
  WISHLIST_CLOSED_RETENTION_LIMIT,
} from "../lib/plannedExpenseRetention";
import {
  findInvalidMoneyField,
  fromStorageMoneyAmount,
  invalidMoneyResponse,
  rescaleStorageMoneyAmount,
  toStorageMoneyAmount,
  type MoneyScaleOptions,
} from "../lib/moneyValidation";

const router = new Hono<{ Bindings: Env }>();
const expenseAccounts = alias(accounts, "planned_expense_accounts");
const categoryExpenseAccounts = alias(
  accounts,
  "planned_expense_category_accounts",
);

const plannedExpenseKinds = new Set<PlannedExpenseKind>([
  "shopping_list",
  "wishlist",
  "scheduled_payment",
]);
const plannedExpenseStatuses = new Set<PlannedExpenseStatus>([
  "open",
  "completed",
  "cancelled",
]);
const recurrenceTypes = new Set<PlannedExpenseRecurrenceType>([
  "one_time",
  "recurring",
]);
const recurrenceUnits = new Set<PlannedExpenseRecurrenceUnit>([
  "week",
  "month",
  "year",
]);
const recurrenceMonthlyModes = new Set<PlannedExpenseMonthlyMode>([
  "day_of_month",
  "week_of_month",
]);
const recurrenceWeekFallbacks = new Set<PlannedExpenseWeekFallback>([
  "skip",
  "last_day_of_month",
  "previous_week",
  "next_month_first_week",
]);
const shoppingPlanTypes = new Set<ShoppingPlanType>(["one_time", "routine"]);

function normalizeCurrency(currency: string | null | undefined): string {
  return (currency || "JPY").toUpperCase();
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTargetDate(value: string | null | undefined): string | null {
  const normalized = normalizeNullableText(value);
  if (normalized === null) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "__invalid__";
}

function normalizeOptionalDate(
  value: string | null | undefined,
): string | null | "__invalid__" {
  const normalized = normalizeNullableText(value);
  if (normalized === null) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "__invalid__";
}

function normalizeSortOrder(value: number | undefined): number {
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
}

function normalizeWeeksOfMonth(value: string | null | undefined): string | null {
  const weeks = Array.from(
    new Set(
      (value ?? "")
        .split(",")
        .map((entry) => Number(entry.trim()))
        .filter((entry) => Number.isInteger(entry) && entry >= 1 && entry <= 5),
    ),
  ).sort((a, b) => a - b);
  return weeks.length > 0 ? weeks.join(",") : null;
}

function normalizeDateList(
  value: string | null | undefined,
): string | null | "__invalid__" {
  if (value == null) return null;
  const normalized = normalizeNullableText(value);
  if (normalized === null) return null;
  const dates = Array.from(
    new Set(normalized.split(",").map((entry) => entry.trim())),
  ).filter(Boolean);
  if (dates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
    return "__invalid__";
  }
  return dates.sort().join(",") || null;
}

function normalizeSkippedDates(value: string | null | undefined) {
  return normalizeDateList(value);
}

function normalizeCompletedDates(value: string | null | undefined) {
  return normalizeDateList(value);
}

function resolveMonthlyRecurrenceDate(
  date: string | null,
  day: number | null,
): string | null {
  if (date == null || day == null) return date;
  const month = date.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return date;
  const resolvedDay = resolveMonthlyPayday(month, day);
  return `${month}-${String(resolvedDay).padStart(2, "0")}`;
}

function normalizeShoppingPlanType(
  value: ShoppingPlanType | null | undefined,
): ShoppingPlanType {
  return value && shoppingPlanTypes.has(value) ? value : "one_time";
}

async function validateExpenseAccount(
  db: ReturnType<typeof createDb>,
  accountId: number | null | undefined,
) {
  if (accountId == null) return true;
  if (!Number.isInteger(accountId)) return false;
  const [account] = await db
    .select({ id: accounts.id, type: accounts.type })
    .from(accounts)
    .where(eq(accounts.id, accountId));
  return account?.type === "expense";
}

async function validateCategory(
  db: ReturnType<typeof createDb>,
  categoryId: number | null | undefined,
  kind: PlannedExpenseKind,
) {
  if (categoryId == null) return true;
  if (!Number.isInteger(categoryId)) return false;
  const [category] = await db
    .select({ id: plannedExpenseCategories.id, kind: plannedExpenseCategories.kind })
    .from(plannedExpenseCategories)
    .where(eq(plannedExpenseCategories.id, categoryId));
  return category?.kind === kind;
}

async function hasDuplicatePlannedExpenseItem(
  db: ReturnType<typeof createDb>,
  input: {
    kind: PlannedExpenseKind;
    categoryId: number | null | undefined;
    name: string;
    excludeId?: number;
  },
) {
  const rows = await db
    .select({
      id: plannedExpenses.id,
      kind: plannedExpenses.kind,
      category_id: plannedExpenses.category_id,
      name: plannedExpenses.name,
    })
    .from(plannedExpenses)
    .where(
      and(
        eq(plannedExpenses.kind, input.kind),
        input.categoryId == null
          ? isNull(plannedExpenses.category_id)
          : eq(plannedExpenses.category_id, input.categoryId),
      ),
    );
  return hasDuplicatePlannedExpenseItemName({
    name: input.name,
    kind: input.kind,
    categoryId: input.categoryId ?? null,
    excludeId: input.excludeId,
    items: rows.map((row) => ({
      ...row,
      kind: row.kind as PlannedExpenseKind,
    })),
  });
}

async function fetchLatestClosedWishlistItemIds(
  db: ReturnType<typeof createDb>,
  limit = WISHLIST_CLOSED_RETENTION_LIMIT,
) {
  const rows = await db
    .select({ id: plannedExpenses.id })
    .from(plannedExpenses)
    .where(
      and(
        eq(plannedExpenses.kind, "wishlist"),
        or(
          eq(plannedExpenses.status, "completed"),
          eq(plannedExpenses.status, "cancelled"),
        ),
      ),
    )
    .orderBy(desc(plannedExpenses.updated_at), desc(plannedExpenses.id))
    .limit(limit);
  return rows.map((row) => row.id);
}

async function pruneWishlistClosedItems(db: ReturnType<typeof createDb>) {
  const rows = await db
    .select({
      id: plannedExpenses.id,
      status: plannedExpenses.status,
      updated_at: plannedExpenses.updated_at,
    })
    .from(plannedExpenses)
    .where(
      and(
        eq(plannedExpenses.kind, "wishlist"),
        or(
          eq(plannedExpenses.status, "completed"),
          eq(plannedExpenses.status, "cancelled"),
        ),
      ),
    );
  const idsToDelete = selectWishlistClosedItemIdsToDelete(rows);
  if (idsToDelete.length === 0) return;
  await db
    .delete(plannedExpenses)
    .where(inArray(plannedExpenses.id, idsToDelete));
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

function categoryToResponse(
  row: typeof plannedExpenseCategories.$inferSelect,
  scaleOptions: MoneyScaleOptions,
): PlannedExpenseCategory {
  const isShoppingList = row.kind === "shopping_list";
  return {
    id: row.id,
    kind: row.kind as PlannedExpenseKind,
    name: row.name,
    estimated_amount: fromStorageMoneyAmount(
      row.estimated_amount,
      row.currency,
      scaleOptions,
    ),
    currency: row.currency,
    default_expense_account_id: isShoppingList
      ? (row.default_expense_account_id ?? null)
      : null,
    target_date: isShoppingList ? (row.target_date ?? null) : null,
    shopping_plan_type: isShoppingList
      ? normalizeShoppingPlanType(row.shopping_plan_type as ShoppingPlanType)
      : "one_time",
    archived_at: isShoppingList ? (row.archived_at ?? null) : null,
    last_checked_out_date: isShoppingList
      ? (row.last_checked_out_date ?? null)
      : null,
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toResponse(
  row: typeof plannedExpenses.$inferSelect & {
    category_name?: string | null;
    category_estimated_amount?: number | null;
    category_currency?: string | null;
    category_default_expense_account_id?: number | null;
    category_default_expense_account_name?: string | null;
    category_target_date?: string | null;
    category_shopping_plan_type?: string | null;
    category_archived_at?: string | null;
    budget_category_name?: string | null;
    expense_account_name?: string | null;
    metadata_id?: number | null;
    metadata_normalized_url?: string | null;
    metadata_source_site?: string | null;
    metadata_source_product_id?: string | null;
    metadata_name?: string | null;
    metadata_price_amount?: number | null;
    metadata_currency?: string | null;
    metadata_availability_status?: string | null;
    metadata_availability_label?: string | null;
    metadata_og_title?: string | null;
    metadata_og_description?: string | null;
    metadata_og_image_url?: string | null;
    metadata_og_site_name?: string | null;
    metadata_fetched_at?: string | null;
    metadata_expires_at?: string | null;
    metadata_error_code?: string | null;
    metadata_error_message?: string | null;
  },
  scaleOptions: MoneyScaleOptions,
): PlannedExpense {
  const productMetadata: ProductMetadata | null =
    row.metadata_id == null ||
    row.metadata_normalized_url == null ||
    row.metadata_source_site == null ||
    row.metadata_currency == null ||
    row.metadata_availability_status == null ||
    row.metadata_fetched_at == null ||
    row.metadata_expires_at == null
      ? null
      : {
          id: row.metadata_id,
          normalized_url: row.metadata_normalized_url,
          source_site: row.metadata_source_site as ProductSourceSite,
          source_product_id: row.metadata_source_product_id ?? null,
          name: row.metadata_name ?? null,
          price_amount:
            row.metadata_price_amount == null
              ? null
              : fromStorageMoneyAmount(
                  row.metadata_price_amount,
                  row.metadata_currency,
                  scaleOptions,
                ),
          currency: row.metadata_currency,
          availability_status:
            row.metadata_availability_status as ProductAvailabilityStatus,
          availability_label: row.metadata_availability_label ?? null,
          og_title: row.metadata_og_title ?? null,
          og_description: row.metadata_og_description ?? null,
          og_image_url: row.metadata_og_image_url ?? null,
          og_site_name: row.metadata_og_site_name ?? null,
          fetched_at: row.metadata_fetched_at,
          expires_at: row.metadata_expires_at,
          error_code: row.metadata_error_code ?? null,
          error_message: row.metadata_error_message ?? null,
        };

  const isShoppingList = row.kind === "shopping_list";
  return {
    id: row.id,
    kind: row.kind as PlannedExpenseKind,
    category_id: row.category_id ?? null,
    category_name: row.category_name ?? null,
    category_estimated_amount:
      row.category_estimated_amount == null
        ? null
        : fromStorageMoneyAmount(
            row.category_estimated_amount,
            row.category_currency ?? row.currency,
            scaleOptions,
          ),
    category_currency: row.category_currency ?? null,
    category_default_expense_account_id: isShoppingList
      ? (row.category_default_expense_account_id ?? null)
      : null,
    category_target_date: isShoppingList
      ? (row.category_target_date ?? null)
      : null,
    category_shopping_plan_type: isShoppingList
      ? normalizeShoppingPlanType(
          row.category_shopping_plan_type as ShoppingPlanType,
        )
      : null,
    category_archived_at: isShoppingList
      ? (row.category_archived_at ?? null)
      : null,
    name: row.name,
    estimated_amount: fromStorageMoneyAmount(
      row.estimated_amount,
      row.currency,
      scaleOptions,
    ),
    currency: row.currency,
    budget_category_id: row.budget_category_id ?? null,
    budget_category_name: row.budget_category_name ?? null,
    expense_account_id: isShoppingList
      ? (row.expense_account_id ??
        row.category_default_expense_account_id ??
        null)
      : (row.expense_account_id ?? null),
    expense_account_name: isShoppingList
      ? (row.expense_account_name ??
        row.category_default_expense_account_name ??
        null)
      : (row.expense_account_name ?? null),
    target_date: isShoppingList
      ? (row.category_target_date ?? null)
      : (row.target_date ?? null),
    recurrence_type: row.recurrence_type as PlannedExpenseRecurrenceType,
    recurrence_interval:
      row.recurrence_interval ?? row.recurrence_interval_months ?? null,
    recurrence_unit:
      (row.recurrence_unit as PlannedExpenseRecurrenceUnit | null) ??
      (row.recurrence_type === "recurring" ? "month" : null),
    recurrence_monthly_mode:
      (row.recurrence_monthly_mode as PlannedExpenseMonthlyMode | null) ??
      (row.recurrence_day == null ? null : "day_of_month"),
    recurrence_interval_months: row.recurrence_interval_months ?? null,
    recurrence_day: row.recurrence_day ?? null,
    recurrence_weeks_of_month: row.recurrence_weeks_of_month ?? null,
    recurrence_weekday: row.recurrence_weekday ?? null,
    recurrence_week_fallback:
      row.recurrence_week_fallback == null
        ? null
        : normalizePlannedExpenseWeekFallback(row.recurrence_week_fallback),
    next_due_date: row.next_due_date ?? null,
    end_date: row.end_date ?? null,
    recurrence_count: row.recurrence_count ?? null,
    skipped_dates: row.skipped_dates ?? null,
    completed_dates: row.completed_dates ?? null,
    sort_order: row.sort_order,
    status: row.status as PlannedExpenseStatus,
    keep_on_routine_clear: isShoppingList
      ? row.keep_on_routine_clear === 1
      : false,
    note: row.note ?? null,
    url: row.url ?? null,
    product_metadata_cache_id: row.product_metadata_cache_id ?? null,
    product_metadata: productMetadata,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function fetchOne(
  db: ReturnType<typeof createDb>,
  id: number,
  scaleOptions: MoneyScaleOptions,
) {
  const [row] = await db
    .select({
      id: plannedExpenses.id,
      kind: plannedExpenses.kind,
      category_id: plannedExpenses.category_id,
      category_name: plannedExpenseCategories.name,
      category_estimated_amount: plannedExpenseCategories.estimated_amount,
      category_currency: plannedExpenseCategories.currency,
      category_default_expense_account_id:
        plannedExpenseCategories.default_expense_account_id,
      category_default_expense_account_name: categoryExpenseAccounts.name,
      category_target_date: plannedExpenseCategories.target_date,
      category_shopping_plan_type: plannedExpenseCategories.shopping_plan_type,
      category_archived_at: plannedExpenseCategories.archived_at,
      name: plannedExpenses.name,
      estimated_amount: plannedExpenses.estimated_amount,
      currency: plannedExpenses.currency,
      budget_category_id: plannedExpenses.budget_category_id,
      budget_category_name: budgetCategories.name,
      expense_account_id: plannedExpenses.expense_account_id,
      expense_account_name: expenseAccounts.name,
      target_date: plannedExpenses.target_date,
      recurrence_type: plannedExpenses.recurrence_type,
      recurrence_interval: plannedExpenses.recurrence_interval,
      recurrence_unit: plannedExpenses.recurrence_unit,
      recurrence_monthly_mode: plannedExpenses.recurrence_monthly_mode,
      recurrence_interval_months: plannedExpenses.recurrence_interval_months,
      recurrence_day: plannedExpenses.recurrence_day,
      recurrence_weeks_of_month: plannedExpenses.recurrence_weeks_of_month,
      recurrence_weekday: plannedExpenses.recurrence_weekday,
      recurrence_week_fallback: plannedExpenses.recurrence_week_fallback,
      next_due_date: plannedExpenses.next_due_date,
      end_date: plannedExpenses.end_date,
      recurrence_count: plannedExpenses.recurrence_count,
      skipped_dates: plannedExpenses.skipped_dates,
      completed_dates: plannedExpenses.completed_dates,
      sort_order: plannedExpenses.sort_order,
      status: plannedExpenses.status,
      keep_on_routine_clear: plannedExpenses.keep_on_routine_clear,
      note: plannedExpenses.note,
      url: plannedExpenses.url,
      product_metadata_cache_id: plannedExpenses.product_metadata_cache_id,
      created_at: plannedExpenses.created_at,
      updated_at: plannedExpenses.updated_at,
      metadata_id: productMetadataCache.id,
      metadata_normalized_url: productMetadataCache.normalized_url,
      metadata_source_site: productMetadataCache.source_site,
      metadata_source_product_id: productMetadataCache.source_product_id,
      metadata_name: productMetadataCache.name,
      metadata_price_amount: productMetadataCache.price_amount,
      metadata_currency: productMetadataCache.currency,
      metadata_availability_status: productMetadataCache.availability_status,
      metadata_availability_label: productMetadataCache.availability_label,
      metadata_og_title: productMetadataCache.og_title,
      metadata_og_description: productMetadataCache.og_description,
      metadata_og_image_url: productMetadataCache.og_image_url,
      metadata_og_site_name: productMetadataCache.og_site_name,
      metadata_fetched_at: productMetadataCache.fetched_at,
      metadata_expires_at: productMetadataCache.expires_at,
      metadata_error_code: productMetadataCache.error_code,
      metadata_error_message: productMetadataCache.error_message,
    })
    .from(plannedExpenses)
    .leftJoin(
      plannedExpenseCategories,
      eq(plannedExpenses.category_id, plannedExpenseCategories.id),
    )
    .leftJoin(
      budgetCategories,
      eq(plannedExpenses.budget_category_id, budgetCategories.id),
    )
    .leftJoin(
      expenseAccounts,
      eq(plannedExpenses.expense_account_id, expenseAccounts.id),
    )
    .leftJoin(
      categoryExpenseAccounts,
      eq(
        plannedExpenseCategories.default_expense_account_id,
        categoryExpenseAccounts.id,
      ),
    )
    .leftJoin(
      productMetadataCache,
      eq(plannedExpenses.product_metadata_cache_id, productMetadataCache.id),
    )
    .where(eq(plannedExpenses.id, id));

  return row ? toResponse(row, scaleOptions) : null;
}

router.get("/", async (c) => {
  const kind = c.req.query("kind");
  const status = c.req.query("status");
  const includeArchived = c.req.query("include_archived") === "true";
  if (kind && !plannedExpenseKinds.has(kind as PlannedExpenseKind)) {
    return c.json({ error: "invalid kind" }, 400);
  }
  if (status && !plannedExpenseStatuses.has(status as PlannedExpenseStatus)) {
    return c.json({ error: "invalid status" }, 400);
  }

  const db = createDb(c.env);
  const scaleOptions = await loadMoneyScaleOptions(db);
  const latestClosedWishlistItemIds =
    kind === "wishlist" && (!status || isWishlistClosedStatus(status))
      ? await fetchLatestClosedWishlistItemIds(db)
      : [];
  const wishlistClosedRetentionFilter =
    kind === "wishlist" && !status
      ? latestClosedWishlistItemIds.length > 0
        ? or(
            eq(plannedExpenses.status, "open"),
            inArray(plannedExpenses.id, latestClosedWishlistItemIds),
          )
        : eq(plannedExpenses.status, "open")
      : kind === "wishlist" && status && isWishlistClosedStatus(status)
        ? latestClosedWishlistItemIds.length > 0
          ? inArray(plannedExpenses.id, latestClosedWishlistItemIds)
          : eq(plannedExpenses.id, -1)
        : null;
  const filters = [
    kind ? eq(plannedExpenses.kind, kind as PlannedExpenseKind) : null,
    status ? eq(plannedExpenses.status, status as PlannedExpenseStatus) : null,
    wishlistClosedRetentionFilter,
    kind === "shopping_list" && !includeArchived
      ? and(
          isNotNull(plannedExpenses.category_id),
          isNull(plannedExpenseCategories.archived_at),
        )
      : null,
  ].filter((filter) => filter !== null);

  const baseQuery = db
    .select({
      id: plannedExpenses.id,
      kind: plannedExpenses.kind,
      category_id: plannedExpenses.category_id,
      category_name: plannedExpenseCategories.name,
      category_estimated_amount: plannedExpenseCategories.estimated_amount,
      category_currency: plannedExpenseCategories.currency,
      category_default_expense_account_id:
        plannedExpenseCategories.default_expense_account_id,
      category_default_expense_account_name: categoryExpenseAccounts.name,
      category_target_date: plannedExpenseCategories.target_date,
      category_shopping_plan_type: plannedExpenseCategories.shopping_plan_type,
      category_archived_at: plannedExpenseCategories.archived_at,
      name: plannedExpenses.name,
      estimated_amount: plannedExpenses.estimated_amount,
      currency: plannedExpenses.currency,
      budget_category_id: plannedExpenses.budget_category_id,
      budget_category_name: budgetCategories.name,
      expense_account_id: plannedExpenses.expense_account_id,
      expense_account_name: expenseAccounts.name,
      target_date: plannedExpenses.target_date,
      recurrence_type: plannedExpenses.recurrence_type,
      recurrence_interval: plannedExpenses.recurrence_interval,
      recurrence_unit: plannedExpenses.recurrence_unit,
      recurrence_monthly_mode: plannedExpenses.recurrence_monthly_mode,
      recurrence_interval_months: plannedExpenses.recurrence_interval_months,
      recurrence_day: plannedExpenses.recurrence_day,
      recurrence_weeks_of_month: plannedExpenses.recurrence_weeks_of_month,
      recurrence_weekday: plannedExpenses.recurrence_weekday,
      recurrence_week_fallback: plannedExpenses.recurrence_week_fallback,
      next_due_date: plannedExpenses.next_due_date,
      end_date: plannedExpenses.end_date,
      recurrence_count: plannedExpenses.recurrence_count,
      skipped_dates: plannedExpenses.skipped_dates,
      completed_dates: plannedExpenses.completed_dates,
      sort_order: plannedExpenses.sort_order,
      status: plannedExpenses.status,
      keep_on_routine_clear: plannedExpenses.keep_on_routine_clear,
      note: plannedExpenses.note,
      url: plannedExpenses.url,
      product_metadata_cache_id: plannedExpenses.product_metadata_cache_id,
      created_at: plannedExpenses.created_at,
      updated_at: plannedExpenses.updated_at,
      metadata_id: productMetadataCache.id,
      metadata_normalized_url: productMetadataCache.normalized_url,
      metadata_source_site: productMetadataCache.source_site,
      metadata_source_product_id: productMetadataCache.source_product_id,
      metadata_name: productMetadataCache.name,
      metadata_price_amount: productMetadataCache.price_amount,
      metadata_currency: productMetadataCache.currency,
      metadata_availability_status: productMetadataCache.availability_status,
      metadata_availability_label: productMetadataCache.availability_label,
      metadata_og_title: productMetadataCache.og_title,
      metadata_og_description: productMetadataCache.og_description,
      metadata_og_image_url: productMetadataCache.og_image_url,
      metadata_og_site_name: productMetadataCache.og_site_name,
      metadata_fetched_at: productMetadataCache.fetched_at,
      metadata_expires_at: productMetadataCache.expires_at,
      metadata_error_code: productMetadataCache.error_code,
      metadata_error_message: productMetadataCache.error_message,
    })
    .from(plannedExpenses)
    .leftJoin(
      plannedExpenseCategories,
      eq(plannedExpenses.category_id, plannedExpenseCategories.id),
    )
    .leftJoin(
      budgetCategories,
      eq(plannedExpenses.budget_category_id, budgetCategories.id),
    )
    .leftJoin(
      expenseAccounts,
      eq(plannedExpenses.expense_account_id, expenseAccounts.id),
    )
    .leftJoin(
      categoryExpenseAccounts,
      eq(
        plannedExpenseCategories.default_expense_account_id,
        categoryExpenseAccounts.id,
      ),
    )
    .leftJoin(
      productMetadataCache,
      eq(plannedExpenses.product_metadata_cache_id, productMetadataCache.id),
    );

  const rows =
    kind === "wishlist"
      ? filters.length > 0
        ? await baseQuery
            .where(and(...filters))
            .orderBy(
              asc(plannedExpenseCategories.sort_order),
              asc(plannedExpenseCategories.name),
              asc(plannedExpenses.sort_order),
              asc(plannedExpenses.name),
              asc(plannedExpenses.id),
            )
        : await baseQuery.orderBy(
            asc(plannedExpenseCategories.sort_order),
            asc(plannedExpenseCategories.name),
            asc(plannedExpenses.sort_order),
            asc(plannedExpenses.name),
            asc(plannedExpenses.id),
          )
      : filters.length > 0
        ? await baseQuery
            .where(and(...filters))
            .orderBy(
              asc(plannedExpenses.status),
              asc(plannedExpenses.target_date),
              desc(plannedExpenses.created_at),
            )
        : await baseQuery.orderBy(
            asc(plannedExpenses.status),
            asc(plannedExpenses.target_date),
            desc(plannedExpenses.created_at),
          );

  return c.json(rows.map((row) => toResponse(row, scaleOptions)));
});

router.get("/categories", async (c) => {
  const kind = c.req.query("kind");
  const includeArchived = c.req.query("include_archived") === "true";
  if (kind && !plannedExpenseKinds.has(kind as PlannedExpenseKind)) {
    return c.json({ error: "invalid kind" }, 400);
  }
  const db = createDb(c.env);
  const scaleOptions = await loadMoneyScaleOptions(db);
  const baseQuery = db
    .select()
    .from(plannedExpenseCategories);
  const filters = [
    kind ? eq(plannedExpenseCategories.kind, kind as PlannedExpenseKind) : null,
    kind === "shopping_list" && !includeArchived
      ? isNull(plannedExpenseCategories.archived_at)
      : null,
  ].filter((filter) => filter !== null);
  const rows = kind
    ? await baseQuery
        .where(and(...filters))
        .orderBy(
          asc(plannedExpenseCategories.sort_order),
          asc(plannedExpenseCategories.name),
        )
    : await baseQuery.orderBy(
        asc(plannedExpenseCategories.kind),
        asc(plannedExpenseCategories.sort_order),
        asc(plannedExpenseCategories.name),
      );
  return c.json(rows.map((row) => categoryToResponse(row, scaleOptions)));
});

router.post("/categories", async (c) => {
  const body = await c.req.json<CreatePlannedExpenseCategoryInput>();
  if (!plannedExpenseKinds.has(body.kind)) {
    return c.json({ error: "invalid kind" }, 400);
  }
  const isShoppingList = body.kind === "shopping_list";
  const targetDate = normalizeTargetDate(body.target_date);
  if (targetDate === "__invalid__") {
    return c.json({ error: "target_date must be YYYY-MM-DD" }, 400);
  }
  if (
    body.shopping_plan_type !== undefined &&
    !shoppingPlanTypes.has(body.shopping_plan_type)
  ) {
    return c.json({ error: "invalid shopping_plan_type" }, 400);
  }
  const categoryName = body.name?.trim() || (isShoppingList ? targetDate : null);
  if (!categoryName) {
    return c.json(
      { error: isShoppingList ? "name or target_date is required" : "name is required" },
      400,
    );
  }
  const db = createDb(c.env);
  const scaleOptions = await loadMoneyScaleOptions(db);
  const currency = normalizeCurrency(body.currency);
  const amount = body.estimated_amount ?? 0;
  const invalidMoneyField = findInvalidMoneyField([
    {
      path: "estimated_amount",
      value: amount,
      currency,
      decimalPlaces: decimalPlacesForCurrency(scaleOptions, currency),
    },
  ]);
  if (invalidMoneyField) {
    return c.json(invalidMoneyResponse(invalidMoneyField, currency), 400);
  }
  if (amount < 0) {
    return c.json({ error: "estimated_amount must be non-negative" }, 400);
  }
  if (!(await validateExpenseAccount(db, body.default_expense_account_id))) {
    return c.json(
      { error: "default_expense_account_id must be an expense account" },
      400,
    );
  }
  const existingCategories = await db
    .select({
      id: plannedExpenseCategories.id,
      kind: plannedExpenseCategories.kind,
      name: plannedExpenseCategories.name,
    })
    .from(plannedExpenseCategories)
    .where(eq(plannedExpenseCategories.kind, body.kind));
  if (
    hasDuplicatePlannedExpenseCategoryName({
      name: categoryName,
      kind: body.kind,
      categories: existingCategories.map((category) => ({
        ...category,
        kind: category.kind as PlannedExpenseKind,
      })),
    })
  ) {
    return c.json({ error: "duplicate_planned_expense_category" }, 409);
  }
  const [row] = await db
    .insert(plannedExpenseCategories)
    .values({
      kind: body.kind,
      name: categoryName,
      estimated_amount: toStorageMoneyAmount(amount, currency, scaleOptions),
      currency,
      default_expense_account_id: isShoppingList
        ? (body.default_expense_account_id ?? null)
        : null,
      target_date: isShoppingList ? targetDate : null,
      shopping_plan_type: isShoppingList
        ? normalizeShoppingPlanType(body.shopping_plan_type)
        : "one_time",
      archived_at: null,
      sort_order: normalizeSortOrder(body.sort_order),
    })
    .returning();
  if (!row) return c.json({ error: "insert failed" }, 500);
  return c.json(categoryToResponse(row, scaleOptions), 201);
});

router.patch("/categories/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
  const body = await c.req.json<UpdatePlannedExpenseCategoryInput>();
  const db = createDb(c.env);
  const scaleOptions = await loadMoneyScaleOptions(db);
  const [existing] = await db
    .select()
    .from(plannedExpenseCategories)
    .where(eq(plannedExpenseCategories.id, id));
  if (!existing) return c.json({ error: "not found" }, 404);

  const currency = normalizeCurrency(body.currency ?? existing.currency);
  const invalidMoneyField = findInvalidMoneyField([
    {
      path: "estimated_amount",
      value: body.estimated_amount,
      currency,
      decimalPlaces: decimalPlacesForCurrency(scaleOptions, currency),
    },
  ]);
  if (invalidMoneyField) {
    return c.json(invalidMoneyResponse(invalidMoneyField, currency), 400);
  }
  if (body.estimated_amount !== undefined && body.estimated_amount < 0) {
    return c.json({ error: "estimated_amount must be non-negative" }, 400);
  }
  const targetDate = normalizeTargetDate(body.target_date);
  if (targetDate === "__invalid__") {
    return c.json({ error: "target_date must be YYYY-MM-DD" }, 400);
  }
  if (
    body.shopping_plan_type !== undefined &&
    !shoppingPlanTypes.has(body.shopping_plan_type)
  ) {
    return c.json({ error: "invalid shopping_plan_type" }, 400);
  }
  if (!(await validateExpenseAccount(db, body.default_expense_account_id))) {
    return c.json(
      { error: "default_expense_account_id must be an expense account" },
      400,
    );
  }
  const isShoppingList = existing.kind === "shopping_list";
  const nextTargetDate =
    body.target_date !== undefined ? targetDate : existing.target_date;
  const nextName =
    body.name !== undefined ? body.name.trim() : existing.name.trim();
  if (!nextName && (!isShoppingList || !nextTargetDate)) {
    return c.json(
      { error: isShoppingList ? "name or target_date is required" : "name is required" },
      400,
    );
  }
  const nextCategoryName = nextName || nextTargetDate || existing.name;
  const existingCategories = await db
    .select({
      id: plannedExpenseCategories.id,
      kind: plannedExpenseCategories.kind,
      name: plannedExpenseCategories.name,
    })
    .from(plannedExpenseCategories)
    .where(eq(plannedExpenseCategories.kind, existing.kind));
  if (
    hasDuplicatePlannedExpenseCategoryName({
      name: nextCategoryName,
      kind: existing.kind as PlannedExpenseKind,
      excludeId: id,
      categories: existingCategories.map((category) => ({
        ...category,
        kind: category.kind as PlannedExpenseKind,
      })),
    })
  ) {
    return c.json({ error: "duplicate_planned_expense_category" }, 409);
  }

  const updates: Partial<typeof plannedExpenseCategories.$inferInsert> = {
    updated_at: new Date().toISOString(),
  };
  if (body.name !== undefined) {
    updates.name = nextCategoryName;
  }
  if (body.currency !== undefined) updates.currency = currency;
  if (body.sort_order !== undefined) {
    updates.sort_order = normalizeSortOrder(body.sort_order);
  }
  if (body.estimated_amount !== undefined) {
    updates.estimated_amount = toStorageMoneyAmount(
      body.estimated_amount,
      currency,
      scaleOptions,
    );
  } else if (body.currency !== undefined && currency !== existing.currency) {
    updates.estimated_amount =
      rescaleStorageMoneyAmount(
        existing.estimated_amount,
        existing.currency,
        currency,
        scaleOptions,
      ) ?? 0;
  }
  if (body.default_expense_account_id !== undefined) {
    updates.default_expense_account_id = isShoppingList
      ? body.default_expense_account_id
      : null;
  }
  if (body.target_date !== undefined) {
    updates.target_date = isShoppingList ? targetDate : null;
  }
  if (body.shopping_plan_type !== undefined) {
    updates.shopping_plan_type = isShoppingList
      ? body.shopping_plan_type
      : "one_time";
  }
  if (body.archived_at !== undefined) {
    updates.archived_at = isShoppingList ? body.archived_at : null;
  }
  if (body.last_checked_out_date !== undefined) {
    const lastCheckedOutDate = normalizeTargetDate(body.last_checked_out_date);
    if (lastCheckedOutDate === "__invalid__") {
      return c.json(
        { error: "last_checked_out_date must be YYYY-MM-DD" },
        400,
      );
    }
    updates.last_checked_out_date = isShoppingList ? lastCheckedOutDate : null;
  }

  const [row] = await db
    .update(plannedExpenseCategories)
    .set(updates)
    .where(eq(plannedExpenseCategories.id, id))
    .returning();
  if (!row) return c.json({ error: "update failed" }, 500);
  return c.json(categoryToResponse(row, scaleOptions));
});

router.delete("/categories/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
  const db = createDb(c.env);
  await db.batch([
    db.delete(plannedExpenses).where(eq(plannedExpenses.category_id, id)),
    db
      .delete(plannedExpenseCategories)
      .where(eq(plannedExpenseCategories.id, id)),
  ]);
  return c.json({ success: true });
});

router.post("/metadata", async (c) => {
  const body = await c.req.json<ProductMetadataLookupInput>();
  const url = normalizeNullableText(body.url);
  if (!url) return c.json({ error: "url is required" }, 400);

  const metadata = await lookupProductMetadata(c.env, url, {
    force: body.force === true,
  });
  if (!metadata) return c.json({ error: "unsupported url" }, 400);
  return c.json(metadata);
});

router.post("/", async (c) => {
  const body = await c.req.json<CreatePlannedExpenseInput>();
  if (!plannedExpenseKinds.has(body.kind)) {
    return c.json({ error: "invalid kind" }, 400);
  }
  if (!body.name?.trim()) {
    return c.json({ error: "name is required" }, 400);
  }
  if (body.status && !plannedExpenseStatuses.has(body.status)) {
    return c.json({ error: "invalid status" }, 400);
  }

  const db = createDb(c.env);
  const scaleOptions = await loadMoneyScaleOptions(db);
  const currency = normalizeCurrency(body.currency);
  const invalidMoneyField = findInvalidMoneyField([
    {
      path: "estimated_amount",
      value: body.estimated_amount,
      currency,
      decimalPlaces: decimalPlacesForCurrency(scaleOptions, currency),
    },
  ]);
  if (invalidMoneyField) {
    return c.json(invalidMoneyResponse(invalidMoneyField, currency), 400);
  }
  if (body.estimated_amount < 0) {
    return c.json({ error: "estimated_amount must be non-negative" }, 400);
  }

  const targetDate = normalizeTargetDate(body.target_date);
  if (targetDate === "__invalid__") {
    return c.json({ error: "target_date must be YYYY-MM-DD" }, 400);
  }
  if (!(await validateExpenseAccount(db, body.expense_account_id))) {
    return c.json({ error: "expense_account_id must be an expense account" }, 400);
  }
  if (!(await validateCategory(db, body.category_id, body.kind))) {
    return c.json({ error: "category_id must match kind" }, 400);
  }
  const recurrenceType = body.recurrence_type ?? "one_time";
  if (!recurrenceTypes.has(recurrenceType)) {
    return c.json({ error: "invalid recurrence_type" }, 400);
  }
  const recurrenceUnit = body.recurrence_unit ?? "month";
  if (recurrenceType === "recurring" && !recurrenceUnits.has(recurrenceUnit)) {
    return c.json({ error: "invalid recurrence_unit" }, 400);
  }
  const recurrenceMonthlyMode =
    body.recurrence_monthly_mode ??
    (body.recurrence_day == null ? null : "day_of_month");
  if (
    recurrenceType === "recurring" &&
    recurrenceUnit === "month" &&
    recurrenceMonthlyMode !== null &&
    !recurrenceMonthlyModes.has(recurrenceMonthlyMode)
  ) {
    return c.json({ error: "invalid recurrence_monthly_mode" }, 400);
  }
  const nextDueDate = normalizeOptionalDate(body.next_due_date);
  if (nextDueDate === "__invalid__") {
    return c.json({ error: "next_due_date must be YYYY-MM-DD" }, 400);
  }
  const endDate = normalizeOptionalDate(body.end_date);
  if (endDate === "__invalid__") {
    return c.json({ error: "end_date must be YYYY-MM-DD" }, 400);
  }
  const recurrenceCount = body.recurrence_count ?? null;
  if (
    recurrenceCount != null &&
    (!Number.isInteger(recurrenceCount) || recurrenceCount <= 0)
  ) {
    return c.json(
      { error: "recurrence_count must be a positive integer" },
      400,
    );
  }
  if (endDate != null && recurrenceCount != null) {
    return c.json(
      { error: "end_date and recurrence_count cannot both be set" },
      400,
    );
  }
  const skippedDates = normalizeSkippedDates(body.skipped_dates);
  if (skippedDates === "__invalid__") {
    return c.json({ error: "skipped_dates must be YYYY-MM-DD list" }, 400);
  }
  const completedDates = normalizeCompletedDates(body.completed_dates);
  if (completedDates === "__invalid__") {
    return c.json({ error: "completed_dates must be YYYY-MM-DD list" }, 400);
  }
  const recurrenceInterval =
    body.recurrence_interval ??
    body.recurrence_interval_months ??
    null;
  if (
    recurrenceInterval != null &&
    (!Number.isInteger(recurrenceInterval) || recurrenceInterval <= 0)
  ) {
    return c.json(
      { error: "recurrence_interval must be a positive integer" },
      400,
    );
  }
  const recurrenceDay = body.recurrence_day == null ? null : body.recurrence_day;
  if (
    recurrenceDay != null &&
    (!Number.isInteger(recurrenceDay) || recurrenceDay < 0 || recurrenceDay > 31)
  ) {
    return c.json({ error: "recurrence_day must be 0-31" }, 400);
  }
  const recurrenceWeeksOfMonth = normalizeWeeksOfMonth(
    body.recurrence_weeks_of_month,
  );
  const recurrenceWeekday =
    body.recurrence_weekday == null ? null : body.recurrence_weekday;
  if (
    recurrenceWeekday != null &&
    (!Number.isInteger(recurrenceWeekday) ||
      recurrenceWeekday < 0 ||
      recurrenceWeekday > 6)
  ) {
    return c.json({ error: "recurrence_weekday must be 0-6" }, 400);
  }
  const recurrenceWeekFallback = normalizePlannedExpenseWeekFallback(
    body.recurrence_week_fallback,
  );
  if (
    body.recurrence_week_fallback != null &&
    !recurrenceWeekFallbacks.has(body.recurrence_week_fallback)
  ) {
    return c.json({ error: "invalid recurrence_week_fallback" }, 400);
  }
  if (
    recurrenceType === "recurring" &&
    recurrenceUnit === "month" &&
    recurrenceMonthlyMode === "week_of_month" &&
    (!recurrenceWeeksOfMonth || recurrenceWeekday == null)
  ) {
    return c.json(
      { error: "recurrence_weeks_of_month and recurrence_weekday are required" },
      400,
    );
  }
  const resolvedNextDueDate =
    recurrenceType === "recurring" && recurrenceUnit === "month"
      ? (recurrenceMonthlyMode ?? "day_of_month") === "day_of_month"
        ? resolveMonthlyRecurrenceDate(nextDueDate, recurrenceDay)
        : resolvePlannedExpenseWeekdayRuleDate({
            date: nextDueDate,
            weeksOfMonth: recurrenceWeeksOfMonth,
            weekday: recurrenceWeekday,
            fallback: recurrenceWeekFallback,
          })
      : nextDueDate;
  const isShoppingList = body.kind === "shopping_list";
  if (isShoppingList && body.category_id == null) {
    return c.json(
      { error: "category_id is required for shopping list items" },
      400,
    );
  }
  const normalizedName = body.name.trim();
  const normalizedNote = normalizeNullableText(body.note);
  if (
    await hasDuplicatePlannedExpenseItem(db, {
      kind: body.kind,
      categoryId: body.category_id,
      name: normalizedName,
    })
  ) {
    return c.json({ error: "duplicate_planned_expense_item" }, 409);
  }
  const now = new Date().toISOString();
  const status = body.status ?? "open";

  const [row] = await db
    .insert(plannedExpenses)
    .values({
      kind: body.kind,
      category_id: body.category_id ?? null,
      name: normalizedName,
      estimated_amount: toStorageMoneyAmount(
        body.estimated_amount,
        currency,
        scaleOptions,
      ),
      currency,
      budget_category_id: body.budget_category_id ?? null,
      expense_account_id: isShoppingList
        ? null
        : (body.expense_account_id ?? null),
      target_date: isShoppingList ? null : targetDate,
      recurrence_type: recurrenceType,
      recurrence_interval:
        recurrenceType === "recurring" ? (recurrenceInterval ?? 1) : null,
      recurrence_unit: recurrenceType === "recurring" ? recurrenceUnit : null,
      recurrence_monthly_mode:
        recurrenceType === "recurring" && recurrenceUnit === "month"
          ? (recurrenceMonthlyMode ?? "day_of_month")
          : null,
      recurrence_interval_months:
        recurrenceType === "recurring" && recurrenceUnit === "month"
          ? (recurrenceInterval ?? 1)
          : null,
      recurrence_day:
        recurrenceType === "recurring" &&
        recurrenceUnit === "month" &&
        (recurrenceMonthlyMode ?? "day_of_month") === "day_of_month"
          ? recurrenceDay
          : null,
      recurrence_weeks_of_month:
        recurrenceType === "recurring" &&
        recurrenceUnit === "month" &&
        recurrenceMonthlyMode === "week_of_month"
          ? recurrenceWeeksOfMonth
          : null,
      recurrence_weekday:
        recurrenceType === "recurring" &&
        recurrenceUnit === "month" &&
        recurrenceMonthlyMode === "week_of_month"
          ? recurrenceWeekday
          : null,
      recurrence_week_fallback:
        recurrenceType === "recurring" &&
        recurrenceUnit === "month" &&
        recurrenceMonthlyMode === "week_of_month"
          ? recurrenceWeekFallback
          : null,
      next_due_date: recurrenceType === "recurring" ? resolvedNextDueDate : null,
      end_date: recurrenceType === "recurring" ? endDate : null,
      recurrence_count:
        recurrenceType === "recurring" ? recurrenceCount : null,
      skipped_dates: recurrenceType === "recurring" ? skippedDates : null,
      completed_dates: recurrenceType === "recurring" ? completedDates : null,
      sort_order: normalizeSortOrder(body.sort_order),
      status,
      keep_on_routine_clear:
        isShoppingList && body.keep_on_routine_clear === true ? 1 : 0,
      note: normalizedNote,
      url: normalizeNullableText(body.url),
      product_metadata_cache_id: body.product_metadata_cache_id ?? null,
      updated_at: now,
    })
    .returning();

  if (!row) return c.json({ error: "insert failed" }, 500);
  if (body.kind === "wishlist" && isWishlistClosedStatus(status)) {
    await pruneWishlistClosedItems(db);
  }
  const result = await fetchOne(db, row.id, scaleOptions);
  return c.json(result, 201);
});

router.post("/:id/refresh-metadata", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);

  const db = createDb(c.env);
  const scaleOptions = await loadMoneyScaleOptions(db);
  const [existing] = await db
    .select()
    .from(plannedExpenses)
    .where(eq(plannedExpenses.id, id));
  if (!existing) return c.json({ error: "not found" }, 404);
  if (!existing.url) return c.json({ error: "url is required" }, 400);

  const metadata = await lookupProductMetadata(c.env, existing.url, {
    force: true,
  });
  if (!metadata) return c.json({ error: "unsupported url" }, 400);
  const shouldPreserveWishlistClosedDate =
    existing.kind === "wishlist" && isWishlistClosedStatus(existing.status);

  await db
    .update(plannedExpenses)
    .set({
      product_metadata_cache_id: metadata.id,
      updated_at: shouldPreserveWishlistClosedDate
        ? existing.updated_at
        : new Date().toISOString(),
    })
    .where(eq(plannedExpenses.id, id));

  const result = await fetchOne(db, id, scaleOptions);
  return c.json(result);
});

router.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);

  const body = await c.req.json<UpdatePlannedExpenseInput>();
  const db = createDb(c.env);
  const scaleOptions = await loadMoneyScaleOptions(db);
  const [existing] = await db
    .select()
    .from(plannedExpenses)
    .where(eq(plannedExpenses.id, id));
  if (!existing) return c.json({ error: "not found" }, 404);

  if (body.name !== undefined && !body.name.trim()) {
    return c.json({ error: "name is required" }, 400);
  }
  if (body.status && !plannedExpenseStatuses.has(body.status)) {
    return c.json({ error: "invalid status" }, 400);
  }

  const currency = normalizeCurrency(body.currency ?? existing.currency);
  const invalidMoneyField = findInvalidMoneyField([
    {
      path: "estimated_amount",
      value: body.estimated_amount,
      currency,
      decimalPlaces: decimalPlacesForCurrency(scaleOptions, currency),
    },
  ]);
  if (invalidMoneyField) {
    return c.json(invalidMoneyResponse(invalidMoneyField, currency), 400);
  }
  if (body.estimated_amount !== undefined && body.estimated_amount < 0) {
    return c.json({ error: "estimated_amount must be non-negative" }, 400);
  }
  if (
    body.category_id !== undefined &&
    !(await validateCategory(
      db,
      body.category_id,
      existing.kind as PlannedExpenseKind,
    ))
  ) {
    return c.json({ error: "category_id must match kind" }, 400);
  }
  const isShoppingList = existing.kind === "shopping_list";
  const nextCategoryId =
    body.category_id !== undefined ? body.category_id : existing.category_id;
  if (isShoppingList && nextCategoryId == null) {
    return c.json(
      { error: "category_id is required for shopping list items" },
      400,
    );
  }
  const nextName =
    body.name !== undefined ? body.name.trim() : existing.name;
  const nextNote =
    body.note !== undefined ? normalizeNullableText(body.note) : existing.note;
  if (
    await hasDuplicatePlannedExpenseItem(db, {
      kind: existing.kind as PlannedExpenseKind,
      categoryId: nextCategoryId,
      name: nextName,
      excludeId: id,
    })
  ) {
    return c.json({ error: "duplicate_planned_expense_item" }, 409);
  }
  if (
    body.recurrence_type !== undefined &&
    !recurrenceTypes.has(body.recurrence_type)
  ) {
    return c.json({ error: "invalid recurrence_type" }, 400);
  }
  if (
    body.recurrence_unit !== undefined &&
    body.recurrence_unit !== null &&
    !recurrenceUnits.has(body.recurrence_unit)
  ) {
    return c.json({ error: "invalid recurrence_unit" }, 400);
  }
  if (
    body.recurrence_monthly_mode !== undefined &&
    body.recurrence_monthly_mode !== null &&
    !recurrenceMonthlyModes.has(body.recurrence_monthly_mode)
  ) {
    return c.json({ error: "invalid recurrence_monthly_mode" }, 400);
  }
  if (
    body.recurrence_interval !== undefined &&
    body.recurrence_interval !== null &&
    (!Number.isInteger(body.recurrence_interval) ||
      body.recurrence_interval <= 0)
  ) {
    return c.json(
      { error: "recurrence_interval must be a positive integer" },
      400,
    );
  }
  if (
    body.recurrence_interval_months !== undefined &&
    body.recurrence_interval_months !== null &&
    (!Number.isInteger(body.recurrence_interval_months) ||
      body.recurrence_interval_months <= 0)
  ) {
    return c.json(
      { error: "recurrence_interval_months must be a positive integer" },
      400,
    );
  }
  if (
    body.recurrence_count !== undefined &&
    body.recurrence_count !== null &&
    (!Number.isInteger(body.recurrence_count) || body.recurrence_count <= 0)
  ) {
    return c.json(
      { error: "recurrence_count must be a positive integer" },
      400,
    );
  }
  if (
    body.end_date !== undefined &&
    body.end_date !== null &&
    body.recurrence_count !== undefined &&
    body.recurrence_count !== null
  ) {
    return c.json(
      { error: "end_date and recurrence_count cannot both be set" },
      400,
    );
  }
  if (
    body.recurrence_day !== undefined &&
    body.recurrence_day !== null &&
    (!Number.isInteger(body.recurrence_day) ||
      body.recurrence_day < 0 ||
      body.recurrence_day > 31)
  ) {
    return c.json({ error: "recurrence_day must be 0-31" }, 400);
  }
  if (
    body.recurrence_weekday !== undefined &&
    body.recurrence_weekday !== null &&
    (!Number.isInteger(body.recurrence_weekday) ||
      body.recurrence_weekday < 0 ||
      body.recurrence_weekday > 6)
  ) {
    return c.json({ error: "recurrence_weekday must be 0-6" }, 400);
  }
  if (
    body.recurrence_week_fallback !== undefined &&
    body.recurrence_week_fallback !== null &&
    !recurrenceWeekFallbacks.has(body.recurrence_week_fallback)
  ) {
    return c.json({ error: "invalid recurrence_week_fallback" }, 400);
  }
  const nextSkippedDates =
    body.skipped_dates !== undefined
      ? normalizeSkippedDates(body.skipped_dates)
      : existing.skipped_dates;
  if (nextSkippedDates === "__invalid__") {
    return c.json({ error: "skipped_dates must be YYYY-MM-DD list" }, 400);
  }
  const nextCompletedDates =
    body.completed_dates !== undefined
      ? normalizeCompletedDates(body.completed_dates)
      : existing.completed_dates;
  if (nextCompletedDates === "__invalid__") {
    return c.json({ error: "completed_dates must be YYYY-MM-DD list" }, 400);
  }
  const nextRecurrenceType =
    body.recurrence_type ?? (existing.recurrence_type as PlannedExpenseRecurrenceType);
  const nextRecurrenceUnit =
    body.recurrence_unit ??
    ((existing.recurrence_unit as PlannedExpenseRecurrenceUnit | null) ??
      (existing.recurrence_type === "recurring" ? "month" : null));
  const nextRecurrenceMonthlyMode =
    body.recurrence_monthly_mode ??
    ((existing.recurrence_monthly_mode as PlannedExpenseMonthlyMode | null) ??
      (existing.recurrence_day == null ? null : "day_of_month"));
  const nextRecurrenceWeeksOfMonth =
    body.recurrence_weeks_of_month !== undefined
      ? normalizeWeeksOfMonth(body.recurrence_weeks_of_month)
      : existing.recurrence_weeks_of_month;
  const nextRecurrenceDay =
    body.recurrence_day !== undefined
      ? body.recurrence_day
      : existing.recurrence_day;
  const nextRecurrenceWeekday =
    body.recurrence_weekday !== undefined
      ? body.recurrence_weekday
      : existing.recurrence_weekday;
  const nextRecurrenceWeekFallback =
    body.recurrence_week_fallback !== undefined
      ? normalizePlannedExpenseWeekFallback(body.recurrence_week_fallback)
      : normalizePlannedExpenseWeekFallback(existing.recurrence_week_fallback);
  const shouldResolveMonthlyDayNextDueDate =
    nextRecurrenceType === "recurring" &&
    nextRecurrenceUnit === "month" &&
    (nextRecurrenceMonthlyMode ?? "day_of_month") === "day_of_month";
  const shouldResolveMonthlyWeekdayNextDueDate =
    nextRecurrenceType === "recurring" &&
    nextRecurrenceUnit === "month" &&
    nextRecurrenceMonthlyMode === "week_of_month";
  if (
    nextRecurrenceType === "recurring" &&
    nextRecurrenceUnit === "month" &&
    nextRecurrenceMonthlyMode === "week_of_month" &&
    (!nextRecurrenceWeeksOfMonth || nextRecurrenceWeekday == null)
  ) {
    return c.json(
      { error: "recurrence_weeks_of_month and recurrence_weekday are required" },
      400,
    );
  }

  const statusChanged =
    body.status !== undefined && body.status !== existing.status;
  const shouldPreserveWishlistClosedDate =
    existing.kind === "wishlist" &&
    isWishlistClosedStatus(existing.status) &&
    !statusChanged;
  const updates: Partial<typeof plannedExpenses.$inferInsert> = {
    updated_at: shouldPreserveWishlistClosedDate
      ? existing.updated_at
      : new Date().toISOString(),
  };
  if (body.name !== undefined) updates.name = nextName;
  if (body.category_id !== undefined) {
    updates.category_id = body.category_id;
  }
  if (body.currency !== undefined) updates.currency = currency;
  if (body.estimated_amount !== undefined) {
    updates.estimated_amount = toStorageMoneyAmount(
      body.estimated_amount,
      currency,
      scaleOptions,
    );
  } else if (body.currency !== undefined && currency !== existing.currency) {
    updates.estimated_amount =
      rescaleStorageMoneyAmount(
        existing.estimated_amount,
        existing.currency,
        currency,
        scaleOptions,
      ) ?? 0;
  }
  if (body.budget_category_id !== undefined) {
    updates.budget_category_id = body.budget_category_id;
  }
  if (body.expense_account_id !== undefined) {
    if (!(await validateExpenseAccount(db, body.expense_account_id))) {
      return c.json(
        { error: "expense_account_id must be an expense account" },
        400,
      );
    }
    updates.expense_account_id = body.expense_account_id;
  }
  if (body.target_date !== undefined) {
    const targetDate = normalizeTargetDate(body.target_date);
    if (targetDate === "__invalid__") {
      return c.json({ error: "target_date must be YYYY-MM-DD" }, 400);
    }
    updates.target_date = targetDate;
  }
  if (body.recurrence_type !== undefined) {
    updates.recurrence_type = body.recurrence_type;
    if (body.recurrence_type === "one_time") {
      updates.recurrence_interval = null;
      updates.recurrence_unit = null;
      updates.recurrence_monthly_mode = null;
      updates.recurrence_interval_months = null;
      updates.recurrence_day = null;
      updates.recurrence_weeks_of_month = null;
      updates.recurrence_weekday = null;
      updates.recurrence_week_fallback = null;
      updates.next_due_date = null;
      updates.end_date = null;
      updates.recurrence_count = null;
      updates.skipped_dates = null;
      updates.completed_dates = null;
    }
  }
  if (body.recurrence_interval !== undefined) {
    updates.recurrence_interval = body.recurrence_interval;
  }
  if (body.recurrence_unit !== undefined) {
    updates.recurrence_unit = body.recurrence_unit;
    if (body.recurrence_unit !== "month") {
      updates.recurrence_monthly_mode = null;
      updates.recurrence_interval_months = null;
      updates.recurrence_day = null;
      updates.recurrence_weeks_of_month = null;
      updates.recurrence_weekday = null;
      updates.recurrence_week_fallback = null;
    }
  }
  if (body.recurrence_monthly_mode !== undefined) {
    updates.recurrence_monthly_mode = body.recurrence_monthly_mode;
    if (body.recurrence_monthly_mode === "day_of_month") {
      updates.recurrence_weeks_of_month = null;
      updates.recurrence_weekday = null;
      updates.recurrence_week_fallback = null;
    } else if (body.recurrence_monthly_mode === "week_of_month") {
      updates.recurrence_day = null;
      updates.recurrence_week_fallback = nextRecurrenceWeekFallback;
    }
  }
  if (body.recurrence_interval_months !== undefined) {
    updates.recurrence_interval_months = body.recurrence_interval_months;
  }
  if (body.recurrence_day !== undefined) {
    updates.recurrence_day = body.recurrence_day;
    if (body.next_due_date === undefined && shouldResolveMonthlyDayNextDueDate) {
      updates.next_due_date = resolveMonthlyRecurrenceDate(
        existing.next_due_date,
        nextRecurrenceDay,
      );
    }
  }
  if (body.recurrence_weeks_of_month !== undefined) {
    updates.recurrence_weeks_of_month = normalizeWeeksOfMonth(
      body.recurrence_weeks_of_month,
    );
  }
  if (body.recurrence_weekday !== undefined) {
    updates.recurrence_weekday = body.recurrence_weekday;
  }
  if (body.recurrence_week_fallback !== undefined) {
    updates.recurrence_week_fallback = body.recurrence_week_fallback;
  }
  if (body.next_due_date !== undefined) {
    const nextDueDate = normalizeOptionalDate(body.next_due_date);
    if (nextDueDate === "__invalid__") {
      return c.json({ error: "next_due_date must be YYYY-MM-DD" }, 400);
    }
    updates.next_due_date = shouldResolveMonthlyDayNextDueDate
      ? resolveMonthlyRecurrenceDate(nextDueDate, nextRecurrenceDay)
      : shouldResolveMonthlyWeekdayNextDueDate
        ? resolvePlannedExpenseWeekdayRuleDate({
            date: nextDueDate,
            weeksOfMonth: nextRecurrenceWeeksOfMonth,
            weekday: nextRecurrenceWeekday,
            fallback: nextRecurrenceWeekFallback,
          })
        : nextDueDate;
  }
  if (body.end_date !== undefined) {
    const endDate = normalizeOptionalDate(body.end_date);
    if (endDate === "__invalid__") {
      return c.json({ error: "end_date must be YYYY-MM-DD" }, 400);
    }
    updates.end_date = endDate;
    if (endDate != null) {
      updates.recurrence_count = null;
    }
  }
  if (body.recurrence_count !== undefined) {
    updates.recurrence_count =
      nextRecurrenceType === "recurring" ? body.recurrence_count : null;
    if (body.recurrence_count != null) {
      updates.end_date = null;
    }
  }
  if (body.skipped_dates !== undefined) {
    updates.skipped_dates =
      nextRecurrenceType === "recurring" ? nextSkippedDates : null;
  }
  if (body.completed_dates !== undefined) {
    updates.completed_dates =
      nextRecurrenceType === "recurring" ? nextCompletedDates : null;
  }
  if (body.sort_order !== undefined) {
    updates.sort_order = normalizeSortOrder(body.sort_order);
  }
  if (body.status !== undefined) updates.status = body.status;
  if (body.keep_on_routine_clear !== undefined) {
    updates.keep_on_routine_clear =
      isShoppingList && body.keep_on_routine_clear === true ? 1 : 0;
  }
  if (body.note !== undefined) updates.note = nextNote;
  if (body.url !== undefined) updates.url = normalizeNullableText(body.url);
  if (body.product_metadata_cache_id !== undefined) {
    updates.product_metadata_cache_id = body.product_metadata_cache_id;
  }

  await db.update(plannedExpenses).set(updates).where(eq(plannedExpenses.id, id));
  if (
    existing.kind === "wishlist" &&
    body.status !== undefined &&
    isWishlistClosedStatus(body.status)
  ) {
    await pruneWishlistClosedItems(db);
  }
  const result = await fetchOne(db, id, scaleOptions);
  return c.json(result);
});

router.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
  const db = createDb(c.env);
  await db.delete(plannedExpenses).where(eq(plannedExpenses.id, id));
  return c.json({ success: true });
});

export { router as plannedExpensesRouter };
