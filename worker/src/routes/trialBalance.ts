import { and, desc, eq, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  deriveCreditCardStatus,
  type UpsertCreditCardStateInput,
} from "@balance-sheet/shared";
import { createDb, type Env } from "../db";
import {
  accounts,
  actualBalanceCreditCardState,
  actualBalanceAdjustments,
  actualBalanceEntries,
  actualBalanceSnapshots,
  creditCardSettings,
  journalEntries,
  journalLines,
} from "../db/schema";
import {
  findInvalidMoneyField,
  fromStorageMoneyAmount,
  invalidMoneyResponse,
  moneyScale,
  normalizeMoneyCurrency,
  toStorageMoneyAmount,
} from "../lib/moneyValidation";
import {
  decodeActualBalanceAmount,
  prepareActualBalanceEntry,
} from "../lib/actualBalanceAmounts";
import { buildActualBalanceAdjustmentRefreshStatements } from "../lib/actualBalanceAdjustments";
import { loadCurrencyDecimalPlaces } from "../lib/currencyPrecision";
import { buildJournalHistoryStatements } from "../lib/journalHistory";

const router = new Hono<{ Bindings: Env }>();

router.get("/latest-snapshot", async (c) => {
  const db = createDb(c.env);
  const [latest] = await db
    .select({ snapshot_date: actualBalanceSnapshots.snapshot_date })
    .from(actualBalanceSnapshots)
    .orderBy(
      desc(actualBalanceSnapshots.snapshot_date),
      desc(actualBalanceSnapshots.snapshot_time),
    )
    .limit(1);

  return c.json({ snapshot_date: latest?.snapshot_date ?? null });
});

async function hydrateSnapshots(
  db: ReturnType<typeof createDb>,
  snapshots: (typeof actualBalanceSnapshots.$inferSelect)[],
) {
  if (snapshots.length === 0) return [];
  const decimalPlacesByCurrency = await loadCurrencyDecimalPlaces(db);

  const snapshotIds = snapshots.map((snapshot) => snapshot.id);
  const snapshotDateMap = new Map(
    snapshots.map((snapshot) => [snapshot.id, snapshot.snapshot_date]),
  );

  const generalRows = await db
    .select({
      id: actualBalanceEntries.id,
      snapshot_id: actualBalanceEntries.snapshot_id,
      account_id: actualBalanceEntries.account_id,
      account_name: accounts.name,
      account_type: accounts.type,
      account_category: accounts.category,
      amount: actualBalanceEntries.amount,
      money_scale: actualBalanceEntries.money_scale,
      currency: actualBalanceEntries.currency,
    })
    .from(actualBalanceEntries)
    .innerJoin(accounts, eq(actualBalanceEntries.account_id, accounts.id))
    .where(
      sql`${actualBalanceEntries.snapshot_id} IN (${sql.raw(snapshotIds.join(","))})`,
    );

  const generalBookValueMap = new Map<string, number>();
  for (const row of generalRows) {
    const key = `${row.snapshot_id}:${row.account_id}`;
    if (generalBookValueMap.has(key)) continue;

    const snapshotDate = snapshotDateMap.get(row.snapshot_id);
    if (!snapshotDate) continue;

    const isDebitNormal =
      row.account_type === "asset" || row.account_type === "expense";
    const [bookRow] = await db
      .select({
        val: isDebitNormal
          ? sql<number>`COALESCE(SUM(${journalLines.debit}) - SUM(${journalLines.credit}), 0)`
          : sql<number>`COALESCE(SUM(${journalLines.credit}) - SUM(${journalLines.debit}), 0)`,
      })
      .from(journalLines)
      .innerJoin(
        journalEntries,
        eq(journalLines.journal_entry_id, journalEntries.id),
      )
      .where(
        and(
          eq(journalLines.account_id, row.account_id),
          eq(journalLines.currency, row.currency),
          lte(journalEntries.date, snapshotDate),
        ),
      );

    generalBookValueMap.set(key, bookRow?.val ?? 0);
  }

  const snapshotMap = new Map(
    snapshots.map((snapshot) => [
      snapshot.id,
      {
        ...snapshot,
        general_entries: [] as {
          id: number;
          snapshot_id: number;
          account_id: number;
          account_name: string;
          amount: number;
          currency: string;
          book_value: number;
        }[],
      },
    ]),
  );

  for (const row of generalRows) {
    const snapshot = snapshotMap.get(row.snapshot_id);
    if (!snapshot) continue;

    if (row.account_category === "credit_card") continue;

    snapshot.general_entries.push({
      id: row.id,
      snapshot_id: row.snapshot_id,
      account_id: row.account_id,
      account_name: row.account_name,
      amount: decodeActualBalanceAmount(
        row.amount,
        row.currency,
        row.money_scale,
      ),
      currency: row.currency,
      book_value:
        decodeActualBalanceAmount(
          generalBookValueMap.get(`${row.snapshot_id}:${row.account_id}`) ?? 0,
          row.currency,
          decimalPlacesByCurrency[row.currency.toUpperCase()],
        ),
    });
  }

  return snapshots.map((snapshot) => snapshotMap.get(snapshot.id)!);
}

