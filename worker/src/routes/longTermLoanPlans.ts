import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "../db";
import {
  longTermLoanPlans,
  longTermLoanPlanRows,
  journalEntries,
  journalLines,
  accounts,
} from "../db/schema";
import type {
  UpsertLongTermLoanPlanInput,
  UpsertLongTermLoanPlanRowInput,
  LongTermLoanComparisonRow,
} from "@balance-sheet/shared";
import { loadCurrencyDecimalPlaces } from "../lib/currencyPrecision";
import {
  findInvalidMoneyField,
  fromStorageMoneyAmount,
  invalidMoneyResponse,
  type MoneyScaleOptions,
  rescaleStorageMoneyAmount,
  toStorageMoneyAmount,
} from "../lib/moneyValidation";

export const longTermLoanPlansRouter = new Hono<{ Bindings: Env }>();

async function loadMoneyScaleOptions(db: {
  select: ReturnType<typeof drizzle>["select"];
}): Promise<MoneyScaleOptions> {
  return { decimalPlacesByCurrency: await loadCurrencyDecimalPlaces(db) };
}

function decimalPlacesForCurrency(
  scaleOptions: MoneyScaleOptions,
  currency: string | null | undefined,
) {
  return scaleOptions.decimalPlacesByCurrency?.[
    (currency || "JPY").toUpperCase()
  ];
}

// GET /api/long-term-loan-plans/:accountId
longTermLoanPlansRouter.get("/:accountId", async (c) => {
  const db = drizzle(c.env.DB);
  const scaleOptions = await loadMoneyScaleOptions(db);
  const accountId = Number(c.req.param("accountId"));

  const [plan] = await db
    .select()
    .from(longTermLoanPlans)
    .where(eq(longTermLoanPlans.account_id, accountId));

  if (!plan) return c.json({ plan: null });

  const rows = await db
    .select()
    .from(longTermLoanPlanRows)
    .where(eq(longTermLoanPlanRows.plan_id, plan.id))
    .orderBy(longTermLoanPlanRows.year_month);

  return c.json({
    plan: {
      ...plan,
      total_principal:
        plan.total_principal == null
          ? null
          : fromStorageMoneyAmount(
              plan.total_principal,
              plan.currency,
              scaleOptions,
            ),
      monthly_payment:
        plan.monthly_payment == null
          ? null
          : fromStorageMoneyAmount(
              plan.monthly_payment,
              plan.currency,
              scaleOptions,
            ),
      rows: rows.map((row) => ({
        ...row,
        principal_amount: fromStorageMoneyAmount(
          row.principal_amount,
          plan.currency,
          scaleOptions,
        ),
        interest_amount: fromStorageMoneyAmount(
          row.interest_amount,
          plan.currency,
          scaleOptions,
        ),
      })),
    },
  });
});

