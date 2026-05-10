import { eq, sql, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { createDb, type Env } from "../db";
import {
  accounts,
  journalEntries,
  journalLines,
  journalEntryBudgetAllocations,
  budgetCategoryAccounts,
  depreciationSchedules,
  depreciationEntries,
} from "../db/schema";
import {
  findInvalidMoneyField,
  invalidMoneyResponse,
} from "../lib/moneyValidation";

const router = new Hono<{ Bindings: Env }>();

// ── helpers ──────────────────────────────────────────────────────────────────

/** Return YYYY-MM-DD for the 1st of the month that is `offset` months after the
 *  month derived from `baseDate`. offset=0 = same month as baseDate. */
function firstOfMonth(baseDate: string, offset: number): string {
  const [y, m] = baseDate.split("-").map(Number) as [number, number];
  const d = new Date(y, m - 1 + offset, 1);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}-01`;
}

/** Days in the month of `date` (YYYY-MM-DD). */
function daysInMonth(date: string): number {
  const [y, m] = date.split("-").map(Number) as [number, number];
  return new Date(y, m, 0).getDate();
}

/**
 * Compute the monthly depreciation amounts.
 * - Month 1: prorated by the remaining days in the purchase month.
 * - Months 2..N: treated as full months.
 * - Any rounding remainder is added to month 1 instead of the final month.
 */
function computeMonthlyAmounts(
  totalAmount: number,
  months: number,
  startDate: string,
): number[] {
  if (months === 1) return [totalAmount];

  const [, , dayStr] = startDate.split("-") as [string, string, string];
  const day = Number(dayStr);
  const dim = daysInMonth(startDate);
  const daysRemaining = dim - day + 1;
  const firstMonthWeight = daysRemaining / dim;
  const weights = [firstMonthWeight, ...Array<number>(months - 1).fill(1)];
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const amounts = weights.map((weight) =>
    Math.floor((totalAmount * weight) / totalWeight),
  );
  const allocated = amounts.reduce((sum, amount) => sum + amount, 0);
  amounts[0] = (amounts[0] ?? 0) + (totalAmount - allocated);
  return amounts;
}

/** Build journal_entry_budget_allocations rows for a monthly depreciation entry. */
function buildBudgetAllocations(
  journalEntryId: number,
  amount: number,
  ratios: { budget_category_id: number; ratio: number }[],
): { journal_entry_id: number; budget_category_id: number; amount: number }[] {
  if (ratios.length === 0) return [];
  const totalRatio = ratios.reduce((s, r) => s + r.ratio, 0);
  if (totalRatio <= 0) return [];

  // Expense-side allocations are stored as negative values so budget summary
  // treats them as spending rather than additions to the budget.
  const rows: {
    journal_entry_id: number;
    budget_category_id: number;
    amount: number;
  }[] = [];
  let remaining = -amount;

  for (let i = 0; i < ratios.length; i++) {
    const r = ratios[i]!;
    const isLast = i === ratios.length - 1;
    const alloc = isLast
      ? remaining
      : -Math.round((amount * r.ratio) / totalRatio);
    rows.push({
      journal_entry_id: journalEntryId,
      budget_category_id: r.budget_category_id,
      amount: alloc,
    });
    remaining -= alloc;
  }
  return rows;
}

async function insertDepreciationEntriesChunked(
  db: ReturnType<typeof createDb>,
  rows: {
    schedule_id: number;
    journal_entry_id: number;
    month_number: number;
  }[],
) {
  // D1 is sensitive to large parameterized multi-row inserts.
  const chunkSize = 30;
  for (let i = 0; i < rows.length; i += chunkSize) {
    await db
      .insert(depreciationEntries)
      .values(rows.slice(i, i + chunkSize));
  }
}

// ── routes ───────────────────────────────────────────────────────────────────

// GET /api/depreciation — list all schedules
router.get("/", async (c) => {
  const db = createDb(c.env);

  const schedules = await db
    .select()
    .from(depreciationSchedules)
    .orderBy(sql`${depreciationSchedules.start_date} DESC`);

  if (schedules.length === 0) return c.json([]);

  const scheduleIds = schedules.map((s) => s.id);

  const entries = await db
    .select()
    .from(depreciationEntries)
    .where(inArray(depreciationEntries.schedule_id, scheduleIds))
    .orderBy(depreciationEntries.schedule_id, depreciationEntries.month_number);

  // Fetch account names
  const accountIds = [
    ...new Set(
      schedules.flatMap((s) => [s.asset_account_id, s.expense_account_id]),
    ),
  ];
  const accountRows = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(inArray(accounts.id, accountIds));
  const accountMap = new Map(accountRows.map((a) => [a.id, a.name]));

  // Fetch entry dates and amounts for each schedule
  const entryJournalIds = entries.map((e) => e.journal_entry_id);
  const journalRows =
    entryJournalIds.length > 0
      ? await db
          .select({
            id: journalEntries.id,
            date: journalEntries.date,
          })
          .from(journalEntries)
          .where(inArray(journalEntries.id, entryJournalIds))
      : [];
  const journalDateMap = new Map(journalRows.map((j) => [j.id, j.date]));

  // Fetch debit amounts for depreciation lines
  const lineRows =
    entryJournalIds.length > 0
      ? await db
          .select({
            journal_entry_id: journalLines.journal_entry_id,
            debit: journalLines.debit,
            account_id: journalLines.account_id,
          })
          .from(journalLines)
          .where(inArray(journalLines.journal_entry_id, entryJournalIds))
      : [];

  // Per journal entry → debit amount (the expense side)
  const entryAmountMap = new Map<number, number>();
  for (const line of lineRows) {
    if (line.debit > 0) {
      entryAmountMap.set(line.journal_entry_id, line.debit);
    }
  }

  const entriesBySchedule = new Map<number, typeof entries>();
  for (const e of entries) {
    const arr = entriesBySchedule.get(e.schedule_id) ?? [];
    arr.push(e);
    entriesBySchedule.set(e.schedule_id, arr);
  }

  return c.json(
    schedules.map((s) => {
      const sEntries = (entriesBySchedule.get(s.id) ?? []).sort(
        (a, b) => a.month_number - b.month_number,
      );
      return {
        id: s.id,
        source_journal_entry_id: s.source_journal_entry_id,
        asset_account_id: s.asset_account_id,
        asset_account_name: accountMap.get(s.asset_account_id) ?? "",
        expense_account_id: s.expense_account_id,
        expense_account_name: accountMap.get(s.expense_account_id) ?? "",
        total_amount: s.total_amount,
        months: s.months,
        start_date: s.start_date,
        description: s.description,
        created_at: s.created_at,
        monthly_amounts: sEntries.map(
          (e) => entryAmountMap.get(e.journal_entry_id) ?? 0,
        ),
        entry_dates: sEntries.map(
          (e) => journalDateMap.get(e.journal_entry_id) ?? "",
        ),
      };
    }),
  );
});

// POST /api/depreciation — create schedule + all journal entries
router.post("/", async (c) => {
  const body = await c.req.json<{
    purchase_date: string;
    description: string;
    asset_account_id: number;
    payment_account_id: number;
    expense_account_id: number;
    total_amount: number;
    months: number;
  }>();

  const {
    purchase_date,
    description,
    asset_account_id,
    payment_account_id,
    expense_account_id,
    total_amount,
    months,
  } = body;

  const invalidMoneyField = findInvalidMoneyField([
    { path: "total_amount", value: total_amount },
  ]);
  if (invalidMoneyField) {
    return c.json(invalidMoneyResponse(invalidMoneyField), 400);
  }

  if (
    !purchase_date ||
    !description ||
    !asset_account_id ||
    !payment_account_id ||
    !expense_account_id ||
    total_amount <= 0 ||
    months < 1
  ) {
    return c.json({ error: "Missing or invalid fields" }, 400);
  }

  const db = createDb(c.env);
  const monthlyAmounts = computeMonthlyAmounts(
    total_amount,
    months,
    purchase_date,
  );

  // Fetch budget ratios for the chosen expense account
  const budgetRatios = await db
    .select()
    .from(budgetCategoryAccounts)
    .where(eq(budgetCategoryAccounts.account_id, expense_account_id));

  // 1. Purchase entry: DR asset / CR payment (no budget allocation — CapEx, not OpEx)
  const [purchaseEntry] = await db
    .insert(journalEntries)
    .values({ date: purchase_date, description })
    .returning();
  if (!purchaseEntry)
    return c.json({ error: "Failed to create purchase entry" }, 500);

  await db.insert(journalLines).values([
    {
      journal_entry_id: purchaseEntry.id,
      account_id: asset_account_id,
      debit: total_amount,
      credit: 0,
    },
    {
      journal_entry_id: purchaseEntry.id,
      account_id: payment_account_id,
      debit: 0,
      credit: total_amount,
    },
  ]);

  // 2. Create schedule record
  const [schedule] = await db
    .insert(depreciationSchedules)
    .values({
      source_journal_entry_id: purchaseEntry.id,
      asset_account_id,
      expense_account_id,
      total_amount,
      months,
      start_date: purchase_date,
      description,
    })
    .returning();
  if (!schedule) return c.json({ error: "Failed to create schedule" }, 500);

  // 3. Monthly depreciation entries: DR expense / CR asset
  const entryDates: string[] = [];
  for (let i = 0; i < months; i++) {
    entryDates.push(i === 0 ? purchase_date : firstOfMonth(purchase_date, i));
  }

  const monthlyJournalIds: number[] = [];
  for (let i = 0; i < months; i++) {
    const amt = monthlyAmounts[i] ?? 0;
    const entryDesc = `${description} 減価償却費 (${i + 1}/${months}ヶ月)`;
    const [entry] = await db
      .insert(journalEntries)
      .values({ date: entryDates[i]!, description: entryDesc })
      .returning();
    if (!entry) continue;
    await db.insert(journalLines).values([
      {
        journal_entry_id: entry.id,
        account_id: expense_account_id,
        debit: amt,
        credit: 0,
      },
      {
        journal_entry_id: entry.id,
        account_id: asset_account_id,
        debit: 0,
        credit: amt,
      },
    ]);
    // Budget allocations: distribute monthly amount across budget categories by ratio
    if (budgetRatios.length > 0) {
      const allocRows = buildBudgetAllocations(entry.id, amt, budgetRatios);
      if (allocRows.length > 0) {
        await db.insert(journalEntryBudgetAllocations).values(allocRows);
      }
    }
    monthlyJournalIds.push(entry.id);
  }

  // 4. Link schedule → depreciation entries
  if (monthlyJournalIds.length > 0) {
    await insertDepreciationEntriesChunked(
      db,
      monthlyJournalIds.map((jid, i) => ({
        schedule_id: schedule.id,
        journal_entry_id: jid,
        month_number: i + 1,
      })),
    );
  }

  return c.json(
    {
      schedule_id: schedule.id,
      source_journal_entry_id: purchaseEntry.id,
      monthly_amounts: monthlyAmounts,
      entry_dates: entryDates,
    },
    201,
  );
});

// PATCH /api/depreciation/:id — update schedule (regenerates all monthly entries)
router.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const body = await c.req.json<{
    purchase_date?: string;
    description?: string;
    total_amount?: number;
    months?: number;
    asset_account_id?: number;
    expense_account_id?: number;
    payment_account_id?: number;
  }>();

  const invalidMoneyField = findInvalidMoneyField([
    { path: "total_amount", value: body.total_amount },
  ]);
  if (invalidMoneyField) {
    return c.json(invalidMoneyResponse(invalidMoneyField), 400);
  }

  const db = createDb(c.env);

  const [schedule] = await db
    .select()
    .from(depreciationSchedules)
    .where(eq(depreciationSchedules.id, id));
  if (!schedule) return c.json({ error: "Not found" }, 404);

  const newPurchaseDate = body.purchase_date ?? schedule.start_date;
  const newDescription = body.description ?? schedule.description;
  const newTotalAmount = body.total_amount ?? schedule.total_amount;
  const newMonths = body.months ?? schedule.months;
  const newAssetAccountId = body.asset_account_id ?? schedule.asset_account_id;
  const newExpenseAccountId =
    body.expense_account_id ?? schedule.expense_account_id;

  // Update purchase journal entry
  await db
    .update(journalEntries)
    .set({ date: newPurchaseDate, description: newDescription })
    .where(eq(journalEntries.id, schedule.source_journal_entry_id));

  // Update purchase journal lines amount if total changed
  if (
    body.asset_account_id !== undefined ||
    body.total_amount !== undefined ||
    body.payment_account_id !== undefined
  ) {
    // Determine payment account from the existing credit line before replacing it.
    let paymentAccountId = body.payment_account_id;
    if (!paymentAccountId) {
      const existingLines = await db
        .select()
        .from(journalLines)
        .where(
          eq(journalLines.journal_entry_id, schedule.source_journal_entry_id),
        );
      paymentAccountId = existingLines.find((l) => l.credit > 0)?.account_id;
    }

    // Delete and recreate purchase lines
    await db
      .delete(journalLines)
      .where(
        eq(journalLines.journal_entry_id, schedule.source_journal_entry_id),
      );

    if (paymentAccountId) {
      await db.insert(journalLines).values([
        {
          journal_entry_id: schedule.source_journal_entry_id,
          account_id: newAssetAccountId,
          debit: newTotalAmount,
          credit: 0,
        },
        {
          journal_entry_id: schedule.source_journal_entry_id,
          account_id: paymentAccountId,
          debit: 0,
          credit: newTotalAmount,
        },
      ]);
    }
  }

  // Delete existing monthly entries via cascade: delete depreciationEntries → delete journal entries
  const existingDepEntries = await db
    .select()
    .from(depreciationEntries)
    .where(eq(depreciationEntries.schedule_id, id));

  const oldJournalIds = existingDepEntries.map((e) => e.journal_entry_id);
  if (oldJournalIds.length > 0) {
    await db
      .delete(journalEntries)
      .where(inArray(journalEntries.id, oldJournalIds));
  }

  // Recreate monthly entries
  const newAmounts = computeMonthlyAmounts(
    newTotalAmount,
    newMonths,
    newPurchaseDate,
  );
  const entryDates: string[] = [];
  for (let i = 0; i < newMonths; i++) {
    entryDates.push(
      i === 0 ? newPurchaseDate : firstOfMonth(newPurchaseDate, i),
    );
  }

  // Fetch budget ratios for the expense account
  const patchBudgetRatios = await db
    .select()
    .from(budgetCategoryAccounts)
    .where(eq(budgetCategoryAccounts.account_id, newExpenseAccountId));

  const newMonthlyJournalIds: number[] = [];
  for (let i = 0; i < newMonths; i++) {
    const amt = newAmounts[i] ?? 0;
    const entryDesc = `${newDescription} 減価償却費 (${i + 1}/${newMonths}ヶ月)`;
    const [entry] = await db
      .insert(journalEntries)
      .values({ date: entryDates[i]!, description: entryDesc })
      .returning();
    if (!entry) continue;
    await db.insert(journalLines).values([
      {
        journal_entry_id: entry.id,
        account_id: newExpenseAccountId,
        debit: amt,
        credit: 0,
      },
      {
        journal_entry_id: entry.id,
        account_id: newAssetAccountId,
        debit: 0,
        credit: amt,
      },
    ]);
    if (patchBudgetRatios.length > 0) {
      const allocRows = buildBudgetAllocations(
        entry.id,
        amt,
        patchBudgetRatios,
      );
      if (allocRows.length > 0) {
        await db.insert(journalEntryBudgetAllocations).values(allocRows);
      }
    }
    newMonthlyJournalIds.push(entry.id);
  }

  if (newMonthlyJournalIds.length > 0) {
    await insertDepreciationEntriesChunked(
      db,
      newMonthlyJournalIds.map((jid, i) => ({
        schedule_id: id,
        journal_entry_id: jid,
        month_number: i + 1,
      })),
    );
  }

  // Update schedule record
  await db
    .update(depreciationSchedules)
    .set({
      start_date: newPurchaseDate,
      description: newDescription,
      total_amount: newTotalAmount,
      months: newMonths,
      asset_account_id: newAssetAccountId,
      expense_account_id: newExpenseAccountId,
    })
    .where(eq(depreciationSchedules.id, id));

  return c.json({
    schedule_id: id,
    monthly_amounts: newAmounts,
    entry_dates: entryDates,
  });
});

// DELETE /api/depreciation/:id — delete schedule + all its entries
router.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const db = createDb(c.env);

  const [schedule] = await db
    .select()
    .from(depreciationSchedules)
    .where(eq(depreciationSchedules.id, id));
  if (!schedule) return c.json({ error: "Not found" }, 404);

  // Delete all monthly journal entries
  const depEntries = await db
    .select()
    .from(depreciationEntries)
    .where(eq(depreciationEntries.schedule_id, id));
  const journalIds = depEntries.map((e) => e.journal_entry_id);
  if (journalIds.length > 0) {
    await db
      .delete(journalEntries)
      .where(inArray(journalEntries.id, journalIds));
  }

  // Delete schedule (cascades to depreciation_entries)
  await db
    .delete(depreciationSchedules)
    .where(eq(depreciationSchedules.id, id));

  // Delete purchase journal entry
  await db
    .delete(journalEntries)
    .where(eq(journalEntries.id, schedule.source_journal_entry_id));

  return c.json({ success: true });
});

// GET /api/depreciation/report?year=YYYY or ?year_month=YYYY-MM
router.get("/report", async (c) => {
  const year = c.req.query("year");
  const yearMonth = c.req.query("year_month");

  if (!year && !yearMonth) {
    return c.json({ error: "year or year_month query param required" }, 400);
  }

  const db = createDb(c.env);

  const allSchedules = await db.select().from(depreciationSchedules);
  if (allSchedules.length === 0) {
    return c.json({
      period: year ?? yearMonth,
      total_depreciation: 0,
      entries: [],
    });
  }

  const scheduleIds = allSchedules.map((s) => s.id);

  // Fetch all depreciation entries linked to those schedules
  const depEntries = await db
    .select()
    .from(depreciationEntries)
    .where(inArray(depreciationEntries.schedule_id, scheduleIds));

  if (depEntries.length === 0) {
    return c.json({
      period: year ?? yearMonth,
      total_depreciation: 0,
      entries: [],
    });
  }

  const journalIds = depEntries.map((e) => e.journal_entry_id);

  // Fetch journal entries to filter by date
  const journalRows = await db
    .select({ id: journalEntries.id, date: journalEntries.date })
    .from(journalEntries)
    .where(inArray(journalEntries.id, journalIds));

  // Filter by period
  const filteredJournalIds = new Set(
    journalRows
      .filter((j) => {
        if (yearMonth) return j.date.startsWith(yearMonth);
        if (year) return j.date.startsWith(year);
        return false;
      })
      .map((j) => j.id),
  );

  if (filteredJournalIds.size === 0) {
    return c.json({
      period: year ?? yearMonth,
      total_depreciation: 0,
      entries: [],
    });
  }

  // Fetch line amounts
  const lineRows = await db
    .select({
      journal_entry_id: journalLines.journal_entry_id,
      debit: journalLines.debit,
    })
    .from(journalLines)
    .where(inArray(journalLines.journal_entry_id, [...filteredJournalIds]));

  // Sum debit per journal entry
  const amountByJournal = new Map<number, number>();
  for (const line of lineRows) {
    if (line.debit > 0) amountByJournal.set(line.journal_entry_id, line.debit);
  }

  // Map depreciationEntry → journal entry → amount, grouped by schedule
  const amountBySchedule = new Map<number, number>();
  for (const de of depEntries) {
    if (!filteredJournalIds.has(de.journal_entry_id)) continue;
    const amt = amountByJournal.get(de.journal_entry_id) ?? 0;
    amountBySchedule.set(
      de.schedule_id,
      (amountBySchedule.get(de.schedule_id) ?? 0) + amt,
    );
  }

  // Fetch account names
  const accountIds = [...new Set(allSchedules.map((s) => s.asset_account_id))];
  const accountRows = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(inArray(accounts.id, accountIds));
  const accountMap = new Map(accountRows.map((a) => [a.id, a.name]));

  const resultEntries = allSchedules
    .filter((s) => (amountBySchedule.get(s.id) ?? 0) > 0)
    .map((s) => ({
      schedule_id: s.id,
      description: s.description,
      asset_account_name: accountMap.get(s.asset_account_id) ?? "",
      total_amount: s.total_amount,
      months: s.months,
      start_date: s.start_date,
      amount_in_period: amountBySchedule.get(s.id) ?? 0,
    }));

  const totalDepreciation = resultEntries.reduce(
    (s, e) => s + e.amount_in_period,
    0,
  );

  return c.json({
    period: year ?? yearMonth,
    total_depreciation: totalDepreciation,
    entries: resultEntries,
  });
});

export { router as depreciationRouter };