// ── Credit-card state (standalone table) ──────────────────────

router.get("/credit-card-state", async (c) => {
  const db = createDb(c.env);
  const rows = await db
    .select({
      id: actualBalanceCreditCardState.id,
      account_id: actualBalanceCreditCardState.account_id,
      account_name: accounts.name,
      payment_month: actualBalanceCreditCardState.payment_month,
      status: actualBalanceCreditCardState.status,
      amount: actualBalanceCreditCardState.amount,
      last_updated_at: actualBalanceCreditCardState.last_updated_at,
    })
    .from(actualBalanceCreditCardState)
    .innerJoin(
      accounts,
      eq(actualBalanceCreditCardState.account_id, accounts.id),
    );

  return c.json(rows);
});

router.post("/credit-card-state", async (c) => {
  const body = await c.req.json<{
    entries: {
      account_id: number;
      payment_month: string;
      amount: number;
      status: "open" | "confirmed" | "paid";
    }[];
  }>();

  const entries = body.entries ?? [];

  const invalidMoneyField = findInvalidMoneyField(
    entries.map((entry, index) => ({
      path: `entries[${index}].amount`,
      value: entry.amount,
    })),
  );
  if (invalidMoneyField) {
    return c.json(invalidMoneyResponse(invalidMoneyField), 400);
  }

  for (const entry of entries) {
    if (!/^\d{4}-\d{2}$/.test(entry.payment_month)) {
      return c.json({ error: "payment_month must be YYYY-MM" }, 400);
    }
    if (!["open", "confirmed", "paid"].includes(entry.status)) {
      return c.json({ error: "status must be open, confirmed, or paid" }, 400);
    }
  }

  const db = createDb(c.env);

  // For each account_id present in the input, delete all existing state rows
  // then insert the new ones. This allows row deletions to propagate.
  const accountIds = [...new Set(entries.map((e) => e.account_id))];
  if (accountIds.length > 0) {
    await db
      .delete(actualBalanceCreditCardState)
      .where(
        sql`${actualBalanceCreditCardState.account_id} IN (${sql.raw(accountIds.join(","))})`,
      );
  }

  if (entries.length > 0) {
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const rows = entries.map((e) => ({
      account_id: e.account_id,
      payment_month: e.payment_month,
      status: e.status,
      amount: e.amount,
      last_updated_at: now,
    }));
    // D1 has SQLITE_LIMIT_VARIABLE_NUMBER = 100; each row uses 5 columns → max 20 rows per batch
    const CHUNK = 20;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db
        .insert(actualBalanceCreditCardState)
        .values(rows.slice(i, i + CHUNK));
    }
  }

  const rows = await db
    .select({
      id: actualBalanceCreditCardState.id,
      account_id: actualBalanceCreditCardState.account_id,
      account_name: accounts.name,
      payment_month: actualBalanceCreditCardState.payment_month,
      status: actualBalanceCreditCardState.status,
      amount: actualBalanceCreditCardState.amount,
      last_updated_at: actualBalanceCreditCardState.last_updated_at,
    })
    .from(actualBalanceCreditCardState)
    .innerJoin(
      accounts,
      eq(actualBalanceCreditCardState.account_id, accounts.id),
    )
    .where(
      accountIds.length > 0
        ? sql`${actualBalanceCreditCardState.account_id} IN (${sql.raw(accountIds.join(","))})`
        : sql`1 = 0`,
    );

  return c.json(rows, 201);
});

