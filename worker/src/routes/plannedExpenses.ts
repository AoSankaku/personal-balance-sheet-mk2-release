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
  type PlannedExpenseRecurrenceType,
  type PlannedExpenseStatus,
  type ProductAvailabilityStatus,
  type ProductMetadata,
  type ProductMetadataLookupInput,
  type ProductSourceSite,
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

function normalizePriority(value: number | undefined): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 5
    ? value
    : 3;
}

function normalizeSortOrder(value: number | undefined): number {
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
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
    recurrence_interval_months: row.recurrence_interval_months ?? null,
    recurrence_day: row.recurrence_day ?? null,
    next_due_date: row.next_due_date ?? null,
    end_date: row.end_date ?? null,
    priority: row.priority,
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
      recurrence_interval_months: plannedExpenses.recurrence_interval_months,
      recurrence_day: plannedExpenses.recurrence_day,
      next_due_date: plannedExpenses.next_due_date,
      end_date: plannedExpenses.end_date,
      priority: plannedExpenses.priority,
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
      recurrence_interval_months: plannedExpenses.recurrence_interval_months,
      recurrence_day: plannedExpenses.recurrence_day,
      next_due_date: plannedExpenses.next_due_date,
      end_date: plannedExpenses.end_date,
      priority: plannedExpenses.priority,
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
              desc(plannedExpenses.priority),
              desc(plannedExpenses.created_at),
            )
        : await baseQuery.orderBy(
            asc(plannedExpenses.status),
            asc(plannedExpenses.target_date),
            desc(plannedExpenses.priority),
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
  const nextDueDate = normalizeOptionalDate(body.next_due_date);
  if (nextDueDate === "__invalid__") {
    return c.json({ error: "next_due_date must be YYYY-MM-DD" }, 400);
  }
  const endDate = normalizeOptionalDate(body.end_date);
  if (endDate === "__invalid__") {
    return c.json({ error: "end_date must be YYYY-MM-DD" }, 400);
  }
  const recurrenceInterval =
    body.recurrence_interval_months == null
      ? null
      : body.recurrence_interval_months;
  if (
    recurrenceInterval != null &&
    (!Number.isInteger(recurrenceInterval) || recurrenceInterval <= 0)
  ) {
    return c.json(
      { error: "recurrence_interval_months must be a positive integer" },
      400,
    );
  }
  const recurrenceDay = body.recurrence_day == null ? null : body.recurrence_day;
  if (
    recurrenceDay != null &&
    (!Number.isInteger(recurrenceDay) || recurrenceDay < 1 || recurrenceDay > 31)
  ) {
    return c.json({ error: "recurrence_day must be 1-31" }, 400);
  }
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
      recurrence_interval_months:
        recurrenceType === "recurring" ? (recurrenceInterval ?? 1) : null,
      recurrence_day: recurrenceType === "recurring" ? recurrenceDay : null,
      next_due_date: recurrenceType === "recurring" ? nextDueDate : null,
      end_date: recurrenceType === "recurring" ? endDate : null,
      priority: isShoppingList ? 3 : normalizePriority(body.priority),
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
    body.recurrence_day !== undefined &&
    body.recurrence_day !== null &&
    (!Number.isInteger(body.recurrence_day) ||
      body.recurrence_day < 1 ||
      body.recurrence_day > 31)
  ) {
    return c.json({ error: "recurrence_day must be 1-31" }, 400);
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
      updates.recurrence_interval_months = null;
      updates.recurrence_day = null;
      updates.next_due_date = null;
      updates.end_date = null;
    }
  }
  if (body.recurrence_interval_months !== undefined) {
    updates.recurrence_interval_months = body.recurrence_interval_months;
  }
  if (body.recurrence_day !== undefined) {
    updates.recurrence_day = body.recurrence_day;
  }
  if (body.next_due_date !== undefined) {
    const nextDueDate = normalizeOptionalDate(body.next_due_date);
    if (nextDueDate === "__invalid__") {
      return c.json({ error: "next_due_date must be YYYY-MM-DD" }, 400);
    }
    updates.next_due_date = nextDueDate;
  }
  if (body.end_date !== undefined) {
    const endDate = normalizeOptionalDate(body.end_date);
    if (endDate === "__invalid__") {
      return c.json({ error: "end_date must be YYYY-MM-DD" }, 400);
    }
    updates.end_date = endDate;
  }
  if (body.priority !== undefined) {
    updates.priority = normalizePriority(body.priority);
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
