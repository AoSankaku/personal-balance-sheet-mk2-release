import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createDb, type Env } from "../db";
import { enabledCurrencies } from "../db/schema";
import { moneyScale } from "../lib/moneyValidation";

const router = new Hono<{ Bindings: Env }>();

function parseDecimalPlaces(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 0 || value > 9) return null;
  return value;
}

function parseBackgroundColor(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) return undefined;
  return trimmed.toUpperCase();
}

function errorMessageMatches(error: unknown, pattern: RegExp): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();

  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      if (pattern.test(current.message)) return true;
      current = current.cause;
    } else {
      return pattern.test(String(current));
    }
  }

  return false;
}

async function ignoreDuplicateColumn(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    if (!errorMessageMatches(error, /duplicate column|already exists/i)) {
      throw error;
    }
    // Column already exists on fresh schemas; this preserves existing local data.
  }
}

async function ensureEnabledCurrenciesTable(db: ReturnType<typeof createDb>) {
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS enabled_currencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      symbol_priority INTEGER NOT NULL DEFAULT 0,
      custom_symbol TEXT,
      custom_icon TEXT,
      background_color TEXT,
      decimal_places INTEGER NOT NULL DEFAULT 2,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      CONSTRAINT chk_enabled_currencies_decimal_places_range
        CHECK(decimal_places BETWEEN 0 AND 9)
    )
  `);
}

async function ensureEnabledCurrenciesSchema(db: ReturnType<typeof createDb>) {
  await ensureEnabledCurrenciesTable(db);
  await ignoreDuplicateColumn(() =>
    db.run(sql`ALTER TABLE enabled_currencies ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`),
  );
  await ignoreDuplicateColumn(() =>
    db.run(sql`ALTER TABLE enabled_currencies ADD COLUMN symbol_priority INTEGER NOT NULL DEFAULT 0`),
  );
  await ignoreDuplicateColumn(() =>
    db.run(sql`ALTER TABLE enabled_currencies ADD COLUMN custom_symbol TEXT`),
  );
  await ignoreDuplicateColumn(() =>
    db.run(sql`ALTER TABLE enabled_currencies ADD COLUMN custom_icon TEXT`),
  );
  await ignoreDuplicateColumn(() =>
    db.run(sql`ALTER TABLE enabled_currencies ADD COLUMN decimal_places INTEGER NOT NULL DEFAULT 2`),
  );
}

// GET /api/currencies — list all enabled currencies ordered by sort_order
router.get("/", async (c) => {
  const db = createDb(c.env);
  await ensureEnabledCurrenciesSchema(db);
  const rows = await db
    .select()
    .from(enabledCurrencies)
    .orderBy(enabledCurrencies.sort_order, enabledCurrencies.code);
  return c.json(rows);
});

// POST /api/currencies — enable or disable a currency
// Body: { code: string, enabled: boolean, custom_symbol?: string, custom_icon?: string }
// At least one currency must remain enabled at all times.
router.post("/", async (c) => {
  const body = await c.req.json<{
    code: string;
    enabled: boolean;
    custom_symbol?: string;
    custom_icon?: string;
    background_color?: string | null;
    decimal_places?: number;
  }>();
  if (!body.code) return c.json({ error: "code is required" }, 400);
  if (
    body.decimal_places !== undefined &&
    parseDecimalPlaces(body.decimal_places) === null
  ) {
    return c.json({ error: "decimal_places must be an integer from 0 to 9" }, 400);
  }
  const requestedBackgroundColor = parseBackgroundColor(body.background_color);
  if (body.background_color !== undefined && requestedBackgroundColor === undefined) {
    return c.json({ error: "background_color must be a #RRGGBB color" }, 400);
  }

  const code = body.code.toUpperCase();
  const requestedDecimalPlaces = parseDecimalPlaces(body.decimal_places);

  const db = createDb(c.env);
  await ensureEnabledCurrenciesSchema(db);

  if (!body.enabled) {
    const remaining = await db
      .select({ id: enabledCurrencies.id })
      .from(enabledCurrencies);
    if (remaining.length <= 1) {
      return c.json({ error: "at_least_one_required" }, 400);
    }
  }

  if (body.enabled) {
    const existing = await db
      .select({ id: enabledCurrencies.id })
      .from(enabledCurrencies)
      .where(eq(enabledCurrencies.code, code));

    const customSymbol = body.custom_symbol?.trim() || null;
    const customIcon = body.custom_icon?.trim() || null;

    if (existing.length === 0) {
      const maxOrderRows = await db
        .select({ max: enabledCurrencies.sort_order })
        .from(enabledCurrencies);
      const maxOrder = maxOrderRows[0]?.max ?? 0;
      await db.insert(enabledCurrencies).values({
        code,
        sort_order: maxOrder + 1,
        custom_symbol: customSymbol,
        custom_icon: customIcon,
        background_color: requestedBackgroundColor ?? null,
        decimal_places: requestedDecimalPlaces ?? moneyScale(code),
      });
    } else if (
      customSymbol !== null ||
      customIcon !== null ||
      requestedBackgroundColor !== undefined ||
      requestedDecimalPlaces !== null
    ) {
      await db
        .update(enabledCurrencies)
        .set({
          ...(customSymbol !== null ? { custom_symbol: customSymbol } : {}),
          ...(customIcon !== null ? { custom_icon: customIcon } : {}),
          ...(requestedBackgroundColor !== undefined
            ? { background_color: requestedBackgroundColor }
            : {}),
          ...(requestedDecimalPlaces !== null
            ? { decimal_places: requestedDecimalPlaces }
            : {}),
        })
        .where(eq(enabledCurrencies.code, code));
    }
  } else {
    await db.delete(enabledCurrencies).where(eq(enabledCurrencies.code, code));
  }

  const rows = await db
    .select()
    .from(enabledCurrencies)
    .orderBy(enabledCurrencies.sort_order, enabledCurrencies.code);
  return c.json(rows);
});

// PATCH /api/currencies/:code — update symbol_priority
// Body: { symbol_priority: number }
router.patch("/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const body = await c.req.json<{
    symbol_priority?: number;
    decimal_places?: number;
    background_color?: string | null;
  }>();

  if (
    body.symbol_priority !== undefined &&
    typeof body.symbol_priority !== "number"
  ) {
    return c.json({ error: "symbol_priority must be a number" }, 400);
  }
  if (
    body.decimal_places !== undefined &&
    parseDecimalPlaces(body.decimal_places) === null
  ) {
    return c.json({ error: "decimal_places must be an integer from 0 to 9" }, 400);
  }
  const requestedBackgroundColor = parseBackgroundColor(body.background_color);
  if (body.background_color !== undefined && requestedBackgroundColor === undefined) {
    return c.json({ error: "background_color must be a #RRGGBB color" }, 400);
  }

  const updates: Partial<typeof enabledCurrencies.$inferInsert> = {};
  if (body.symbol_priority !== undefined) {
    updates.symbol_priority = body.symbol_priority;
  }
  if (body.decimal_places !== undefined) {
    updates.decimal_places = body.decimal_places;
  }
  if (body.background_color !== undefined) {
    updates.background_color = requestedBackgroundColor;
  }
  if (Object.keys(updates).length === 0) {
    return c.json({ error: "no updates provided" }, 400);
  }

  const db = createDb(c.env);
  await ensureEnabledCurrenciesSchema(db);
  await db
    .update(enabledCurrencies)
    .set(updates)
    .where(eq(enabledCurrencies.code, code));

  const rows = await db
    .select()
    .from(enabledCurrencies)
    .orderBy(enabledCurrencies.sort_order, enabledCurrencies.code);
  return c.json(rows);
});

// POST /api/currencies/reorder - update enabled currency order
// Body: { codes: string[] }
router.post("/reorder", async (c) => {
  const body = await c.req.json<{ codes: string[] }>();
  const codes = body.codes?.map((code) => code.toUpperCase()) ?? [];
  if (codes.length === 0) return c.json({ error: "codes is required" }, 400);

  const db = createDb(c.env);
  await ensureEnabledCurrenciesSchema(db);
  const existing = await db
    .select({ code: enabledCurrencies.code })
    .from(enabledCurrencies);

  const existingCodes = existing.map((row) => row.code).sort();
  const requestedCodes = [...codes].sort();
  const hasSameCodes =
    existingCodes.length === requestedCodes.length &&
    existingCodes.every((code, index) => code === requestedCodes[index]);

  if (!hasSameCodes) {
    return c.json({ error: "codes must match enabled currencies" }, 400);
  }

  await Promise.all(
    codes.map((code, index) =>
      db
        .update(enabledCurrencies)
        .set({ sort_order: index })
        .where(eq(enabledCurrencies.code, code)),
    ),
  );

  const rows = await db
    .select()
    .from(enabledCurrencies)
    .orderBy(enabledCurrencies.sort_order, enabledCurrencies.code);
  return c.json(rows);
});

export { router as currenciesRouter };