// POST /api/long-term-loan-plans — upsert plan header
longTermLoanPlansRouter.post("/", async (c) => {
  const db = drizzle(c.env.DB);
  const scaleOptions = await loadMoneyScaleOptions(db);
  const body = await c.req.json<UpsertLongTermLoanPlanInput>();

  if (body.currency !== undefined) {
    const invalidMoneyField = findInvalidMoneyField([
      {
        path: "total_principal",
        value: body.total_principal,
        currency: body.currency,
        decimalPlaces: decimalPlacesForCurrency(scaleOptions, body.currency),
        nullable: true,
      },
      {
        path: "monthly_payment",
        value: body.monthly_payment,
        currency: body.currency,
        decimalPlaces: decimalPlacesForCurrency(scaleOptions, body.currency),
        nullable: true,
      },
    ]);
    if (invalidMoneyField) {
      return c.json(invalidMoneyResponse(invalidMoneyField, body.currency), 400);
    }
  }

  const [existing] = await db
    .select()
    .from(longTermLoanPlans)
    .where(eq(longTermLoanPlans.account_id, body.account_id));

  const currency = body.currency ?? existing?.currency ?? "JPY";
  const invalidMoneyField = findInvalidMoneyField([
    {
      path: "total_principal",
      value: body.total_principal,
      currency,
      decimalPlaces: decimalPlacesForCurrency(scaleOptions, currency),
      nullable: true,
    },
    {
      path: "monthly_payment",
      value: body.monthly_payment,
      currency,
      decimalPlaces: decimalPlacesForCurrency(scaleOptions, currency),
      nullable: true,
    },
  ]);
  if (invalidMoneyField) {
    return c.json(invalidMoneyResponse(invalidMoneyField, currency), 400);
  }

  const now = new Date().toISOString();

  if (existing) {
    const [updated] = await db
      .update(longTermLoanPlans)
      .set({
        note: body.note ?? existing.note,
        currency,
        total_principal:
          body.total_principal !== undefined
            ? body.total_principal == null
              ? null
              : toStorageMoneyAmount(body.total_principal, currency, scaleOptions)
            : rescaleStorageMoneyAmount(
                existing.total_principal,
                existing.currency,
                currency,
                scaleOptions,
              ),
        annual_interest_rate:
          body.annual_interest_rate !== undefined
            ? body.annual_interest_rate
            : existing.annual_interest_rate,
        monthly_payment:
          body.monthly_payment !== undefined
            ? body.monthly_payment == null
              ? null
              : toStorageMoneyAmount(body.monthly_payment, currency, scaleOptions)
            : rescaleStorageMoneyAmount(
                existing.monthly_payment,
                existing.currency,
                currency,
                scaleOptions,
              ),
        start_year_month:
          body.start_year_month !== undefined
            ? body.start_year_month
            : existing.start_year_month,
        updated_at: now,
      })
      .where(eq(longTermLoanPlans.id, existing.id))
      .returning();
    if (currency !== existing.currency) {
      const existingRows = await db
        .select()
        .from(longTermLoanPlanRows)
        .where(eq(longTermLoanPlanRows.plan_id, existing.id));
      await Promise.all(
        existingRows.map((row) =>
          db
            .update(longTermLoanPlanRows)
            .set({
              principal_amount: rescaleStorageMoneyAmount(
                row.principal_amount,
                existing.currency,
                currency,
                scaleOptions,
              )!,
              interest_amount: rescaleStorageMoneyAmount(
                row.interest_amount,
                existing.currency,
                currency,
                scaleOptions,
              )!,
            })
            .where(eq(longTermLoanPlanRows.id, row.id)),
        ),
      );
    }
    const rows = await db
      .select()
      .from(longTermLoanPlanRows)
      .where(eq(longTermLoanPlanRows.plan_id, existing.id))
      .orderBy(longTermLoanPlanRows.year_month);
    return c.json({
      plan: {
        ...updated,
        total_principal:
          updated.total_principal == null
            ? null
            : fromStorageMoneyAmount(
                updated.total_principal,
                updated.currency,
                scaleOptions,
              ),
        monthly_payment:
          updated.monthly_payment == null
            ? null
            : fromStorageMoneyAmount(
                updated.monthly_payment,
                updated.currency,
                scaleOptions,
              ),
        rows: rows.map((row) => ({
          ...row,
          principal_amount: fromStorageMoneyAmount(
            row.principal_amount,
            updated.currency,
            scaleOptions,
          ),
          interest_amount: fromStorageMoneyAmount(
            row.interest_amount,
            updated.currency,
            scaleOptions,
          ),
        })),
      },
    });
  }

  const [created] = await db
    .insert(longTermLoanPlans)
    .values({
      account_id: body.account_id,
      note: body.note ?? null,
      currency,
      total_principal:
        body.total_principal == null
          ? null
          : toStorageMoneyAmount(body.total_principal, currency, scaleOptions),
      annual_interest_rate: body.annual_interest_rate ?? null,
      monthly_payment:
        body.monthly_payment == null
          ? null
          : toStorageMoneyAmount(body.monthly_payment, currency, scaleOptions),
      start_year_month: body.start_year_month ?? null,
      created_at: now,
      updated_at: now,
    })
    .returning();
  return c.json(
    {
      plan: {
        ...created,
        total_principal:
          created.total_principal == null
            ? null
            : fromStorageMoneyAmount(
                created.total_principal,
                created.currency,
                scaleOptions,
              ),
        monthly_payment:
          created.monthly_payment == null
            ? null
            : fromStorageMoneyAmount(
                created.monthly_payment,
                created.currency,
                scaleOptions,
              ),
        rows: [],
      },
    },
    201,
  );
});

