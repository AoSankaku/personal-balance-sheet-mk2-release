import { eq, inArray, sql, and, ne } from "drizzle-orm";
import { Hono } from "hono";
import { createDb, type Env } from "../db";
import {
  accounts,
  journalLines,
  cryptoWallets,
  budgetCategoryAccounts,
  budgetCategories,
  accountCompletions,
} from "../db/schema";
import type { AccountBudgetRatio } from "@balance-sheet/shared";
import { loadCurrencyDecimalPlaces } from "../lib/currencyPrecision";
import { fromStorageMoneyAmount } from "../lib/moneyValidation";

const router = new Hono<{ Bindings: Env }>();

// GET /api/accounts[?as_of=YYYY-MM-DD] — list all accounts with computed balances
// Balance sign: debit-normal types (asset, expense)               → SUM(debit)-SUM(credit)
//               credit-normal types (liability, equity, income)   → SUM(credit)-SUM(debit)
// When as_of is provided, only journal entries on or before that date are included.
router.get("/", async (c) => {
  const db = createDb(c.env);
  const decimalPlacesByCurrency = await loadCurrencyDecimalPlaces(db);
  const asOf = c.req.query("as_of");
  const hasAsOf = asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf);

  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      category: accounts.category,
      payday: accounts.payday,
      is_depreciable: accounts.is_depreciable,
      include_in_allocatable: accounts.include_in_allocatable,
      is_system: accounts.is_system,
      created_at: accounts.created_at,
      completion_id: accountCompletions.id,
    })
    .from(accounts)
    .leftJoin(
      accountCompletions,
      eq(accountCompletions.account_id, accounts.id),
    )
    .orderBy(accounts.type, accounts.category, accounts.name);

  // Fetch per-currency balances for all accounts in a single query
  const balanceResult = hasAsOf
    ? await db.run(sql`
          SELECT
            jl.account_id,
            jl.currency,
            CASE
              WHEN a.type IN ('asset', 'expense')
                THEN SUM(jl.debit) - SUM(jl.credit)
              ELSE SUM(jl.credit) - SUM(jl.debit)
            END AS balance
          FROM journal_lines jl
          JOIN journal_entries je ON jl.journal_entry_id = je.id
          JOIN accounts a ON a.id = jl.account_id
          WHERE je.date <= ${asOf}
          GROUP BY jl.account_id, jl.currency
        `)
    : await db.run(sql`
          SELECT
            jl.account_id,
            jl.currency,
            CASE
              WHEN a.type IN ('asset', 'expense')
                THEN SUM(jl.debit) - SUM(jl.credit)
              ELSE SUM(jl.credit) - SUM(jl.debit)
            END AS balance
          FROM journal_lines jl
          JOIN journal_entries je ON jl.journal_entry_id = je.id
          JOIN accounts a ON a.id = jl.account_id
          WHERE je.date <= strftime('%Y-%m-%d', 'now')
          GROUP BY jl.account_id, jl.currency
        `);
  const balanceRows = balanceResult.results as {
    account_id: number;
    currency: string;
    balance: number;
  }[];

  // Build per-account balances map: account_id → { currency: balance }
  const balancesMap = new Map<number, Record<string, number>>();
  for (const row of balanceRows) {
    const map = balancesMap.get(row.account_id) ?? {};
    map[row.currency] = fromStorageMoneyAmount(
      Number(row.balance),
      row.currency,
      { decimalPlacesByCurrency },
    );
    balancesMap.set(row.account_id, map);
  }

  // Fetch budget ratios for expense accounts
  const expenseIds = rows.filter((r) => r.type === "expense").map((r) => r.id);
  const budgetRatiosMap: Record<number, AccountBudgetRatio[]> = {};

  if (expenseIds.length > 0) {
    const ratioRows = await db
      .select({
        account_id: budgetCategoryAccounts.account_id,
        budget_category_id: budgetCategoryAccounts.budget_category_id,
        budget_category_name: budgetCategories.name,
        ratio: budgetCategoryAccounts.ratio,
      })
      .from(budgetCategoryAccounts)
      .innerJoin(
        budgetCategories,
        eq(budgetCategoryAccounts.budget_category_id, budgetCategories.id),
      )
      .where(inArray(budgetCategoryAccounts.account_id, expenseIds));

    for (const row of ratioRows) {
      if (!budgetRatiosMap[row.account_id])
        budgetRatiosMap[row.account_id] = [];
      budgetRatiosMap[row.account_id]!.push({
        budget_category_id: row.budget_category_id,
        budget_category_name: row.budget_category_name,
        ratio: row.ratio,
      });
    }
  }

  return c.json(
    rows.map((r) => {
      const balances = balancesMap.get(r.id) ?? {};
      const balance = Object.values(balances).reduce((s, v) => s + v, 0);
      return {
        ...r,
        payday: r.payday ?? null,
        is_depreciable: r.is_depreciable === 1,
        include_in_allocatable: r.include_in_allocatable === 1,
        is_system: r.is_system === 1,
        is_completed: r.completion_id != null,
        balance,
        balances,
        budget_ratios: budgetRatiosMap[r.id] ?? [],
      };
    }),
  );
});

