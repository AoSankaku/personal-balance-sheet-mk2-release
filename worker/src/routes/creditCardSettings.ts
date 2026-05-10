import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createDb, type Env } from "../db";
import { accounts, creditCardSettings } from "../db/schema";

const router = new Hono<{ Bindings: Env }>();

// GET /api/credit-card-settings — return all rows
router.get("/", async (c) => {
  const db = createDb(c.env);
  const rows = await db.select().from(creditCardSettings);
  return c.json(
    rows.map((row) => ({
      ...row,
      billing_offset_months: row.billing_offset_months ?? 0,
    })),
  );
});

// POST /api/credit-card-settings — upsert by account_id
router.post("/", async (c) => {
  const body = await c.req.json<{
    account_id: number;
    closing_day: number;
    confirmation_day: number;
    withdrawal_day: number;
    billing_offset_months?: number;
    withdrawal_account_id?: number | null;
  }>();

  // closing_day: 0 = end of month, 1-31 = specific day
  const closingDayValid =
    typeof body.closing_day === "number" &&
    (body.closing_day === 0 ||
      (body.closing_day >= 1 && body.closing_day <= 31));
  const billingOffset = body.billing_offset_months ?? 0;
  const billingOffsetValid =
    Number.isInteger(billingOffset) && billingOffset >= 0 && billingOffset <= 12;
  if (
    !body.account_id ||
    !closingDayValid ||
    !body.confirmation_day ||
    !body.withdrawal_day ||
    !billingOffsetValid
  ) {
    return c.json(
      {
        error:
          "account_id, closing_day, confirmation_day, withdrawal_day, and billing_offset_months are required",
      },
      400,
    );
  }

  const db = createDb(c.env);
  const withdrawalAccountId = body.withdrawal_account_id ?? null;

  if (withdrawalAccountId != null) {
    const [withdrawalAccount] = await db
      .select({ id: accounts.id, type: accounts.type })
      .from(accounts)
      .where(eq(accounts.id, withdrawalAccountId));
    if (!withdrawalAccount || withdrawalAccount.type !== "asset") {
      return c.json(
        { error: "withdrawal_account_id must be an asset account" },
        400,
      );
    }
  }

  // Check for existing row
  const existing = await db
    .select()
    .from(creditCardSettings)
    .where(eq(creditCardSettings.account_id, body.account_id));

  let result;
  if (existing.length > 0) {
    const updated = await db
      .update(creditCardSettings)
      .set({
        closing_day: body.closing_day,
        confirmation_day: body.confirmation_day,
        withdrawal_day: body.withdrawal_day,
        billing_offset_months: billingOffset,
        withdrawal_account_id: withdrawalAccountId,
      })
      .where(eq(creditCardSettings.account_id, body.account_id))
      .returning();
    result = updated[0];
  } else {
    const inserted = await db
      .insert(creditCardSettings)
      .values({
        account_id: body.account_id,
        closing_day: body.closing_day,
        confirmation_day: body.confirmation_day,
        withdrawal_day: body.withdrawal_day,
        billing_offset_months: billingOffset,
        withdrawal_account_id: withdrawalAccountId,
      })
      .returning();
    result = inserted[0];
  }

  if (!result)
    return c.json({ error: "Failed to save credit card settings" }, 500);
  return c.json(result, 201);
});

// DELETE /api/credit-card-settings/:account_id
router.delete("/:account_id", async (c) => {
  const accountId = Number(c.req.param("account_id"));
  if (isNaN(accountId)) return c.json({ error: "Invalid account_id" }, 400);

  const db = createDb(c.env);
  await db
    .delete(creditCardSettings)
    .where(eq(creditCardSettings.account_id, accountId));

  return c.json({ success: true });
});

export { router as creditCardSettingsRouter };