router.patch("/credit-card-state", async (c) => {
  const body = await c.req.json<UpsertCreditCardStateInput>();
  const invalidMoneyField = findInvalidMoneyField([
    { path: "amount", value: body.amount },
  ]);
  if (invalidMoneyField) {
    return c.json(invalidMoneyResponse(invalidMoneyField), 400);
  }
  if (
    !Number.isInteger(body.account_id) ||
    body.account_id <= 0 ||
    !/^\d{4}-\d{2}$/.test(body.payment_month ?? "") ||
    !["open", "confirmed", "paid"].includes(body.status)
  ) {
    return c.json({ error: "Invalid credit-card state" }, 400);
  }

  const db = createDb(c.env);
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  await db
    .insert(actualBalanceCreditCardState)
    .values({
      account_id: body.account_id,
      payment_month: body.payment_month,
      amount: body.amount,
      status: body.status,
      last_updated_at: now,
    })
    .onConflictDoUpdate({
      target: [
        actualBalanceCreditCardState.account_id,
        actualBalanceCreditCardState.payment_month,
      ],
      set: {
        amount: body.amount,
        status: body.status,
        last_updated_at: now,
      },
    });

  const [row] = await db
    .select({
      id: actualBalanceCreditCardState.id,
      account_id: actualBalanceCreditCardState.account_id,
      account_name: accounts.name,
      payment_month: actualBalanceCreditCardState.payment_month,
      status: actualBalanceCreditCardState.status,
      amount: actualBalanceCreditCardState.amount,
      last_updated_at: actualBalanceCreditCardState.last_updated_at,
    })
    .from(actualBalanceCreditCardState)
    .innerJoin(
      accounts,
      eq(actualBalanceCreditCardState.account_id, accounts.id),
    )
    .where(
      and(
        eq(actualBalanceCreditCardState.account_id, body.account_id),
        eq(actualBalanceCreditCardState.payment_month, body.payment_month),
      ),
    )
    .limit(1);
  if (!row) return c.json({ error: "Failed to save credit-card state" }, 500);
  return c.json(row);
});

// ── Snapshots (general entries only) ─────────────────────────

router.get("/snapshots", async (c) => {
  const db = createDb(c.env);
  const snapshots = await db
    .select()
    .from(actualBalanceSnapshots)
    .orderBy(
      desc(actualBalanceSnapshots.snapshot_date),
      desc(actualBalanceSnapshots.snapshot_time),
    );

  return c.json(await hydrateSnapshots(db, snapshots));
});