// POST /api/accounts — create account
router.post("/", async (c) => {
  const body = await c.req.json<{
    name: string;
    type: string;
    category: string;
    payday?: number | null;
    is_depreciable?: boolean;
    include_in_allocatable?: boolean;
    budget_ratios?: { budget_category_id: number; ratio: number }[];
  }>();

  if (!body.name || !body.type || !body.category) {
    return c.json({ error: "name, type, and category are required" }, 400);
  }

  const db = createDb(c.env);

  // Reject if an account or budget category with the same name already exists
  const [dupAccount] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.name, body.name));
  if (dupAccount) {
    return c.json({ error: "name_conflict", conflict_type: "account" }, 409);
  }
  const [nameConflict] = await db
    .select({ id: budgetCategories.id })
    .from(budgetCategories)
    .where(eq(budgetCategories.name, body.name));
  if (nameConflict) {
    return c.json(
      { error: "name_conflict", conflict_type: "budget_category" },
      409,
    );
  }

  const [account] = await db
    .insert(accounts)
    .values({
      name: body.name,
      type: body.type as (typeof accounts.$inferInsert)["type"],
      category: body.category as (typeof accounts.$inferInsert)["category"],
      payday: body.type === "income" ? (body.payday ?? null) : null,
      is_depreciable: body.type === "asset" && body.is_depreciable ? 1 : 0,
      include_in_allocatable:
        body.type === "asset" &&
        body.category === "cash" &&
        body.include_in_allocatable !== false
          ? 1
          : 0,
    })
    .returning();

  if (!account) return c.json({ error: "insert failed" }, 500);

  // Handle budget ratios for expense accounts
  if (
    body.type === "expense" &&
    body.budget_ratios &&
    body.budget_ratios.length > 0
  ) {
    const nonZero = body.budget_ratios.filter((r) => r.ratio > 0);
    if (nonZero.length > 0) {
      await db.insert(budgetCategoryAccounts).values(
        nonZero.map((r) => ({
          budget_category_id: r.budget_category_id,
          account_id: account.id,
          ratio: r.ratio,
        })),
      );
    }
  }

  const ratioRows =
    body.type === "expense"
      ? await db
          .select({
            budget_category_id: budgetCategoryAccounts.budget_category_id,
            budget_category_name: budgetCategories.name,
            ratio: budgetCategoryAccounts.ratio,
          })
          .from(budgetCategoryAccounts)
          .innerJoin(
            budgetCategories,
            eq(budgetCategoryAccounts.budget_category_id, budgetCategories.id),
          )
          .where(eq(budgetCategoryAccounts.account_id, account.id))
      : [];

  return c.json(
    {
      ...account,
      payday: account.payday ?? null,
      is_depreciable: account.is_depreciable === 1,
      include_in_allocatable: account.include_in_allocatable === 1,
      balance: 0,
      balances: {},
      budget_ratios: ratioRows,
    },
    201,
  );
});

// PATCH /api/accounts/:id — update name, category, payday, budget_ratios
router.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const body = await c.req.json<{
    name?: string;
    category?: string;
    payday?: number | null;
    is_depreciable?: boolean;
    include_in_allocatable?: boolean;
    budget_ratios?: { budget_category_id: number; ratio: number }[];
  }>();

  const db = createDb(c.env);

  // Fetch existing account to know its type
  const [existing] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, id));
  if (!existing) return c.json({ error: "Not found" }, 404);
  if (existing.is_system === 1) return c.json({ error: "system_account" }, 403);

  // Reject if renaming to a name already used by another account or a budget category
  if (body.name !== undefined && body.name !== existing.name) {
    const [dupAccount] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.name, body.name), ne(accounts.id, id)));
    if (dupAccount) {
      return c.json({ error: "name_conflict", conflict_type: "account" }, 409);
    }
    const [nameConflict] = await db
      .select({ id: budgetCategories.id })
      .from(budgetCategories)
      .where(eq(budgetCategories.name, body.name));
    if (nameConflict) {
      return c.json(
        { error: "name_conflict", conflict_type: "budget_category" },
        409,
      );
    }
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.category !== undefined) updates.category = body.category;
  if (body.payday !== undefined && existing.type === "income") {
    updates.payday = body.payday ?? null;
  }
  if (body.is_depreciable !== undefined && existing.type === "asset") {
    updates.is_depreciable = body.is_depreciable ? 1 : 0;
  }
  if (body.include_in_allocatable !== undefined && existing.type === "asset") {
    const nextCategory = (body.category ?? existing.category) as string;
    updates.include_in_allocatable =
      nextCategory === "cash" && body.include_in_allocatable ? 1 : 0;
  } else if (body.category !== undefined && existing.type === "asset") {
    updates.include_in_allocatable =
      body.category === "cash" ? existing.include_in_allocatable : 0;
  }

  if (Object.keys(updates).length > 0) {
    await db.update(accounts).set(updates).where(eq(accounts.id, id));
  }

  // Handle budget_ratios for expense accounts
  if (existing.type === "expense" && body.budget_ratios !== undefined) {
    await db
      .delete(budgetCategoryAccounts)
      .where(eq(budgetCategoryAccounts.account_id, id));

    const nonZero = body.budget_ratios.filter((r) => r.ratio > 0);
    if (nonZero.length > 0) {
      await db.insert(budgetCategoryAccounts).values(
        nonZero.map((r) => ({
          budget_category_id: r.budget_category_id,
          account_id: id,
          ratio: r.ratio,
        })),
      );
    }
  }

  const [result] = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      category: accounts.category,
      payday: accounts.payday,
      is_depreciable: accounts.is_depreciable,
      include_in_allocatable: accounts.include_in_allocatable,
      created_at: accounts.created_at,
    })
    .from(accounts)
    .where(eq(accounts.id, id));

  if (!result) return c.json({ error: "Not found" }, 404);

  const ratioRows =
    result.type === "expense"
      ? await db
          .select({
            budget_category_id: budgetCategoryAccounts.budget_category_id,
            budget_category_name: budgetCategories.name,
            ratio: budgetCategoryAccounts.ratio,
          })
          .from(budgetCategoryAccounts)
          .innerJoin(
            budgetCategories,
            eq(budgetCategoryAccounts.budget_category_id, budgetCategories.id),
          )
          .where(eq(budgetCategoryAccounts.account_id, id))
      : [];

  return c.json({
    ...result,
    payday: result.payday ?? null,
    is_depreciable: result.is_depreciable === 1,
    include_in_allocatable: result.include_in_allocatable === 1,
    budget_ratios: ratioRows,
  });
});

