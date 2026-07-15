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
  actualBalanceEntries,
  actualBalanceSnapshots,
  creditCardSettings,
  journalEntries,
  journalLines,
} from "../db/schema";
import {
  findInvalidMoneyField,
  invalidMoneyResponse,
} from "../lib/moneyValidation";

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
      amount: row.amount,
      book_value:
        generalBookValueMap.get(`${row.snapshot_id}:${row.account_id}`) ?? 0,
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
    general_entries?: { account_id: number; amount: number }[];
  }>();

  if (!body.snapshot_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.snapshot_date)) {
    return c.json({ error: "snapshot_date is required (YYYY-MM-DD)" }, 400);
  }

  const generalEntries = body.general_entries ?? [];

  const invalidMoneyField = findInvalidMoneyField(
    generalEntries.map((entry, index) => ({
      path: `general_entries[${index}].amount`,
      value: entry.amount,
    })),
  );
  if (invalidMoneyField) {
    return c.json(invalidMoneyResponse(invalidMoneyField), 400);
  }

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
  const accountIds = [...new Set(generalEntries.map((e) => e.account_id))];

  const accountRows =
    accountIds.length > 0
      ? await db
          .select({ id: accounts.id, category: accounts.category })
          .from(accounts)
          .where(sql`${accounts.id} IN (${sql.raw(accountIds.join(","))})`)
      : [];
  const accountMap = new Map(accountRows.map((row) => [row.id, row]));

  for (const entry of generalEntries) {
    const account = accountMap.get(entry.account_id);
    if (!account || account.category === "credit_card") {
      return c.json(
        { error: "general_entries must reference non-credit-card accounts" },
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
    generalEntries.map((entry) => ({
      snapshot_id: snapshot.id,
      account_id: entry.account_id,
      amount: entry.amount,
    })),
  );

  const [hydrated] = await hydrateSnapshots(db, [snapshot]);
  return c.json(hydrated, 201);
});

router.delete("/snapshots/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const db = createDb(c.env);
  await db
    .delete(actualBalanceEntries)
    .where(eq(actualBalanceEntries.snapshot_id, id));
  const deleted = await db
    .delete(actualBalanceSnapshots)
    .where(eq(actualBalanceSnapshots.id, id))
    .returning();

  if (deleted.length === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

export { router as trialBalanceRouter };
export { deriveCreditCardStatus };