router.post("/snapshots", async (c) => {
  const body = await c.req.json<{
    snapshot_date: string;
    snapshot_time?: string;
    general_entries?: {
      account_id: number;
      amount: number;
      currency?: string;
    }[];
  }>();

  if (!body.snapshot_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.snapshot_date)) {
    return c.json({ error: "snapshot_date is required (YYYY-MM-DD)" }, 400);
  }

  const generalEntries = body.general_entries ?? [];

  if (generalEntries.length === 0) {
    return c.json(
      { error: "general_entries is required and must not be empty" },
      400,
    );
  }

  const seenGeneral = new Set<number>();
  for (const entry of generalEntries) {
    if (seenGeneral.has(entry.account_id)) {
      return c.json({ error: "Duplicate general account_id" }, 400);
    }
    seenGeneral.add(entry.account_id);
  }

  const db = createDb(c.env);
  const decimalPlacesByCurrency = await loadCurrencyDecimalPlaces(db);
  const invalidMoneyField = findInvalidMoneyField(
    generalEntries.map((entry, index) => {
      const currency = normalizeMoneyCurrency(entry.currency);
      return {
        path: `general_entries[${index}].amount`,
        value: entry.amount,
        currency,
        decimalPlaces: decimalPlacesByCurrency[currency],
      };
    }),
  );
  if (invalidMoneyField) {
    return c.json(invalidMoneyResponse(invalidMoneyField), 400);
  }

  const accountIds = [...new Set(generalEntries.map((e) => e.account_id))];

  const accountRows =
    accountIds.length > 0
      ? await db
          .select({
            id: accounts.id,
            type: accounts.type,
            category: accounts.category,
            is_system: accounts.is_system,
          })
          .from(accounts)
          .where(sql`${accounts.id} IN (${sql.raw(accountIds.join(","))})`)
      : [];
  const accountMap = new Map(accountRows.map((row) => [row.id, row]));

  for (const entry of generalEntries) {
    const account = accountMap.get(entry.account_id);
    if (
      !account ||
      account.is_system !== 0 ||
      (account.type !== "asset" && account.type !== "liability") ||
      account.category === "credit_card"
    ) {
      return c.json(
        {
          error:
            "general_entries must reference non-system asset or liability accounts",
        },
        400,
      );
    }
  }

  const [snapshot] = await db
    .insert(actualBalanceSnapshots)
    .values({
      snapshot_date: body.snapshot_date,
      snapshot_time: body.snapshot_time ?? null,
    })
    .returning();

  if (!snapshot) return c.json({ error: "Failed to create snapshot" }, 500);

  await db.insert(actualBalanceEntries).values(
    generalEntries.map((entry) =>
      prepareActualBalanceEntry(snapshot.id, entry, { decimalPlacesByCurrency }),
    ),
  );

  const [hydrated] = await hydrateSnapshots(db, [snapshot]);
  return c.json(hydrated, 201);
});

