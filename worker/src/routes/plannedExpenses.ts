import { and, asc, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { Hono } from "hono";
import {
  hasDuplicatePlannedExpenseCategoryName,
  hasDuplicatePlannedExpenseItemName,
  type CreatePlannedExpenseInput,
  type CreatePlannedExpenseCategoryInput,
  type CompletePlannedExpenseWithJournalInput,
  type CompletePlannedExpenseWithJournalResponse,
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
  budgetAdjustmentLogs,
  journalEntries,
  journalEntryBudgetAllocations,
  journalLines,
  plannedExpenseCategories,
  plannedExpenseCompletionRequests,
  plannedExpenses,
  productMetadataCache,
} from "../db/schema";
import { lookupProductMetadata } from "../lib/productMetadata";
import { loadCurrencyDecimalPlaces } from "../lib/currencyPrecision";
import {
  isWishlistClosedStatus,
  selectWishlistClosedItemIdsToDeleteByCurrency,
  WISHLIST_CLOSED_RETENTION_LIMIT,
} from "../lib/plannedExpenseRetention";
import {
  isPlannedExpenseCategoryCurrencyCompatible,
} from "../lib/plannedExpenseCurrency";
import {
  findInvalidMoneyField,
  findInvalidMoney,
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

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function buildRowsSql(rowCount: number, columnsPerRow: number): string {
  const row = `(${placeholders(columnsPerRow)})`;
  return Array.from({ length: rowCount }, () => row).join(", ");
}

function buildNewJournalEntryRowsSql(rowCount: number, columnsPerRow: number): string {
  const row = `((SELECT MAX(id) FROM journal_entries), ${placeholders(
    columnsPerRow,
  )})`;
  return Array.from({ length: rowCount }, () => row).join(", ");
}

function journalCurrencyFromLines(
  lines: Array<{ debit?: number; credit?: number; currency?: string }>,
): string {
  const line = lines.find((line) => (line.debit ?? 0) > 0 || (line.credit ?? 0) > 0);
  return normalizeCurrency(line?.currency);
}

function validDate(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeIdList(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const ids = Array.from(new Set(value));
  return ids.every((id) => Number.isInteger(id) && id > 0) ? ids : null;
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
  currency: string,
) {
  if (categoryId == null) return true;
  if (!Number.isInteger(categoryId)) return false;
  const [category] = await db
    .select({
      id: plannedExpenseCategories.id,
      kind: plannedExpenseCategories.kind,
      currency: plannedExpenseCategories.currency,
    })
    .from(plannedExpenseCategories)
    .where(eq(plannedExpenseCategories.id, categoryId));
  return isPlannedExpenseCategoryCurrencyCompatible(category, kind, currency);
}

async function hasDuplicatePlannedExpenseItem(
  db: ReturnType<typeof createDb>,
  input: {
    kind: PlannedExpenseKind;
    categoryId: number | null | undefined;
    name: string;
    currency: string;
    excludeId?: number;
  },
) {
  const rows = await db
    .select({
      id: plannedExpenses.id,
      kind: plannedExpenses.kind,
      category_id: plannedExpenses.category_id,
      name: plannedExpenses.name,
      currency: plannedExpenses.currency,
    })
    .from(plannedExpenses)
    .where(
      and(
        eq(plannedExpenses.kind, input.kind),
        input.categoryId == null
          ? isNull(plannedExpenses.category_id)
          : eq(plannedExpenses.category_id, input.categoryId),
        eq(plannedExpenses.currency, normalizeCurrency(input.currency)),
      ),
    );
  return hasDuplicatePlannedExpenseItemName({
    name: input.name,
    kind: input.kind,
    categoryId: input.categoryId ?? null,
    excludeId: input.excludeId,
    currency: input.currency,
    items: rows.map((row) => ({
      ...row,
      kind: row.kind as PlannedExpenseKind,
    })),
  });
}

async function fetchLatestClosedWishlistItemIds(
  db: ReturnType<typeof createDb>,
  limit = WISHLIST_CLOSED_RETENTION_LIMIT,
  currency?: string | null,
) {
  const rows = await db
    .select({
      id: plannedExpenses.id,
      status: plannedExpenses.status,
      currency: plannedExpenses.currency,
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
        currency
          ? eq(plannedExpenses.currency, normalizeCurrency(currency))
          : undefined,
      ),
    )
    .orderBy(desc(plannedExpenses.updated_at), desc(plannedExpenses.id));
  const idsToExclude = new Set(
    selectWishlistClosedItemIdsToDeleteByCurrency(rows, limit),
  );
  return rows.filter((row) => !idsToExclude.has(row.id)).map((row) => row.id);
}

async function pruneWishlistClosedItems(db: ReturnType<typeof createDb>) {
  const rows = await db
    .select({
      id: plannedExpenses.id,
      status: plannedExpenses.status,
      currency: plannedExpenses.currency,
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
  const idsToDelete = selectWishlistClosedItemIdsToDeleteByCurrency(rows);
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
  const requestedCurrency = c.req.query("currency")
    ? normalizeCurrency(c.req.query("currency"))
    : null;
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
      ? await fetchLatestClosedWishlistItemIds(
          db,
          WISHLIST_CLOSED_RETENTION_LIMIT,
          requestedCurrency,
        )
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
    requestedCurrency
      ? eq(plannedExpenses.currency, requestedCurrency)
      : null,
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
  const requestedCurrency = c.req.query("currency")
    ? normalizeCurrency(c.req.query("currency"))
    : null;
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
    requestedCurrency
      ? eq(plannedExpenseCategories.currency, requestedCurrency)
      : null,
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
      currency: plannedExpenseCategories.currency,
    })
    .from(plannedExpenseCategories)
    .where(
      and(
        eq(plannedExpenseCategories.kind, body.kind),
        eq(plannedExpenseCategories.currency, currency),
      ),
    );
  if (
    hasDuplicatePlannedExpenseCategoryName({
      name: categoryName,
      kind: body.kind,
      currency,
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
      currency: plannedExpenseCategories.currency,
    })
    .from(plannedExpenseCategories)
    .where(
      and(
        eq(plannedExpenseCategories.kind, existing.kind),
        eq(plannedExpenseCategories.currency, currency),
      ),
    );
  if (
    hasDuplicatePlannedExpenseCategoryName({
      name: nextCategoryName,
      kind: existing.kind as PlannedExpenseKind,
      currency,
      excludeId: id,
      categories: existingCategories.map((category) => ({
        ...category,
        kind: category.kind as PlannedExpenseKind,
      })),
    })
  ) {
    return c.json({ error: "duplicate_planned_expense_category" }, 409);
  }

  if (body.currency !== undefined && currency !== existing.currency) {
    const [linkedItem] = await db
      .select({ id: plannedExpenses.id })
      .from(plannedExpenses)
      .where(eq(plannedExpenses.category_id, id))
      .limit(1);
    if (linkedItem) {
      return c.json({ error: "category_currency_in_use" }, 409);
    }
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
  if (!(await validateCategory(db, body.category_id, body.kind, currency))) {
    return c.json({ error: "category_id must match kind and currency" }, 400);
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
      currency,
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

router.post("/:id/complete-with-journal", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);

  const body = await c.req.json<CompletePlannedExpenseWithJournalInput>();
  const journal = body.journal;
  if (
    !body.idempotency_key ||
    body.idempotency_key.length > 128 ||
    !journal?.date ||
    !journal.description ||
    !Array.isArray(journal.lines) ||
    journal.lines.length < 2
  ) {
    return c.json({ error: "idempotency_key, journal date, description, and lines are required" }, 400);
  }

  const db = createDb(c.env);
  const [replayed] = await db
    .select()
    .from(plannedExpenseCompletionRequests)
    .where(eq(plannedExpenseCompletionRequests.idempotency_key, body.idempotency_key));
  if (replayed) {
    return c.json({
      journal_entry_id: replayed.journal_entry_id,
      completion: replayed.completion as CompletePlannedExpenseWithJournalResponse["completion"],
      replayed: true,
    });
  }

  const [source] = await db
    .select()
    .from(plannedExpenses)
    .where(eq(plannedExpenses.id, id));
  if (!source) return c.json({ error: "not found" }, 404);

  const decimalPlacesByCurrency = await loadCurrencyDecimalPlaces(db);
  const scaleOptions = { decimalPlacesByCurrency };
  const invalidMoney = findInvalidMoney([
    ...journal.lines.flatMap((line, index) => [
      {
        path: `journal.lines[${index}].debit`,
        value: line.debit,
        currency: line.currency,
        decimalPlaces: decimalPlacesByCurrency[normalizeCurrency(line.currency)],
      },
      {
        path: `journal.lines[${index}].credit`,
        value: line.credit,
        currency: line.currency,
        decimalPlaces: decimalPlacesByCurrency[normalizeCurrency(line.currency)],
      },
    ]),
    ...(journal.budget_allocations ?? []).map((allocation, index) => ({
      path: `journal.budget_allocations[${index}].amount`,
      value: allocation.amount,
      currency: allocation.currency ?? journalCurrencyFromLines(journal.lines),
      decimalPlaces:
        decimalPlacesByCurrency[
          normalizeCurrency(allocation.currency ?? journalCurrencyFromLines(journal.lines))
        ],
    })),
    ...(journal.income_budget_allocations ?? []).map((allocation, index) => ({
      path: `journal.income_budget_allocations[${index}].amount`,
      value: allocation.amount,
      currency: allocation.currency ?? journalCurrencyFromLines(journal.lines),
      decimalPlaces:
        decimalPlacesByCurrency[
          normalizeCurrency(allocation.currency ?? journalCurrencyFromLines(journal.lines))
        ],
    })),
  ]);
  if (invalidMoney) {
    return c.json(invalidMoneyResponse(invalidMoney.path, invalidMoney.currency), 400);
  }
  if (!journal.is_currency_exchange) {
    const debit = journal.lines.reduce((sum, line) => sum + (line.debit ?? 0), 0);
    const credit = journal.lines.reduce((sum, line) => sum + (line.credit ?? 0), 0);
    if (Math.abs(debit - credit) > 0.001) {
      return c.json({ error: "unbalanced entry" }, 400);
    }
  }

  const checkoutItemIds = normalizeIdList(body.checkout_item_ids) ?? [id];
  const checkoutKeepItemIds = normalizeIdList(body.checkout_keep_item_ids) ?? [];
  if (body.checkout_item_ids != null && checkoutItemIds.length === 0) {
    return c.json({ error: "checkout_item_ids must not be empty" }, 400);
  }
  if (!checkoutKeepItemIds.every((itemId) => checkoutItemIds.includes(itemId))) {
    return c.json({ error: "checkout_keep_item_ids must be included in checkout_item_ids" }, 400);
  }
  if (source.kind !== "shopping_list" && checkoutItemIds.some((itemId) => itemId !== id)) {
    return c.json({ error: "only shopping lists can complete multiple items" }, 400);
  }

  const checkoutItems = await db
    .select()
    .from(plannedExpenses)
    .where(inArray(plannedExpenses.id, checkoutItemIds));
  if (checkoutItems.length !== checkoutItemIds.length) {
    return c.json({ error: "checkout item not found" }, 400);
  }
  if (
    source.kind === "shopping_list" &&
    (source.category_id == null ||
      checkoutItems.some(
        (item) =>
          item.kind !== "shopping_list" || item.category_id !== source.category_id,
      ))
  ) {
    return c.json({ error: "checkout items must belong to the same shopping plan" }, 400);
  }

  const [category] = source.category_id == null
    ? []
    : await db
        .select()
        .from(plannedExpenseCategories)
        .where(eq(plannedExpenseCategories.id, source.category_id));
  const categoryItems =
    source.kind === "shopping_list" && source.category_id != null
      ? await db
          .select({ id: plannedExpenses.id, status: plannedExpenses.status })
          .from(plannedExpenses)
          .where(eq(plannedExpenses.category_id, source.category_id))
      : [];
  const isRoutineCheckout =
    source.kind === "shopping_list" &&
    category?.shopping_plan_type === "routine" &&
    body.checkout_item_ids != null;
  const shouldArchiveOneTimeShoppingPlan =
    source.kind === "shopping_list" &&
    category?.shopping_plan_type === "one_time" &&
    categoryItems.every(
      (item) => item.status !== "open" || checkoutItemIds.includes(item.id),
    );
  const completion: CompletePlannedExpenseWithJournalResponse["completion"] =
    isRoutineCheckout || shouldArchiveOneTimeShoppingPlan
      ? "shopping_list_archived"
      : source.kind === "scheduled_payment" ||
          checkoutItemIds.some((itemId) => !checkoutKeepItemIds.includes(itemId))
        ? "completed"
        : "none";
  const now = new Date().toISOString();

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO journal_entries (date, description, source)
       VALUES (?, ?, 'manual')`,
    ).bind(journal.date, journal.description),
  ];
  const lineValues = journal.lines.flatMap((line) => [
    line.account_id,
    toStorageMoneyAmount(line.debit ?? 0, line.currency, scaleOptions),
    toStorageMoneyAmount(line.credit ?? 0, line.currency, scaleOptions),
    normalizeCurrency(line.currency),
    line.credit_card_billing_offset_months ?? null,
  ]);
  statements.push(
    c.env.DB.prepare(
      `INSERT INTO journal_lines
        (journal_entry_id, account_id, debit, credit, currency, credit_card_billing_offset_months)
       VALUES ${buildNewJournalEntryRowsSql(journal.lines.length, 5)}`,
    ).bind(...lineValues),
  );

  const budgetCurrency = journalCurrencyFromLines(journal.lines);
  const allocations = (journal.budget_allocations ?? []).filter(
    (allocation) => allocation.budget_category_id && allocation.amount !== 0,
  );
  if (allocations.length > 0) {
    const values = allocations.flatMap((allocation) => [
      allocation.budget_category_id,
      toStorageMoneyAmount(allocation.amount, allocation.currency ?? budgetCurrency, scaleOptions),
      normalizeCurrency(allocation.currency ?? budgetCurrency),
      journal.budget_source ?? null,
    ]);
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO journal_entry_budget_allocations
          (journal_entry_id, budget_category_id, amount, currency, source)
         VALUES ${buildNewJournalEntryRowsSql(allocations.length, 4)}`,
      ).bind(...values),
    );
  }
  const incomeAllocations = (journal.income_budget_allocations ?? []).filter(
    (allocation) => allocation.budget_category_id && allocation.amount !== 0,
  );
  if (incomeAllocations.length > 0) {
    const values = incomeAllocations.flatMap((allocation) => [
      allocation.budget_category_id,
      toStorageMoneyAmount(allocation.amount, allocation.currency ?? budgetCurrency, scaleOptions),
      normalizeCurrency(allocation.currency ?? budgetCurrency),
      journal.date.slice(0, 7),
      journal.date,
      allocation.adjustment_type === "transfer" ? "transfer" : "allocation",
    ]);
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO budget_adjustment_logs
          (journal_entry_id, budget_category_id, amount, currency, year_month, date, adjustment_type)
         VALUES ${buildNewJournalEntryRowsSql(incomeAllocations.length, 6)}`,
      ).bind(...values),
    );
  }

  if (isRoutineCheckout && category) {
    const checkoutDate = validDate(journal.date) ? journal.date : now.slice(0, 10);
    const snapshotName = `${category.name} (${checkoutDate} #${id}-${body.idempotency_key.slice(0, 8)})`;
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO planned_expense_categories
          (kind, name, estimated_amount, currency, default_expense_account_id, target_date, shopping_plan_type, archived_at, created_at, updated_at)
         VALUES ('shopping_list', ?, ?, ?, ?, ?, 'one_time', ?, ?, ?)`,
      ).bind(
        snapshotName,
        category.estimated_amount,
        category.currency,
        category.default_expense_account_id,
        category.target_date ?? checkoutDate,
        now,
        now,
        now,
      ),
    );
    for (const item of checkoutItems) {
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO planned_expenses
            (kind, category_id, name, estimated_amount, currency, status, keep_on_routine_clear, note, created_at, updated_at)
           VALUES ('shopping_list', (SELECT MAX(id) FROM planned_expense_categories), ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          item.name,
          item.estimated_amount,
          item.currency,
          item.status,
          item.keep_on_routine_clear,
          item.note,
          now,
          now,
        ),
      );
    }
    const idsToDelete = checkoutItemIds.filter(
      (itemId) => !checkoutKeepItemIds.includes(itemId),
    );
    if (idsToDelete.length > 0) {
      statements.push(
        c.env.DB.prepare(
          `DELETE FROM planned_expenses WHERE id IN (${placeholders(idsToDelete.length)})`,
        ).bind(...idsToDelete),
      );
    }
    if (checkoutKeepItemIds.length > 0) {
      statements.push(
        c.env.DB.prepare(
          `UPDATE planned_expenses SET status = 'open', updated_at = ? WHERE id IN (${placeholders(checkoutKeepItemIds.length)})`,
        ).bind(now, ...checkoutKeepItemIds),
      );
    }
    statements.push(
      c.env.DB.prepare(
        "UPDATE planned_expense_categories SET last_checked_out_date = ?, updated_at = ? WHERE id = ?",
      ).bind(checkoutDate, now, category.id),
    );
  } else if (source.kind === "scheduled_payment" && source.recurrence_type === "recurring") {
    const nextDueDate = body.next_due_date_after_occurrence;
    const completedDates = normalizeCompletedDates(body.completed_dates);
    if (
      (nextDueDate != null && !validDate(nextDueDate)) ||
      completedDates === "__invalid__" ||
      (body.completion_status_after_occurrence != null &&
        body.completion_status_after_occurrence !== "open" &&
        body.completion_status_after_occurrence !== "completed")
    ) {
      return c.json({ error: "invalid recurring completion data" }, 400);
    }
    statements.push(
      c.env.DB.prepare(
        "UPDATE planned_expenses SET status = ?, next_due_date = ?, completed_dates = ?, updated_at = ? WHERE id = ?",
      ).bind(
        body.completion_status_after_occurrence ??
          (nextDueDate == null ? "completed" : "open"),
        nextDueDate ?? null,
        completedDates ?? null,
        now,
        id,
      ),
    );
  } else {
    const idsToComplete = checkoutItemIds.filter(
      (itemId) => !checkoutKeepItemIds.includes(itemId),
    );
    if (idsToComplete.length > 0) {
      statements.push(
        c.env.DB.prepare(
          `UPDATE planned_expenses SET status = 'completed', updated_at = ? WHERE id IN (${placeholders(idsToComplete.length)})`,
        ).bind(now, ...idsToComplete),
      );
    }
    if (checkoutKeepItemIds.length > 0) {
      statements.push(
        c.env.DB.prepare(
          `UPDATE planned_expenses SET status = 'open', updated_at = ? WHERE id IN (${placeholders(checkoutKeepItemIds.length)})`,
        ).bind(now, ...checkoutKeepItemIds),
      );
    }
    if (shouldArchiveOneTimeShoppingPlan && category) {
      statements.push(
        c.env.DB.prepare(
          "UPDATE planned_expense_categories SET archived_at = ?, updated_at = ? WHERE id = ?",
        ).bind(now, now, category.id),
      );
    }
  }

  statements.push(
    c.env.DB.prepare(
      `INSERT INTO planned_expense_completion_requests
        (idempotency_key, planned_expense_id, journal_entry_id, completion)
       VALUES (?, ?, (SELECT MAX(id) FROM journal_entries), ?)`,
    ).bind(body.idempotency_key, id, completion),
  );

  try {
    await c.env.DB.batch(statements);
  } catch (error) {
    const [existing] = await db
      .select()
      .from(plannedExpenseCompletionRequests)
      .where(eq(plannedExpenseCompletionRequests.idempotency_key, body.idempotency_key));
    if (existing) {
      return c.json({
        journal_entry_id: existing.journal_entry_id,
        completion: existing.completion as CompletePlannedExpenseWithJournalResponse["completion"],
        replayed: true,
      });
    }
    throw error;
  }

  const [request] = await db
    .select()
    .from(plannedExpenseCompletionRequests)
    .where(eq(plannedExpenseCompletionRequests.idempotency_key, body.idempotency_key));
  if (!request) throw new Error("completion request was not recorded");
  return c.json({
    journal_entry_id: request.journal_entry_id,
    completion,
    replayed: false,
  }, 201);
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
  const isShoppingList = existing.kind === "shopping_list";
  const nextCategoryId =
    body.category_id !== undefined ? body.category_id : existing.category_id;
  if (
    !(await validateCategory(
      db,
      nextCategoryId,
      existing.kind as PlannedExpenseKind,
      currency,
    ))
  ) {
    return c.json({ error: "category_id must match kind and currency" }, 400);
  }
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
      currency,
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
