import { count, eq, like, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createDb, type Env } from "../db";
import { exportD1ToSQLite } from "../lib/exportSqlite";
import {
  accounts,
  budgetAdjustmentLogs,
  budgetAllocations,
  budgetCategories,
  budgetFilterStepAllocations,
  budgetFilters,
  budgetSettings,
  enabledCurrencies,
  exchangeCredentials,
  journalEntries,
} from "../db/schema";

const router = new Hono<{ Bindings: Env }>();

type EraseScope =
  | "ledger_this_month"
  | "ledger_this_year"
  | "ledger_all"
  | "accounts_all"
  | "budget_categories_all"
  | "all_data";

async function existingColumns(
  db: ReturnType<typeof createDb>,
  tableName: string,
): Promise<Set<string>> {
  const rows = await db.all<{ name: string }>(
    sql.raw(`PRAGMA table_info(${tableName})`),
  );
  return new Set(rows.map((row) => row.name));
}

async function clearBudgetSettingsRefs(
  db: ReturnType<typeof createDb>,
  columns: string[],
) {
  const existing = await existingColumns(db, "budget_settings");
  const setClauses = columns
    .filter((column) => existing.has(column))
    .map((column) => `${column} = NULL`);

  if (setClauses.length === 0) return;

  await db.run(sql.raw(`UPDATE budget_settings SET ${setClauses.join(", ")}`));
}

// POST /api/admin/erase — bulk-delete data by scope
async function runEraseStep<T>(
  context: { currentStep: string },
  step: string,
  action: () => Promise<T>,
): Promise<T> {
  context.currentStep = step;
  return action();
}