router.post("/snapshots/:id/adjustments", async (c) => {
  const snapshotId = Number(c.req.param("id"));
  if (!Number.isInteger(snapshotId) || snapshotId <= 0) {
    return c.json({ error: "Invalid id" }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return c.json({ error: "Invalid request body" }, 400);
  }
  const entries = (body as { entries?: unknown }).entries;
  if (entries !== undefined && !Array.isArray(entries)) {
    return c.json({ error: "entries must be an array" }, 400);
  }
  const requested = (entries as unknown[] | undefined)?.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { account_id: Number.NaN, currency: "" };
    }
    const candidate = entry as { account_id?: unknown; currency?: unknown };
    return {
      account_id:
        typeof candidate.account_id === "number"
          ? candidate.account_id
          : Number.NaN,
      currency:
        typeof candidate.currency === "string" && candidate.currency.trim()
          ? normalizeMoneyCurrency(candidate.currency)
          : "",
    };
  });
  if (
    requested?.some(
      (entry) =>
        !Number.isInteger(entry.account_id) ||
        entry.account_id <= 0 ||
        typeof entry.currency !== "string" ||
        entry.currency.length === 0,
    )
  ) {
    return c.json({ error: "entries must contain account_id and currency" }, 400);
  }
  if (requested && requested.length === 0) {
    return c.json({ error: "entries must not be empty" }, 400);
  }
  const requestedKeys = new Set(
    (requested ?? []).map((entry) => `${entry.account_id}:${entry.currency}`),
  );
  if (requested && requestedKeys.size !== requested.length) {
    return c.json({ error: "Duplicate entries" }, 400);
  }

  const db = createDb(c.env);
  const [snapshot] = await db
    .select({ id: actualBalanceSnapshots.id, date: actualBalanceSnapshots.snapshot_date })
    .from(actualBalanceSnapshots)
    .where(eq(actualBalanceSnapshots.id, snapshotId))
    .limit(1);
  if (!snapshot) return c.json({ error: "Not found" }, 404);

  const savedEntries = await db
    .select({
      id: actualBalanceEntries.id,
      account_id: actualBalanceEntries.account_id,
      amount: actualBalanceEntries.amount,
      money_scale: actualBalanceEntries.money_scale,
      currency: actualBalanceEntries.currency,
      account_name: accounts.name,
      account_type: accounts.type,
      account_category: accounts.category,
      is_system: accounts.is_system,
    })
    .from(actualBalanceEntries)
    .innerJoin(accounts, eq(actualBalanceEntries.account_id, accounts.id))
    .where(eq(actualBalanceEntries.snapshot_id, snapshotId));
  const selectedEntries = requested
    ? savedEntries.filter((entry) =>
        requestedKeys.has(`${entry.account_id}:${entry.currency}`),
      )
    : savedEntries;
  if (requested && selectedEntries.length !== requested.length) {
    return c.json({ error: "entries must match saved general snapshot entries" }, 400);
  }
  if (selectedEntries.length === 0) {
    return c.json({ error: "Snapshot has no general entries" }, 400);
  }
  if (
    selectedEntries.some(
      (entry) =>
        entry.is_system !== 0 ||
        (entry.account_type !== "asset" && entry.account_type !== "liability") ||
        entry.account_category === "credit_card",
    )
  ) {
    return c.json(
      {
        error:
          "Snapshot adjustments require non-system asset or liability accounts",
      },
      400,
    );
  }

  const decimalPlacesByCurrency = await loadCurrencyDecimalPlaces(db);
  for (const entry of selectedEntries) {
    const sourceScale = entry.money_scale ?? moneyScale(entry.currency);
    const targetScale = moneyScale(entry.currency, { decimalPlacesByCurrency });
    try {
      const amount = fromStorageMoneyAmount(entry.amount, entry.currency, {
        decimalPlaces: sourceScale,
      });
      toStorageMoneyAmount(amount, entry.currency, {
        decimalPlaces: targetScale,
      });
    } catch {
      return c.json(
        { error: "snapshot_amount_not_representable_at_current_precision" },
        409,
      );
    }
  }

  const [unknownFunds] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.name, "__system:unknown_funds__"))
    .limit(1);
  if (!unknownFunds) {
    return c.json({ error: "Unknown funds system account is unavailable" }, 500);
  }

  const statements: D1PreparedStatement[] = [];
  for (const entry of selectedEntries) {
    // The unique operation marker is only used inside this atomic batch. It
    // lets later statements refer to the inserted header without MAX(id),
    // while the unique actual_balance_entry_id link makes retries no-ops.
    const marker = `__actual_balance_adjustment__:${entry.id}:${crypto.randomUUID()}`;
    const description = `Actual balance adjustment - ${entry.account_name} (${snapshot.date})`;
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO journal_entries (date, description, source)
         SELECT ?, ?, 'manual'
         WHERE NOT EXISTS (
           SELECT 1 FROM actual_balance_adjustments
           WHERE actual_balance_entry_id = ?
         )`,
      ).bind(snapshot.date, marker, entry.id),
      c.env.DB.prepare(
        `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, currency)
         SELECT journal.id, ?, 0, 0, ?
         FROM journal_entries AS journal
         WHERE journal.description = ?
           AND NOT EXISTS (
             SELECT 1 FROM actual_balance_adjustments
             WHERE actual_balance_entry_id = ?
           )`,
      ).bind(entry.account_id, entry.currency, marker, entry.id),
      c.env.DB.prepare(
        `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, currency)
         SELECT journal.id, ?, 0, 0, ?
         FROM journal_entries AS journal
         WHERE journal.description = ?
           AND NOT EXISTS (
             SELECT 1 FROM actual_balance_adjustments
             WHERE actual_balance_entry_id = ?
           )
           AND (SELECT COUNT(*) FROM journal_lines WHERE journal_entry_id = journal.id) = 1`,
      ).bind(unknownFunds.id, entry.currency, marker, entry.id),
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO actual_balance_adjustments
           (actual_balance_entry_id, journal_entry_id, amount, is_resolved, default_money_scale)
         SELECT ?, journal.id, 0, 0, ?
         FROM journal_entries AS journal
         WHERE journal.description = ?
           AND (SELECT COUNT(*) FROM journal_lines WHERE journal_entry_id = journal.id) = 2`,
      ).bind(entry.id, moneyScale(entry.currency), marker),
      c.env.DB.prepare(
        "UPDATE journal_entries SET description = ? WHERE description = ?",
      ).bind(description, marker),
    );
  }

  await c.env.DB.batch([
    ...statements,
    ...buildActualBalanceAdjustmentRefreshStatements(c.env.DB),
  ]);
  return c.json({ ok: true, adjusted_entries: selectedEntries.length });
});