// PUT /api/long-term-loan-plans/:accountId/rows — upsert rows
longTermLoanPlansRouter.put("/:accountId/rows", async (c) => {
  const db = drizzle(c.env.DB);
  const scaleOptions = await loadMoneyScaleOptions(db);
  const accountId = Number(c.req.param("accountId"));
  const body = await c.req.json<{ rows: UpsertLongTermLoanPlanRowInput[] }>();

  const [plan] = await db
    .select()
    .from(longTermLoanPlans)
    .where(eq(longTermLoanPlans.account_id, accountId));

  if (!plan) return c.json({ error: "Plan not found" }, 404);

  const invalidMoneyField = findInvalidMoneyField(
    (body.rows ?? []).flatMap((row, index) => [
      {
        path: `rows[${index}].principal_amount`,
        value: row.principal_amount,
        currency: plan.currency,
        decimalPlaces: decimalPlacesForCurrency(scaleOptions, plan.currency),
      },
      {
        path: `rows[${index}].interest_amount`,
        value: row.interest_amount,
        currency: plan.currency,
        decimalPlaces: decimalPlacesForCurrency(scaleOptions, plan.currency),
      },
    ]),
  );
  if (invalidMoneyField) {
    return c.json(invalidMoneyResponse(invalidMoneyField, plan.currency), 400);
  }

  const now = new Date().toISOString();

  for (const row of body.rows) {
    const [existing] = await db
      .select()
      .from(longTermLoanPlanRows)
      .where(
        and(
          eq(longTermLoanPlanRows.plan_id, plan.id),
          eq(longTermLoanPlanRows.year_month, row.year_month),
        ),
      );

    if (existing) {
      await db
        .update(longTermLoanPlanRows)
        .set({
          principal_amount: toStorageMoneyAmount(
            row.principal_amount,
            plan.currency,
            scaleOptions,
          ),
          interest_amount: toStorageMoneyAmount(
            row.interest_amount,
            plan.currency,
            scaleOptions,
          ),
          note: row.note ?? null,
        })
        .where(eq(longTermLoanPlanRows.id, existing.id));
    } else {
      await db.insert(longTermLoanPlanRows).values({
        plan_id: plan.id,
        year_month: row.year_month,
        principal_amount: toStorageMoneyAmount(
          row.principal_amount,
          plan.currency,
          scaleOptions,
        ),
        interest_amount: toStorageMoneyAmount(
          row.interest_amount,
          plan.currency,
          scaleOptions,
        ),
        note: row.note ?? null,
        created_at: now,
      });
    }
  }

  // Update plan updated_at
  await db
    .update(longTermLoanPlans)
    .set({ updated_at: now })
    .where(eq(longTermLoanPlans.id, plan.id));

  const rows = await db
    .select()
    .from(longTermLoanPlanRows)
    .where(eq(longTermLoanPlanRows.plan_id, plan.id))
    .orderBy(longTermLoanPlanRows.year_month);

  return c.json({
    rows: rows.map((row) => ({
      ...row,
      principal_amount: fromStorageMoneyAmount(
        row.principal_amount,
        plan.currency,
        scaleOptions,
      ),
      interest_amount: fromStorageMoneyAmount(
        row.interest_amount,
        plan.currency,
        scaleOptions,
      ),
    })),
  });
});

// DELETE /api/long-term-loan-plans/:accountId/rows/:yearMonth
longTermLoanPlansRouter.delete("/:accountId/rows/:yearMonth", async (c) => {
  const db = drizzle(c.env.DB);
  const accountId = Number(c.req.param("accountId"));
  const yearMonth = c.req.param("yearMonth");

  const [plan] = await db
    .select()
    .from(longTermLoanPlans)
    .where(eq(longTermLoanPlans.account_id, accountId));

  if (!plan) return c.json({ error: "Plan not found" }, 404);

  await db
    .delete(longTermLoanPlanRows)
    .where(
      and(
        eq(longTermLoanPlanRows.plan_id, plan.id),
        eq(longTermLoanPlanRows.year_month, yearMonth),
      ),
    );

  return c.json({ success: true });
});