// DELETE /api/accounts/:id — delete account (refuses if in use, returns 409)
router.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const db = createDb(c.env);

  // Reject deletion of system accounts
  const [acct] = await db
    .select({ is_system: accounts.is_system })
    .from(accounts)
    .where(eq(accounts.id, id));
  if (!acct) return c.json({ error: "Not found" }, 404);
  if (acct.is_system === 1) return c.json({ error: "system_account" }, 403);

  // Check journal_lines usage
  const jRows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(journalLines)
    .where(eq(journalLines.account_id, id));
  const jCount = Number(jRows[0]?.count ?? 0);

  // Check crypto_wallets usage
  const wRows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(cryptoWallets)
    .where(eq(cryptoWallets.account_id, id));
  const wCount = Number(wRows[0]?.count ?? 0);

  if (jCount > 0 || wCount > 0) {
    return c.json(
      {
        error: "in_use",
        journal_line_count: jCount,
        crypto_wallet_count: wCount,
      },
      409,
    );
  }

  const deleted = await db
    .delete(accounts)
    .where(eq(accounts.id, id))
    .returning();

  if (deleted.length === 0) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.json({ success: true });
});

// POST /api/accounts/:id/replace — reassign all journal_lines to another account then delete
router.post("/:id/replace", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const body = await c.req.json<{ replace_with_id: number }>();
  const replaceWithId = Number(body.replace_with_id);
  if (isNaN(replaceWithId))
    return c.json({ error: "Invalid replace_with_id" }, 400);
  if (id === replaceWithId)
    return c.json({ error: "Cannot replace with same account" }, 400);

  const db = createDb(c.env);

  const [origRows, replRows] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.id, id)),
    db.select().from(accounts).where(eq(accounts.id, replaceWithId)),
  ]);

  const original = origRows[0];
  const replacement = replRows[0];

  if (!original) return c.json({ error: "Source account not found" }, 404);
  if (!replacement)
    return c.json({ error: "Replacement account not found" }, 404);
  if (original.type !== replacement.type) {
    return c.json({ error: "Accounts must be the same type" }, 400);
  }

  // Execute as D1 batch (atomic)
  await db.batch([
    db
      .update(journalLines)
      .set({ account_id: replaceWithId })
      .where(eq(journalLines.account_id, id)),
    db.delete(cryptoWallets).where(eq(cryptoWallets.account_id, id)),
    db.delete(accounts).where(eq(accounts.id, id)),
  ]);

  return c.json({ success: true });
});

// POST /api/accounts/:id/complete — force-mark an account as completed
router.post("/:id/complete", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const db = createDb(c.env);
  const [acct] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, id));
  if (!acct) return c.json({ error: "Not found" }, 404);

  await db
    .insert(accountCompletions)
    .values({ account_id: id })
    .onConflictDoNothing();
  return c.json({ success: true });
});

// DELETE /api/accounts/:id/complete — remove completion mark from an account
router.delete("/:id/complete", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const db = createDb(c.env);
  await db
    .delete(accountCompletions)
    .where(eq(accountCompletions.account_id, id));
  return c.json({ success: true });
});

export { router as accountsRouter };
