import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { createDb, type Env } from '../db';
import { accounts, journalLines, journalEntries } from '../db/schema';
import { eq } from 'drizzle-orm';

const router = new Hono<{ Bindings: Env }>();

// GET /api/reports/pl?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/pl', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');

  const db = createDb(c.env);

  // Build date filter clause
  const dateFilter =
    from && to
      ? sql`AND je.date BETWEEN ${from} AND ${to}`
      : from
        ? sql`AND je.date >= ${from}`
        : to
          ? sql`AND je.date <= ${to}`
          : sql``;

  const incomeResult = await db.run(sql`
    SELECT COALESCE(SUM(jl.credit) - SUM(jl.debit), 0) AS total
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE a.type = 'income'
    ${dateFilter}
  `);

  const expenseResult = await db.run(sql`
    SELECT COALESCE(SUM(jl.debit) - SUM(jl.credit), 0) AS total
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE a.type = 'expense'
    ${dateFilter}
  `);

  const income = Number((incomeResult.results[0] as { total: number })?.total ?? 0);
  const expense = Number((expenseResult.results[0] as { total: number })?.total ?? 0);

  return c.json({
    income,
    expense,
    net_income: income - expense,
  });
});

export { router as reportsRouter };
