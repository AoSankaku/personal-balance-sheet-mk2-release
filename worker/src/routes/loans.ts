import { eq, inArray, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { createDb, type Env } from "../db";
import {
  accounts,
  journalEntries,
  journalLines,
  loanSettlements,
} from "../db/schema";
import { resolveAsOfDate } from "../lib/appDate";
import { loadCurrencyDecimalPlaces } from "../lib/currencyPrecision";
import { normalizeLoanBudgetWeights, validateLoanBudgetWeights } from "../../../shared/longTermLoanBudgetDefaults";
import type { LongTermLoanBudgetWeight } from "../../../shared/types";
import { chunkForD1InClause } from "../lib/d1Query";
import {
  getLongTermLoanBudgetDefaults,
  isLongTermLoanBudgetAccount,
  LoanBudgetDefaultsChangedError,
  normalizeLoanBudgetCurrency,
} from "../lib/longTermLoanBudgetDefaults";
import { readBudgetMutationRevision, runBudgetGuardedBatch } from "../lib/d1Mutation";
import { fromStorageMoneyAmount } from "../lib/moneyValidation";

const router = new Hono<{ Bindings: Env }>();

function normalizeCurrency(currency: string | null | undefined) {
  return (currency || "JPY").toUpperCase();
}

async function validateBudgetDefaultTarget(
  c: Context<{ Bindings: Env }>,
  accountId: number,
  currency: string,
) {
  const currencyRow = await c.env.DB.prepare(`
    SELECT code FROM enabled_currencies WHERE UPPER(code) = ?
  `).bind(currency).first<{ code: string }>();
  if (!currencyRow) return { response: c.json({ error: "invalid_currency" }, 400) };

  const account = await c.env.DB.prepare(`
    SELECT id, type, category FROM accounts WHERE id = ?
  `).bind(accountId).first<{ id: number; type: string; category: string }>();
  if (!account) return { response: c.json({ error: "account_not_found" }, 404) };
  if (!isLongTermLoanBudgetAccount(account)) {
    return { response: c.json({ error: "long_term_loan_account_required" }, 400) };
  }
  return { account };
}

function parseAccountId(raw: string | undefined) {
  if (!raw || !/^\d+$/u.test(raw)) return null;
  const accountId = Number(raw);
  return Number.isSafeInteger(accountId) && accountId > 0 ? accountId : null;
}

router.get("/:accountId/budget-defaults", async (c) => {
  const accountId = parseAccountId(c.req.param("accountId"));
  if (accountId === null) return c.json({ error: "invalid_account_id" }, 400);
  const currency = normalizeLoanBudgetCurrency(c.req.query("currency"));
  const target = await validateBudgetDefaultTarget(c, accountId, currency);
  if ("response" in target) return target.response;

  let defaults;
  try {
    defaults = await getLongTermLoanBudgetDefaults(c.env.DB, accountId, currency);
  } catch (error) {
    if (error instanceof LoanBudgetDefaultsChangedError) {
      return c.json({ error: "stale_loan_budget_defaults" }, 409);
    }
    throw error;
  }
  if (!defaults) return c.json({ error: "account_not_found" }, 404);
  return c.json(defaults);
});

router.put("/:accountId/budget-defaults", async (c) => {
  const accountId = parseAccountId(c.req.param("accountId"));
  if (accountId === null) return c.json({ error: "invalid_account_id" }, 400);

  let body: { currency?: unknown; allocations?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_loan_budget_defaults" }, 400);
  }
  if (
    !body ||
    typeof body !== "object" ||
    typeof body.currency !== "string" ||
    body.currency.trim() === ""
  ) {
    return c.json({ error: "invalid_currency" }, 400);
  }
  const currency = normalizeLoanBudgetCurrency(body.currency);
  const mutationRevision = await readBudgetMutationRevision(c.env.DB);
  const target = await validateBudgetDefaultTarget(c, accountId, currency);
  if ("response" in target) return target.response;

  const validationError = validateLoanBudgetWeights(body.allocations);
  if (validationError) return c.json({ error: validationError }, 400);

  let allocations: LongTermLoanBudgetWeight[];
  try {
    allocations = normalizeLoanBudgetWeights(body.allocations as LongTermLoanBudgetWeight[]);
  } catch {
    return c.json({ error: "invalid_loan_budget_weights" }, 400);
  }
  const categoryIds = allocations
    .map((allocation) => allocation.budget_category_id)
    .filter((categoryId): categoryId is number => categoryId !== null);
  if (categoryIds.length > 0) {
    const existingIds = new Set<number>();
    for (const categoryChunk of chunkForD1InClause(categoryIds)) {
      const placeholders = categoryChunk.map(() => "?").join(", ");
      const categories = await c.env.DB.prepare(`
        SELECT id FROM budget_categories WHERE id IN (${placeholders})
      `).bind(...categoryChunk).all<{ id: number }>();
      for (const category of categories.results ?? []) existingIds.add(category.id);
    }
    if (categoryIds.some((categoryId) => !existingIds.has(categoryId))) {
      return c.json({ error: "budget_category_not_found" }, 400);
    }
  }

  const now = new Date().toISOString();
  const statements = [
    c.env.DB.prepare(`
      INSERT INTO long_term_loan_budget_defaults (account_id, currency, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(account_id, currency) DO UPDATE SET updated_at = excluded.updated_at
    `).bind(accountId, currency, now),
    c.env.DB.prepare(`
      DELETE FROM long_term_loan_budget_default_allocations
      WHERE default_id = (
        SELECT id FROM long_term_loan_budget_defaults WHERE account_id = ? AND currency = ?
      )
    `).bind(accountId, currency),
    ...allocations.map((allocation) => c.env.DB.prepare(`
      INSERT INTO long_term_loan_budget_default_allocations
        (default_id, budget_category_id, weight)
      VALUES (
        (SELECT id FROM long_term_loan_budget_defaults WHERE account_id = ? AND currency = ?),
        ?, ?
      )
    `).bind(accountId, currency, allocation.budget_category_id, allocation.weight)),
  ];
  const result = await runBudgetGuardedBatch(c.env.DB, mutationRevision, statements);
  if (!result) return c.json({ error: "stale_loan_budget_defaults" }, 409);
  const defaults = await getLongTermLoanBudgetDefaults(c.env.DB, accountId, currency);
  if (!defaults) return c.json({ error: "account_not_found" }, 404);
  return c.json(defaults);
});

router.delete("/:accountId/budget-defaults", async (c) => {
  const accountId = parseAccountId(c.req.param("accountId"));
  if (accountId === null) return c.json({ error: "invalid_account_id" }, 400);
  const currency = normalizeLoanBudgetCurrency(c.req.query("currency"));
  const mutationRevision = await readBudgetMutationRevision(c.env.DB);
  const target = await validateBudgetDefaultTarget(c, accountId, currency);
  if ("response" in target) return target.response;

  const result = await runBudgetGuardedBatch(c.env.DB, mutationRevision, [c.env.DB.prepare(`
    DELETE FROM long_term_loan_budget_defaults WHERE account_id = ? AND currency = ?
  `).bind(accountId, currency)]);
  if (!result) return c.json({ error: "stale_loan_budget_defaults" }, 409);
  const defaults = await getLongTermLoanBudgetDefaults(c.env.DB, accountId, currency);
  if (!defaults) return c.json({ error: "account_not_found" }, 404);
  return c.json(defaults);
});

/**
 * GET /api/loans/unsettled?account_id=N
 * Returns all unsettled opening loan events for a given account.
 * The amount is the net movement on that account in the opening journal entry.
 */
router.get("/unsettled", async (c) => {
  const accountIdStr = c.req.query("account_id");
  const accountId = accountIdStr ? Number(accountIdStr) : NaN;
  if (isNaN(accountId)) return c.json({ error: "account_id is required" }, 400);
  const requestedCurrency = c.req.query("currency")
    ? normalizeCurrency(c.req.query("currency"))
    : null;

  const settlerEntryIdStr = c.req.query("settler_entry_id");
  const settlerEntryId = settlerEntryIdStr ? Number(settlerEntryIdStr) : null;
  const asOf = resolveAsOfDate(c.req.query("as_of"));

  const db = createDb(c.env);
  const decimalPlacesByCurrency = await loadCurrencyDecimalPlaces(db);

  // Fetch account to determine type (asset = debit-normal, liability = credit-normal)
  const [acct] = await db
    .select({ id: accounts.id, type: accounts.type })
    .from(accounts)
    .where(eq(accounts.id, accountId));
  if (!acct) return c.json({ error: "Account not found" }, 404);

  // Fetch unsettled settlements AND (if editing) entries settled by the current entry
  const settlements = await db
    .select({
      journal_entry_id: loanSettlements.journal_entry_id,
      date: journalEntries.date,
      description: journalEntries.description,
      is_settled: loanSettlements.is_settled,
      settled_by_journal_entry_id: loanSettlements.settled_by_journal_entry_id,
    })
    .from(loanSettlements)
    .innerJoin(
      journalEntries,
      eq(loanSettlements.journal_entry_id, journalEntries.id),
    )
    .where(
      settlerEntryId != null
        ? sql`(${loanSettlements.is_settled} = 0
          OR (${loanSettlements.is_settled} = 1 AND ${loanSettlements.settled_by_journal_entry_id} = ${settlerEntryId})
          OR (${loanSettlements.is_settled} = 1
            AND ${loanSettlements.settled_by_journal_entry_id} IS NOT NULL
            AND (SELECT date FROM journal_entries WHERE id = ${loanSettlements.settled_by_journal_entry_id}) > ${asOf}))`
        : sql`(${loanSettlements.is_settled} = 0
          OR (${loanSettlements.is_settled} = 1
            AND ${loanSettlements.settled_by_journal_entry_id} IS NOT NULL
            AND (SELECT date FROM journal_entries WHERE id = ${loanSettlements.settled_by_journal_entry_id}) > ${asOf}))`,
    );

  if (settlements.length === 0) return c.json({ entries: [] });

  // For each settlement, check if its entry has lines touching this account
  const entryIds = settlements.map((s) => s.journal_entry_id);

  // Fetch the relevant journal lines for those entries on this account
  const lineRows = await db
    .select({
      journal_entry_id: journalLines.journal_entry_id,
      debit: journalLines.debit,
      credit: journalLines.credit,
      currency: journalLines.currency,
    })
    .from(journalLines)
    .where(
      sql`${journalLines.account_id} = ${accountId} AND ${journalLines.journal_entry_id} IN (${sql.join(
        entryIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );

  // Build a map: entry_id → net amount on this account
  const amountByEntryCurrency = new Map<string, number>();
  for (const line of lineRows) {
    const lineCurrency = normalizeCurrency(line.currency);
    if (requestedCurrency && lineCurrency !== requestedCurrency) continue;
    const net =
      acct.type === "asset" || acct.type === "expense"
        ? line.debit - line.credit
        : line.credit - line.debit;
    const key = `${line.journal_entry_id}:${lineCurrency}`;
    amountByEntryCurrency.set(
      key,
      (amountByEntryCurrency.get(key) ?? 0) + net,
    );
  }

  // Only return settlements where this account was actually involved (net > 0)
  const entries = settlements
    .flatMap((s) => {
      const rows: {
        journal_entry_id: number;
        date: string;
        description: string;
        amount: number;
        currency: string;
        already_settled_by_current?: boolean;
      }[] = [];
      for (const [key, amount] of amountByEntryCurrency) {
        const [entryIdStr, lineCurrency] = key.split(":");
        if (Number(entryIdStr) !== s.journal_entry_id || amount <= 0) continue;
        const currency = lineCurrency ?? "JPY";
        rows.push({
          journal_entry_id: s.journal_entry_id,
          date: s.date,
          description: s.description,
          amount: fromStorageMoneyAmount(amount, currency, {
            decimalPlacesByCurrency,
          }),
          currency,
          already_settled_by_current:
            settlerEntryId != null &&
            s.is_settled === 1 &&
            s.settled_by_journal_entry_id === settlerEntryId
              ? true
              : undefined,
        });
      }
      return rows;
    });

  return c.json({ entries });
});

/**
 * POST /api/loans/settle
 * Body: { journal_entry_ids: number[], settled_by_journal_entry_id?: number }
 * Marks the specified opening entries as settled.
 */
router.post("/settle", async (c) => {
  const body = await c.req.json<{
    journal_entry_ids: number[];
    settled_by_journal_entry_id?: number;
  }>();

  if (
    !Array.isArray(body.journal_entry_ids) ||
    body.journal_entry_ids.length === 0
  ) {
    return c.json({ error: "journal_entry_ids is required" }, 400);
  }

  const db = createDb(c.env);
  const now = new Date().toISOString();

  await db
    .update(loanSettlements)
    .set({
      is_settled: 1,
      settled_by_journal_entry_id: body.settled_by_journal_entry_id ?? null,
      settled_at: now,
    })
    .where(inArray(loanSettlements.journal_entry_id, body.journal_entry_ids));

  return c.json({ success: true });
});

export { router as loansRouter };