router.post("/erase", async (c) => {
  const context = { currentStep: "parse_request" };
  try {
    const body = await c.req.json<{ scope: EraseScope }>();
    const { scope } = body;

    if (
      ![
        "ledger_this_month",
        "ledger_this_year",
        "ledger_all",
        "accounts_all",
        "budget_categories_all",
        "all_data",
      ].includes(scope)
    ) {
      return c.json({ error: "Invalid scope" }, 400);
    }

    const db = createDb(c.env);

    // Current date context (server time)
    const now = new Date();
    const yearMonth = now.toISOString().slice(0, 7); // YYYY-MM
    const year = yearMonth.slice(0, 4); // YYYY

    switch (scope) {
      case "ledger_this_month": {
        // Delete budget runtime data for this month first
        await db
          .delete(budgetAdjustmentLogs)
          .where(sql`${budgetAdjustmentLogs.year_month} = ${yearMonth}`);
        await db
          .delete(budgetAllocations)
          .where(sql`${budgetAllocations.year_month} = ${yearMonth}`);
        // Delete journal entries (cascades: journal_lines, journal_entry_budget_allocations)
        await db
          .delete(journalEntries)
          .where(like(journalEntries.date, `${yearMonth}-%`));
        break;
      }
      case "ledger_this_year": {
        await db
          .delete(budgetAdjustmentLogs)
          .where(like(budgetAdjustmentLogs.year_month, `${year}-%`));
        await db
          .delete(budgetAllocations)
          .where(like(budgetAllocations.year_month, `${year}-%`));
        await db
          .delete(journalEntries)
          .where(like(journalEntries.date, `${year}-%`));
        break;
      }
      case "ledger_all": {
        await db.delete(budgetAdjustmentLogs);
        await db.delete(budgetAllocations);
        await db.delete(journalEntries); // cascades lines + journal_entry_budget_allocations
        break;
      }
      case "accounts_all": {
        await clearBudgetSettingsRefs(db, [
          "preferred_payment_account_ids",
          "business_advance_account_id",
          "business_loss_account_id",
        ]);
        // journal_lines.account_id has no onDelete cascade, so delete entries first
        await db.delete(journalEntries); // cascades journal_lines + budget allocations
        await db.delete(accounts).where(eq(accounts.is_system, 0)); // cascades: budget_category_accounts, crypto_wallets, credit_card_settings; preserve system accounts
        break;
      }
      case "budget_categories_all": {
        await clearBudgetSettingsRefs(db, [
          "business_advance_budget_category_id",
        ]);
        // budget_filter_step_allocations.budget_category_id has no onDelete cascade
        await db.delete(budgetFilterStepAllocations);
        await db.delete(budgetCategories); // cascades: budget_category_accounts, budget_allocations, journal_entry_budget_allocations, budget_adjustment_logs
        break;
      }
      case "all_data": {
        // Clear settings references before deleting referenced accounts/categories.
        await clearBudgetSettingsRefs(db, [
          "preferred_payment_account_ids",
          "preferred_filter_ids",
          "business_advance_account_id",
          "business_loss_account_id",
          "business_advance_budget_category_id",
        ]);
        // Order: children before parents for tables without cascade
        await db.delete(journalEntries); // cascades journal_lines, journal_entry_budget_allocations, budget_adjustment_logs (with journal_entry_id)
        await db.delete(budgetAdjustmentLogs); // remaining manual adjustments
        await db.delete(budgetFilterStepAllocations); // no cascade from budget_categories
        await db.delete(budgetCategories); // cascades: budget_category_accounts, budget_allocations
        await db.delete(budgetFilters); // cascades: filter_steps, step_allocations (already gone)
        await db.delete(accounts).where(eq(accounts.is_system, 0)); // cascades: crypto_wallets, credit_card_settings; preserve system accounts
        await db.delete(enabledCurrencies);
        await db.delete(exchangeCredentials);
        break;
      }
    }

    return c.json({ ok: true, scope });
  } catch (error) {
    return c.json(
      {
        error: "erase_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});

type SeedLocale = "en" | "ja" | "es" | "fr" | "zh-CN" | "zh-TW";

const SUPPORTED_SEED_LOCALES: SeedLocale[] = [
  "ja",
  "en",
  "es",
  "fr",
  "zh-CN",
  "zh-TW",
];

const SYSTEM_ACCOUNTS: {
  name: string;
  type: (typeof accounts.$inferInsert)["type"];
  category: (typeof accounts.$inferInsert)["category"];
}[] = [
  { name: "__system:unknown_funds__", type: "asset", category: "other" },
  { name: "__system:misc_expense__", type: "expense", category: "other" },
  { name: "__system:misc_income__", type: "income", category: "other" },
  { name: "__system:securities_gain__", type: "income", category: "investment" },
  { name: "__system:securities_loss__", type: "expense", category: "investment_loss" },
  { name: "__system:crypto_gain__", type: "income", category: "investment" },
  { name: "__system:crypto_loss__", type: "expense", category: "investment_loss" },
  { name: "__system:property_gain__", type: "income", category: "other" },
  { name: "__system:property_loss__", type: "expense", category: "other" },
  { name: "__system:opening_balance__", type: "equity", category: "opening_balance" },
  { name: "__system:bad_debt_loss__", type: "expense", category: "other" },
];

const SEED_ACCOUNTS: {
  name: Record<SeedLocale, string>;
  type: (typeof accounts.$inferInsert)["type"];
  category: (typeof accounts.$inferInsert)["category"];
}[] = [
  {
    name: {
      ja: "XX銀行預金",
      en: "XX Bank Savings",
      es: "Ahorros XX Bank",
      fr: "Épargne XX Bank",
      "zh-CN": "XX银行存款",
      "zh-TW": "XX銀行存款",
    },
    type: "asset",
    category: "cash",
  },
  {
    name: {
      ja: "友人貸付",
      en: "Loan to Friends",
      es: "Préstamo a Amigos",
      fr: "Prêt à des Amis",
      "zh-CN": "朋友借款",
      "zh-TW": "朋友借款",
    },
    type: "asset",
    category: "lending",
  },
  {
    name: {
      ja: "友人借入",
      en: "Loan from Friends",
      es: "Préstamo de Amigos",
      fr: "Emprunt à des Amis",
      "zh-CN": "向朋友借款",
      "zh-TW": "向朋友借款",
    },
    type: "liability",
    category: "short_term_loan",
  },
  {
    name: {
      ja: "XXクレジットカード",
      en: "XX Credit Card",
      es: "XX Tarjeta de Crédito",
      fr: "XX Carte de Crédit",
      "zh-CN": "XX信用卡",
      "zh-TW": "XX信用卡",
    },
    type: "liability",
    category: "credit_card",
  },
  {
    name: {
      ja: "元入金",
      en: "Opening Balance",
      es: "Saldo Inicial",
      fr: "Solde d'ouverture",
      "zh-CN": "期初余额",
      "zh-TW": "期初餘額",
    },
    type: "equity",
    category: "opening_balance",
  },
  {
    name: {
      ja: "給料",
      en: "Salary",
      es: "Salario",
      fr: "Salaire",
      "zh-CN": "工资",
      "zh-TW": "工資",
    },
    type: "income",
    category: "salary",
  },
  {
    name: {
      ja: "臨時収入",
      en: "Occasional Income",
      es: "Ingresos Ocasionales",
      fr: "Revenus Occasionnels",
      "zh-CN": "临时收入",
      "zh-TW": "臨時收入",
    },
    type: "income",
    category: "other",
  },
  {
    name: {
      ja: "食費",
      en: "Food",
      es: "Comida",
      fr: "Nourriture",
      "zh-CN": "餐饮费",
      "zh-TW": "餐飲費",
    },
    type: "expense",
    category: "food",
  },
  {
    name: {
      ja: "住居費",
      en: "Housing",
      es: "Vivienda",
      fr: "Logement",
      "zh-CN": "居住费",
      "zh-TW": "居住費",
    },
    type: "expense",
    category: "rent",
  },
];

// POST /api/admin/seed — insert default accounts (only if accounts table is empty)
router.post("/seed", async (c) => {
  const body = await c.req.json<{ locale?: string }>().catch(() => ({}));
  const locale: SeedLocale =
    typeof body.locale === "string" &&
    SUPPORTED_SEED_LOCALES.includes(body.locale as SeedLocale)
      ? (body.locale as SeedLocale)
      : "en";

  const db = createDb(c.env);

  // Only seed default accounts if the table has no regular accounts
  const [{ total }] = await db
    .select({ total: count() })
    .from(accounts)
    .where(eq(accounts.is_system, 0));

  if (Number(total) > 0) {
    return c.json({ ok: true, skipped: true });
  }

  // Reset system accounts: delete existing rows, then insert fresh ones.
  // This prevents multiplication across repeated seed calls and resets any
  // system-account state (amounts, allocation flags, etc.).
  // Safe here because journal entries have already been deleted by the
  // preceding erase step when this endpoint is used in the reset flow.
  await db.delete(accounts).where(eq(accounts.is_system, 1));
  await db
    .insert(accounts)
    .values(
      SYSTEM_ACCOUNTS.map((a) => ({
        name: a.name,
        type: a.type,
        category: a.category,
        currency: "JPY",
        is_system: 1,
        include_in_allocatable: 0,
      })),
    );

  const inserted = await db
    .insert(accounts)
    .values(
      SEED_ACCOUNTS.map((a) => ({
        name: a.name[locale],
        type: a.type,
        category: a.category,
        currency: "JPY",
      })),
    )
    .returning({ id: accounts.id });

  return c.json({ ok: true, created: inserted.length });
});

// GET /api/admin/export-db — rebuild and download a SQLite-compatible file
router.get("/export-db", async (c) => {
  const buffer = await exportD1ToSQLite(c.env.DB);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/x-sqlite3",
      "Content-Disposition": `attachment; filename="balance-sheet-${date}.sqlite"`,
    },
  });
});

export { router as adminRouter };
