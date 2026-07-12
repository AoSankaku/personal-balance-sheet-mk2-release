import { eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  creditCardBillingOffsetMonths,
  resolveCreditCardMonthDay,
  shiftCreditCardMonth,
  type CompleteCreditCardStatementInput,
} from "@balance-sheet/shared";
import { createDb, type Env } from "../db";
import {
  creditCardSettings,
  creditCardStatementCompletions,
} from "../db/schema";
import { toLocalDateString } from "../lib/appDate";

const router = new Hono<{ Bindings: Env }>();

router.get("/completions", async (c) => {
  const db = createDb(c.env);
  return c.json(await db.select().from(creditCardStatementCompletions));
});

router.post("/completions", async (c) => {
  const body = await c.req.json<CompleteCreditCardStatementInput>();
  if (
    !Number.isInteger(body.account_id) ||
    !/^\d{4}-\d{2}$/.test(body.statement_month ?? "") ||
    !/^\d{4}-\d{2}$/.test(body.payment_month ?? "") ||
    !["csv_import", "zero_amount"].includes(body.completion_method)
  ) {
    return c.json({ error: "invalid_statement_completion" }, 400);
  }

  const db = createDb(c.env);
  const [settings] = await db
    .select()
    .from(creditCardSettings)
    .where(eq(creditCardSettings.account_id, body.account_id));
  if (!settings) {
    return c.json({ error: "credit_card_settings_required" }, 409);
  }

  const today = toLocalDateString();
  const paymentMonth = today.slice(0, 7);
  const confirmationDay = resolveCreditCardMonthDay(
    paymentMonth,
    settings.confirmation_day,
  );
  const expectedStatementMonth = shiftCreditCardMonth(
    paymentMonth,
    -creditCardBillingOffsetMonths(settings),
  );
  if (
    Number(today.slice(8, 10)) < confirmationDay ||
    body.payment_month !== paymentMonth ||
    body.statement_month !== expectedStatementMonth
  ) {
    return c.json({ error: "statement_not_ready" }, 409);
  }

  const [completion] = await db
    .insert(creditCardStatementCompletions)
    .values(body)
    .onConflictDoUpdate({
      target: [
        creditCardStatementCompletions.account_id,
        creditCardStatementCompletions.statement_month,
      ],
      set: {
        payment_month: body.payment_month,
        completion_method: body.completion_method,
        completed_at: new Date().toISOString().replace("T", " ").slice(0, 19),
      },
    })
    .returning();

  if (!completion) {
    return c.json({ error: "statement_completion_failed" }, 500);
  }
  return c.json(completion, 201);
});

export { router as creditCardStatementsRouter };