router.post("/unknown-funds/:entryId/resolve", async (c) => {
  const entryId = Number(c.req.param("entryId"));
  if (!Number.isInteger(entryId) || entryId <= 0) {
    return c.json({ error: "Invalid id" }, 400);
  }

  const db = createDb(c.env);
  const [entry] = await db
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(eq(journalEntries.id, entryId))
    .limit(1);
  if (!entry) return c.json({ error: "Not found" }, 404);

  const systemAccounts = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(
      sql`${accounts.name} IN ('__system:unknown_funds__', '__system:misc_expense__', '__system:misc_income__')`,
    );
  const idByName = new Map(systemAccounts.map((account) => [account.name, account.id]));
  const unknownId = idByName.get("__system:unknown_funds__");
  const miscExpenseId = idByName.get("__system:misc_expense__");
  const miscIncomeId = idByName.get("__system:misc_income__");
  if (!unknownId || !miscExpenseId || !miscIncomeId) {
    return c.json({ error: "Unknown funds system accounts are unavailable" }, 500);
  }

  const unknownLines = await db
    .select({ id: journalLines.id })
    .from(journalLines)
    .where(
      and(
        eq(journalLines.journal_entry_id, entryId),
        eq(journalLines.account_id, unknownId),
      ),
    );
  if (unknownLines.length === 0) {
    return c.json({ ok: true, is_resolved: true });
  }

  await c.env.DB.batch([
    ...buildJournalHistoryStatements(c.env.DB, [entryId], "edited"),
    c.env.DB.prepare(
      `UPDATE journal_lines
       SET account_id = CASE WHEN debit > 0 THEN ? ELSE ? END
       WHERE journal_entry_id = ? AND account_id = ?`,
    ).bind(miscExpenseId, miscIncomeId, entryId, unknownId),
    c.env.DB.prepare(
      `UPDATE actual_balance_adjustments
       SET is_resolved = 1
       WHERE journal_entry_id = ?`,
    ).bind(entryId),
    ...buildActualBalanceAdjustmentRefreshStatements(c.env.DB),
  ]);

  return c.json({ ok: true, is_resolved: true });
});

router.delete("/snapshots/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Invalid id" }, 400);

  const db = createDb(c.env);
  const [snapshot] = await db
    .select({ id: actualBalanceSnapshots.id })
    .from(actualBalanceSnapshots)
    .where(eq(actualBalanceSnapshots.id, id))
    .limit(1);
  if (!snapshot) return c.json({ error: "Not found" }, 404);

  const adjustmentJournalEntries = await db
    .selectDistinct({ journal_entry_id: actualBalanceAdjustments.journal_entry_id })
    .from(actualBalanceAdjustments)
    .innerJoin(actualBalanceEntries, eq(actualBalanceAdjustments.actual_balance_entry_id, actualBalanceEntries.id))
    .where(eq(actualBalanceEntries.snapshot_id, id));

  await c.env.DB.batch([
    ...buildJournalHistoryStatements(
      c.env.DB,
      adjustmentJournalEntries.map((entry) => entry.journal_entry_id),
      "deleted",
    ),
    c.env.DB.prepare(
      `DELETE FROM journal_entries
       WHERE id IN (
         SELECT adjustment.journal_entry_id
         FROM actual_balance_adjustments AS adjustment
         JOIN actual_balance_entries AS entry
           ON entry.id = adjustment.actual_balance_entry_id
         WHERE entry.snapshot_id = ?
       )`,
    ).bind(id),
    c.env.DB.prepare("DELETE FROM actual_balance_snapshots WHERE id = ?").bind(id),
    ...buildActualBalanceAdjustmentRefreshStatements(c.env.DB),
  ]);
  return c.json({ ok: true });
});

export { router as trialBalanceRouter };
export { deriveCreditCardStatus };