// GET /api/long-term-loan-plans/:accountId/comparison
longTermLoanPlansRouter.get("/:accountId/comparison", async (c) => {
  const db = drizzle(c.env.DB);
  const scaleOptions = await loadMoneyScaleOptions(db);
  const accountId = Number(c.req.param("accountId"));

  // Get account type
  const [acct] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId));

  if (!acct) return c.json({ error: "Account not found" }, 404);

  const isAsset = acct.type === "asset";

  // Get plan rows
  const [plan] = await db
    .select()
    .from(longTermLoanPlans)
    .where(eq(longTermLoanPlans.account_id, accountId));

  const planRows = plan
    ? await db
        .select()
        .from(longTermLoanPlanRows)
        .where(eq(longTermLoanPlanRows.plan_id, plan.id))
        .orderBy(longTermLoanPlanRows.year_month)
    : [];

  // Get all journal entries touching this account
  const lines = await db
    .select({
      entryId: journalLines.journal_entry_id,
      debit: journalLines.debit,
      credit: journalLines.credit,
      currency: journalLines.currency,
      accountId: journalLines.account_id,
      accountType: accounts.type,
      date: journalEntries.date,
    })
    .from(journalLines)
    .innerJoin(
      journalEntries,
      eq(journalLines.journal_entry_id, journalEntries.id),
    )
    .innerJoin(accounts, eq(journalLines.account_id, accounts.id))
    .where(eq(journalLines.account_id, accountId));

  // Group by year_month and split principal vs interest
  // For each entry, look at counter-party lines to detect interest
  const entryIds = [...new Set(lines.map((l) => l.entryId))];

  // Fetch all lines for these entries to find interest (expense) lines
  const allLines =
    entryIds.length === 0
      ? []
      : await db
          .select({
            entryId: journalLines.journal_entry_id,
            debit: journalLines.debit,
            credit: journalLines.credit,
            currency: journalLines.currency,
            accountType: accounts.type,
          })
          .from(journalLines)
          .innerJoin(accounts, eq(journalLines.account_id, accounts.id))
          .where(
            // We need to filter by entry IDs - SQLite doesn't support IN with drizzle easily
            // so we do a broader join and filter in JS
            eq(journalLines.account_id, journalLines.account_id), // tautology to keep types
          );

  // Build a map: entryId → interest amount (sum of expense lines in that entry)
  const interestByEntry = new Map<number, number>();
  for (const line of allLines) {
    if (!entryIds.includes(line.entryId)) continue;
    if (line.accountType === "expense") {
      const prev = interestByEntry.get(line.entryId) ?? 0;
      interestByEntry.set(
        line.entryId,
        prev +
          fromStorageMoneyAmount(
            line.debit - line.credit,
            line.currency,
            scaleOptions,
          ),
      );
    }
  }

  // Build actual data by year_month
  const actualByMonth = new Map<
    string,
    { principal: number; interest: number; entryIds: number[] }
  >();

  for (const line of lines) {
    const yearMonth = line.date.slice(0, 7);
    const existing = actualByMonth.get(yearMonth) ?? {
      principal: 0,
      interest: 0,
      entryIds: [],
    };

    // Net change to this account
    const debit = fromStorageMoneyAmount(line.debit, line.currency, scaleOptions);
    const credit = fromStorageMoneyAmount(
      line.credit,
      line.currency,
      scaleOptions,
    );
    const netChange = isAsset ? debit - credit : credit - debit;

    // Repayment/collection = decrease in balance = negative netChange
    const repayment = -netChange;
    if (repayment <= 0) {
      // This is an increase (new borrowing), skip for comparison purposes
      actualByMonth.set(yearMonth, existing);
      continue;
    }

    const interestInEntry = interestByEntry.get(line.entryId) ?? 0;
    const principalRepayment = Math.max(0, repayment - interestInEntry);

    existing.principal += principalRepayment;
    existing.interest += interestInEntry;
    if (!existing.entryIds.includes(line.entryId)) {
      existing.entryIds.push(line.entryId);
    }
    actualByMonth.set(yearMonth, existing);
  }

  // Merge plan rows and actual data into comparison rows
  const allMonths = new Set([
    ...planRows.map((r) => r.year_month),
    ...actualByMonth.keys(),
  ]);

  const comparisonRows: LongTermLoanComparisonRow[] = [...allMonths]
    .sort()
    .map((ym) => {
      const planRow = planRows.find((r) => r.year_month === ym);
      const actual = actualByMonth.get(ym);
      return {
        year_month: ym,
        planned_principal:
          plan && planRow
            ? fromStorageMoneyAmount(
                planRow.principal_amount,
                plan.currency,
                scaleOptions,
              )
            : 0,
        planned_interest:
          plan && planRow
            ? fromStorageMoneyAmount(
                planRow.interest_amount,
                plan.currency,
                scaleOptions,
              )
            : 0,
        actual_principal: actual?.principal ?? 0,
        actual_interest: actual?.interest ?? 0,
        actual_journal_entry_ids: actual?.entryIds ?? [],
      };
    });

  return c.json({ rows: comparisonRows });
});
