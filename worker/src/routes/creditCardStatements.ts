import { eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  paymentMonthForStatementMonth,
  resolveCreditCardMonthDay,
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
    !["csv_import", "zero_amount", "manual_confirmation"].includes(
      body.completion_method,
    )
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
  const paymentMonth = paymentMonthForStatementMonth(
    body.statement_month,
    settings,
  );
  const confirmationDay = resolveCreditCardMonthDay(
    paymentMonth,
    settings.confirmation_day,
  );
  const confirmationDate = `${paymentMonth}-${String(confirmationDay).padStart(2, "0")}`;
  const settingsCreationMonth = settings.created_at.slice(0, 7);
  const existingCompletions = await db
    .select()
    .from(creditCardStatementCompletions)
    .where(eq(creditCardStatementCompletions.account_id, body.account_id));
  const latestCompletedStatementMonth = existingCompletions.reduce<
    string | null
  >(
    (latest, completion) =>
      latest === null || completion.statement_month > latest
        ? completion.statement_month
        : latest,
    null,
  );
  if (
    today < confirmationDate ||
    body.payment_month !== paymentMonth ||
    body.statement_month < settingsCreationMonth ||
    (latestCompletedStatementMonth !== null &&
      body.statement_month <= latestCompletedStatementMonth)
  ) {
    return c.json({ error: "statement_not_ready" }, 409);
  }

  const [completion] = await db
    .insert(creditCardStatementCompletions)
    .values(body)
    .onConflictDoNothing()
    .returning();

  if (!completion) {
    return c.json({ error: "statement_already_completed" }, 409);
  }
  return c.json(completion, 201);
});

export { router as creditCardStatementsRouter };
