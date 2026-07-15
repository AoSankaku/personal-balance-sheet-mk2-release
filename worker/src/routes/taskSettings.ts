import { Hono } from "hono";
import type {
  TaskSettings,
  UpdateTaskSettingsInput,
} from "@balance-sheet/shared";
import { createDb, type Env } from "../db";
import { taskSettings } from "../db/schema";

const router = new Hono<{ Bindings: Env }>();

const DEFAULT_VALUES = {
  payday_enabled: true,
  credit_card_import_enabled: true,
  trial_balance_enabled: false,
  trial_balance_day: 1,
  credit_card_withdrawal_risk_enabled: true,
  budget_negative_enabled: true,
  loan_overdue_enabled: true,
  loan_overdue_days: 30,
  account_negative_enabled: true,
} satisfies Omit<TaskSettings, "configured" | "updated_at">;

const BOOLEAN_FIELDS = [
  "payday_enabled",
  "credit_card_import_enabled",
  "trial_balance_enabled",
  "credit_card_withdrawal_risk_enabled",
  "budget_negative_enabled",
  "loan_overdue_enabled",
  "account_negative_enabled",
] as const;

type TaskSettingsRow = typeof taskSettings.$inferSelect;

function serialize(row: TaskSettingsRow | undefined): TaskSettings {
  if (!row) {
    return {
      ...DEFAULT_VALUES,
      configured: false,
      updated_at: null,
    };
  }

  return {
    payday_enabled: Boolean(row.payday_enabled),
    credit_card_import_enabled: Boolean(row.credit_card_import_enabled),
    trial_balance_enabled: Boolean(row.trial_balance_enabled),
    trial_balance_day: row.trial_balance_day,
    credit_card_withdrawal_risk_enabled: Boolean(
      row.credit_card_withdrawal_risk_enabled,
    ),
    budget_negative_enabled: Boolean(row.budget_negative_enabled),
    loan_overdue_enabled: Boolean(row.loan_overdue_enabled),
    loan_overdue_days: row.loan_overdue_days,
    account_negative_enabled: Boolean(row.account_negative_enabled),
    configured: true,
    updated_at: row.updated_at,
  };
}

router.get("/", async (c) => {
  const db = createDb(c.env);
  const [row] = await db.select().from(taskSettings);
  return c.json(serialize(row));
});

router.patch("/", async (c) => {
  const parsedBody = await c.req.json<unknown>();
  if (
    parsedBody === null ||
    typeof parsedBody !== "object" ||
    Array.isArray(parsedBody)
  ) {
    return c.json({ error: "request body must be an object" }, 400);
  }
  const body = parsedBody as UpdateTaskSettingsInput;

  for (const field of BOOLEAN_FIELDS) {
    if (field in body && typeof body[field] !== "boolean") {
      return c.json({ error: `${field} must be a boolean` }, 400);
    }
  }
  if (
    "trial_balance_day" in body &&
    (!Number.isInteger(body.trial_balance_day) ||
      body.trial_balance_day! < 1 ||
      body.trial_balance_day! > 31)
  ) {
    return c.json(
      { error: "trial_balance_day must be an integer from 1 to 31" },
      400,
    );
  }
  if (
    "loan_overdue_days" in body &&
    (!Number.isInteger(body.loan_overdue_days) ||
      body.loan_overdue_days! < 1 ||
      body.loan_overdue_days! > 3650)
  ) {
    return c.json(
      { error: "loan_overdue_days must be an integer from 1 to 3650" },
      400,
    );
  }

  const db = createDb(c.env);
  const [currentRow] = await db.select().from(taskSettings);
  const current = serialize(currentRow);
  const merged = { ...current, ...body };
  const updatedAt = new Date().toISOString();
  const values: TaskSettingsRow = {
    id: 1,
    payday_enabled: merged.payday_enabled ? 1 : 0,
    credit_card_import_enabled: merged.credit_card_import_enabled ? 1 : 0,
    trial_balance_enabled: merged.trial_balance_enabled ? 1 : 0,
    trial_balance_day: merged.trial_balance_day,
    credit_card_withdrawal_risk_enabled:
      merged.credit_card_withdrawal_risk_enabled ? 1 : 0,
    budget_negative_enabled: merged.budget_negative_enabled ? 1 : 0,
    loan_overdue_enabled: merged.loan_overdue_enabled ? 1 : 0,
    loan_overdue_days: merged.loan_overdue_days,
    account_negative_enabled: merged.account_negative_enabled ? 1 : 0,
    updated_at: updatedAt,
  };

  await db
    .insert(taskSettings)
    .values(values)
    .onConflictDoUpdate({
      target: taskSettings.id,
      set: values,
    });

  return c.json(serialize(values));
});

export { router as taskSettingsRouter };
