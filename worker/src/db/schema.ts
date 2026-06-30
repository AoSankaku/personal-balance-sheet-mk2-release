import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type", {
    enum: ["asset", "liability", "equity", "income", "expense"],
  }).notNull(),
  category: text("category", {
    enum: [
      "cash",
      "investment",
      "property",
      "crypto",
      "lending",
      "short_term_lending",
      "long_term_lending",
      "loan",
      "long_term_loan",
      "credit_card",
      "short_term_loan",
      "opening_balance",
      "salary",
      "business",
      "food",
      "rent",
      "transport",
      "utilities",
      "entertainment",
      "daily_goods",
      "social",
      "investment_loss",
      "business_advance",
      "other",
    ],
  }).notNull(),
  payday: integer("payday"),
  /** 1 = this asset account is a depreciable item (備品等) */
  is_depreciable: integer("is_depreciable").notNull().default(0),
  /** 1 = this cash/bank asset account is counted as allocatable budget money */
  include_in_allocatable: integer("include_in_allocatable")
    .notNull()
    .default(1),
  /** 1 = special system account (不明金/雑損/雑益); not editable or deletable by users */
  is_system: integer("is_system").notNull().default(0),
  created_at: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const journalEntries = sqliteTable("journal_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  description: text("description").notNull(),
  /** Origin of this entry: 'manual' (direct input) or 'csv_import' (batch CSV import) */
  source: text("source", { enum: ["manual", "csv_import"] }),
  created_at: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
}, (table) => ({
  dateIdIdx: index("idx_journal_entries_date_id").on(table.date, table.id),
}));

export const journalLines = sqliteTable("journal_lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  journal_entry_id: integer("journal_entry_id")
    .notNull()
    .references(() => journalEntries.id, { onDelete: "cascade" }),
  account_id: integer("account_id")
    .notNull()
    .references(() => accounts.id),
  debit: integer("debit").notNull().default(0),
  credit: integer("credit").notNull().default(0),
  currency: text("currency").notNull().default("JPY"),
  /** NULL = default billing cycle; 0 = next month; 1 = 2 months later, etc. */
  credit_card_billing_offset_months: integer(
    "credit_card_billing_offset_months",
  ),
  created_at: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
}, (table) => ({
  entryIdx: index("idx_journal_lines_entry").on(table.journal_entry_id),
  accountEntryIdx: index("idx_journal_lines_account_entry").on(
    table.account_id,
    table.journal_entry_id,
  ),
  currencyAccountIdx: index("idx_journal_lines_currency_account").on(
    table.currency,
    table.account_id,
  ),
  debitInteger: check(
    "chk_journal_lines_debit_integer",
    sql`typeof(${table.debit}) = 'integer'`,
  ),
  creditInteger: check(
    "chk_journal_lines_credit_integer",
    sql`typeof(${table.credit}) = 'integer'`,
  ),
}));

export const cryptoWallets = sqliteTable("crypto_wallets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  account_id: integer("account_id")
    .notNull()
    .unique()
    .references(() => accounts.id, { onDelete: "cascade" }),
  address: text("address").notNull(),
  chain: text("chain", {
    enum: ["eth", "btc", "sol", "skr", "binance"],
  }).notNull(),
  created_at: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const exchangeCredentials = sqliteTable("exchange_credentials", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  exchange: text("exchange").notNull().unique(),
  api_key: text("api_key").notNull(),
  api_secret: text("api_secret").notNull(),
  created_at: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const budgetCategories = sqliteTable("budget_categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  sort_order: integer("sort_order").notNull().default(0),
  rollover_months: integer("rollover_months").notNull().default(2),
  budget_group: text("budget_group").notNull().default("日常支出"),
  goal_balance: integer("goal_balance"),
  balance_cap: integer("balance_cap"),
  overflow_budget_category_id: integer("overflow_budget_category_id"),
  is_archived: integer("is_archived").notNull().default(0),
  created_at: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
}, (table) => ({
  goalBalanceInteger: check(
    "chk_budget_categories_goal_balance_integer",
    sql`${table.goal_balance} IS NULL OR typeof(${table.goal_balance}) = 'integer'`,
  ),
  balanceCapInteger: check(
    "chk_budget_categories_balance_cap_integer",
    sql`${table.balance_cap} IS NULL OR typeof(${table.balance_cap}) = 'integer'`,
  ),
}));

export const budgetCategoryAccounts = sqliteTable("budget_category_accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  budget_category_id: integer("budget_category_id")
    .notNull()
    .references(() => budgetCategories.id, { onDelete: "cascade" }),
  account_id: integer("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  // Percentage (0-100) of this expense account's spending that counts toward this category.
  // Managed from the expense account side (AddAccountModal).
  ratio: real("ratio").notNull().default(100),
}, (table) => ({
  uniqueCategoryAccount: uniqueIndex("idx_budget_category_accounts_unique").on(
    table.budget_category_id,
    table.account_id,
  ),
}));

export const budgetCategoryAccountTargets = sqliteTable(
  "budget_category_account_targets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    budget_category_id: integer("budget_category_id")
      .notNull()
      .references(() => budgetCategories.id, { onDelete: "cascade" }),
    account_id: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    ratio: real("ratio").notNull().default(100),
  },
);

export const budgetAllocations = sqliteTable("budget_allocations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  budget_category_id: integer("budget_category_id")
    .notNull()
    .references(() => budgetCategories.id, { onDelete: "cascade" }),
  year_month: text("year_month").notNull(),
  currency: text("currency").notNull().default("JPY"),
  fixed_amount: integer("fixed_amount").notNull().default(0),
  income_ratio: real("income_ratio").notNull().default(0),
  adhoc_amount: integer("adhoc_amount").notNull().default(0),
  created_at: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
}, (table) => ({
  uniqueCategoryMonthCurrency: uniqueIndex(
    "idx_budget_allocations_category_month_currency_unique",
  ).on(table.budget_category_id, table.year_month, table.currency),
  fixedAmountInteger: check(
    "chk_budget_allocations_fixed_amount_integer",
    sql`typeof(${table.fixed_amount}) = 'integer'`,
  ),
  adhocAmountInteger: check(
    "chk_budget_allocations_adhoc_amount_integer",
    sql`typeof(${table.adhoc_amount}) = 'integer'`,
  ),
}));

export const budgetFilters = sqliteTable("budget_filters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  is_active: integer("is_active").notNull().default(1),
  currency: text("currency").notNull().default("JPY"),
  created_at: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const budgetFilterSteps = sqliteTable("budget_filter_steps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  filter_id: integer("filter_id")
    .notNull()
    .references(() => budgetFilters.id, { onDelete: "cascade" }),
  step_order: integer("step_order").notNull(),
  step_type: text("step_type", {
    enum: ["fixed", "capped", "remainder"],
  }).notNull(),
  created_at: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
}, (table) => ({
  uniqueFilterStepOrder: uniqueIndex(
    "idx_budget_filter_steps_order_unique",
  ).on(table.filter_id, table.step_order),
}));

export const budgetFilterStepAllocations = sqliteTable(
  "budget_filter_step_allocations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    step_id: integer("step_id")
      .notNull()
      .references(() => budgetFilterSteps.id, { onDelete: "cascade" }),
    budget_category_id: integer("budget_category_id")
      .notNull()
      .references(() => budgetCategories.id),
    amount: integer("amount"),
    ratio: real("ratio"),
    created_at: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    amountInteger: check(
      "chk_budget_filter_step_allocations_amount_integer",
      sql`${table.amount} IS NULL OR typeof(${table.amount}) = 'integer'`,
    ),
  }),
);

export const journalEntryBudgetAllocations = sqliteTable(
  "journal_entry_budget_allocations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    journal_entry_id: integer("journal_entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    budget_category_id: integer("budget_category_id")
      .notNull()
      .references(() => budgetCategories.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull().default(0),
    currency: text("currency").notNull().default("JPY"),
    source: text("source"),
    created_at: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    amountInteger: check(
      "chk_journal_entry_budget_allocations_amount_integer",
      sql`typeof(${table.amount}) = 'integer'`,
    ),
  }),
);

export const budgetAdjustmentLogs = sqliteTable("budget_adjustment_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  budget_category_id: integer("budget_category_id")
    .notNull()
    .references(() => budgetCategories.id, { onDelete: "cascade" }),
  year_month: text("year_month").notNull(),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull().default("JPY"),
  date: text("date").notNull(),
  adjustment_type: text("adjustment_type").notNull().default("allocation"),
  note: text("note"),
  // Nullable: links income journal entries to their budget allocations
  journal_entry_id: integer("journal_entry_id").references(
    () => journalEntries.id,
    { onDelete: "cascade" },
  ),
  created_at: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
}, (table) => ({
  amountInteger: check(
    "chk_budget_adjustment_logs_amount_integer",
    sql`typeof(${table.amount}) = 'integer'`,
  ),
}));

export const budgetSettings = sqliteTable("budget_settings", {
  id: integer("id").primaryKey(),
  // Ordered JSON array of account IDs (up to 5)
  preferred_payment_account_ids: text("preferred_payment_account_ids"),
  // Ordered JSON array of filter IDs (up to 5) shown first in income entry dropdown
  preferred_filter_ids: text("preferred_filter_ids"),
  // Business owner advance settings (個人事業主用立替設定)
  is_business_owner: integer("is_business_owner").notNull().default(0),
  // Default asset account for recording business expense advances (事業立替金科目)
  business_advance_account_id: integer(
    "business_advance_account_id",
  ).references(() => accounts.id),
  // Expense account to use when disposing advance as a loss (損失として破棄する場合の科目)
  business_loss_account_id: integer("business_loss_account_id").references(
    () => accounts.id,
  ),
  // Budget category to deduct business advance amounts from (事業立替金の予算元)
  business_advance_budget_category_id: integer(
    "business_advance_budget_category_id",
  ).references(() => budgetCategories.id),
});

export const storeAccountMappings = sqliteTable("store_account_mappings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  store_name: text("store_name").notNull().unique(),
  account_id: integer("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  created_at: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const depreciationSchedules = sqliteTable("depreciation_schedules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source_journal_entry_id: integer("source_journal_entry_id")
    .notNull()
    .references(() => journalEntries.id, { onDelete: "cascade" }),
  asset_account_id: integer("asset_account_id")
    .notNull()
    .references(() => accounts.id),
  expense_account_id: integer("expense_account_id")
    .notNull()
    .references(() => accounts.id),
  total_amount: integer("total_amount").notNull(),
  months: integer("months").notNull(),
  start_date: text("start_date").notNull(),
  description: text("description").notNull().default(""),
  created_at: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
}, (table) => ({
  totalAmountInteger: check(
    "chk_depreciation_schedules_total_amount_integer",
    sql`typeof(${table.total_amount}) = 'integer'`,
  ),
}));

export const depreciationEntries = sqliteTable("depreciation_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  schedule_id: integer("schedule_id")
    .notNull()
    .references(() => depreciationSchedules.id, { onDelete: "cascade" }),
  journal_entry_id: integer("journal_entry_id")
    .notNull()
    .references(() => journalEntries.id, { onDelete: "cascade" }),
  month_number: integer("month_number").notNull(),
  created_at: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const actualBalanceSnapshots = sqliteTable("actual_balance_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  snapshot_date: text("snapshot_date").notNull(),
  /** Optional HH:MM time label for display (e.g. "14:30") */
  snapshot_time: text("snapshot_time"),
  created_at: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const actualBalanceEntries = sqliteTable("actual_balance_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  snapshot_id: integer("snapshot_id")
    .notNull()
    .references(() => actualBalanceSnapshots.id, { onDelete: "cascade" }),
  account_id: integer("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  created_at: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
}, (table) => ({
  uniqueSnapshotAccount: uniqueIndex("idx_actual_balance_entries_unique").on(
    table.snapshot_id,
    table.account_id,
  ),
  amountInteger: check(
    "chk_actual_balance_entries_amount_integer",
    sql`typeof(${table.amount}) = 'integer'`,
  ),
}));

export const actualBalanceCreditCardState = sqliteTable(
  "actual_balance_credit_card_state",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    account_id: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    payment_month: text("payment_month").notNull(),
    status: text("status", { enum: ["open", "confirmed", "paid"] }).notNull(),
    amount: integer("amount").notNull(),
    last_updated_at: text("last_updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    uniqueAccountPaymentMonth: uniqueIndex(
      "idx_actual_balance_credit_card_state_account_month_unique",
    ).on(table.account_id, table.payment_month),
    amountInteger: check(
      "chk_actual_balance_credit_card_state_amount_integer",
      sql`typeof(${table.amount}) = 'integer'`,
    ),
  }),
);

export const creditCardSettings = sqliteTable("credit_card_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  account_id: integer("account_id")
    .notNull()
    .unique()
    .references(() => accounts.id, { onDelete: "cascade" }),
  closing_day: integer("closing_day").notNull(),
  confirmation_day: integer("confirmation_day").notNull(),
  withdrawal_day: integer("withdrawal_day").notNull(),
  billing_offset_months: integer("billing_offset_months").notNull().default(0),
  withdrawal_account_id: integer("withdrawal_account_id").references(
    () => accounts.id,
    { onDelete: "set null" },
  ),
  created_at: text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ','now'))`),
});

export const loanSettlements = sqliteTable("loan_settlements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  journal_entry_id: integer("journal_entry_id")
    .notNull()
    .references(() => journalEntries.id, { onDelete: "cascade" }),
  settled_by_journal_entry_id: integer(
    "settled_by_journal_entry_id",
  ).references(() => journalEntries.id, { onDelete: "set null" }),
  is_settled: integer("is_settled").notNull().default(0),
  settled_at: text("settled_at"),
  created_at: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
}, (table) => ({
  uniqueEntry: uniqueIndex("idx_loan_settlements_entry_unique").on(
    table.journal_entry_id,
  ),
}));

export const accountCompletions = sqliteTable("account_completions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  account_id: integer("account_id")
    .notNull()
    .unique()
    .references(() => accounts.id, { onDelete: "cascade" }),
  completed_at: text("completed_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const longTermLoanPlans = sqliteTable("long_term_loan_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  account_id: integer("account_id")
    .notNull()
    .unique()
    .references(() => accounts.id, { onDelete: "cascade" }),
  note: text("note"),
  currency: text("currency").notNull().default("JPY"),
  total_principal: integer("total_principal"),
  annual_interest_rate: real("annual_interest_rate"),
  monthly_payment: integer("monthly_payment"),
  start_year_month: text("start_year_month"),
  created_at: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updated_at: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
}, (table) => ({
  totalPrincipalInteger: check(
    "chk_long_term_loan_plans_total_principal_integer",
    sql`${table.total_principal} IS NULL OR typeof(${table.total_principal}) = 'integer'`,
  ),
  monthlyPaymentInteger: check(
    "chk_long_term_loan_plans_monthly_payment_integer",
    sql`${table.monthly_payment} IS NULL OR typeof(${table.monthly_payment}) = 'integer'`,
  ),
}));

export const longTermLoanPlanRows = sqliteTable("long_term_loan_plan_rows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  plan_id: integer("plan_id")
    .notNull()
    .references(() => longTermLoanPlans.id, { onDelete: "cascade" }),
  year_month: text("year_month").notNull(),
  principal_amount: integer("principal_amount").notNull().default(0),
  interest_amount: integer("interest_amount").notNull().default(0),
  note: text("note"),
  created_at: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
}, (table) => ({
  uniquePlanMonth: uniqueIndex(
    "idx_long_term_loan_plan_rows_plan_month_unique",
  ).on(table.plan_id, table.year_month),
  principalAmountInteger: check(
    "chk_long_term_loan_plan_rows_principal_amount_integer",
    sql`typeof(${table.principal_amount}) = 'integer'`,
  ),
  interestAmountInteger: check(
    "chk_long_term_loan_plan_rows_interest_amount_integer",
    sql`typeof(${table.interest_amount}) = 'integer'`,
  ),
}));

export const enabledCurrencies = sqliteTable("enabled_currencies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  sort_order: integer("sort_order").notNull().default(0),
  symbol_priority: integer("symbol_priority").notNull().default(0),
  custom_symbol: text("custom_symbol"),
  custom_icon: text("custom_icon"),
  background_color: text("background_color"),
  decimal_places: integer("decimal_places").notNull().default(2),
  created_at: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
}, (table) => ({
  decimalPlacesRange: check(
    "chk_enabled_currencies_decimal_places_range",
    sql`${table.decimal_places} BETWEEN 0 AND 9`,
  ),
}));

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type NewJournalEntry = typeof journalEntries.$inferInsert;
export type JournalLine = typeof journalLines.$inferSelect;
export type NewJournalLine = typeof journalLines.$inferInsert;
export type CryptoWallet = typeof cryptoWallets.$inferSelect;
export type NewCryptoWallet = typeof cryptoWallets.$inferInsert;
export type BudgetCategory = typeof budgetCategories.$inferSelect;
export type NewBudgetCategory = typeof budgetCategories.$inferInsert;
export type BudgetCategoryAccount = typeof budgetCategoryAccounts.$inferSelect;
export type BudgetCategoryAccountTarget =
  typeof budgetCategoryAccountTargets.$inferSelect;
export type BudgetAllocation = typeof budgetAllocations.$inferSelect;
export type NewBudgetAllocation = typeof budgetAllocations.$inferInsert;
export type BudgetFilter = typeof budgetFilters.$inferSelect;
export type NewBudgetFilter = typeof budgetFilters.$inferInsert;
export type BudgetFilterStep = typeof budgetFilterSteps.$inferSelect;
export type NewBudgetFilterStep = typeof budgetFilterSteps.$inferInsert;
export type BudgetFilterStepAllocation =
  typeof budgetFilterStepAllocations.$inferSelect;
export type JournalEntryBudgetAllocation =
  typeof journalEntryBudgetAllocations.$inferSelect;
export type BudgetAdjustmentLog = typeof budgetAdjustmentLogs.$inferSelect;
export type NewBudgetAdjustmentLog = typeof budgetAdjustmentLogs.$inferInsert;
export type BudgetSettings = typeof budgetSettings.$inferSelect;
export type CreditCardSettingsRow = typeof creditCardSettings.$inferSelect;
export type NewCreditCardSettings = typeof creditCardSettings.$inferInsert;
export type StoreAccountMapping = typeof storeAccountMappings.$inferSelect;
export type NewStoreAccountMapping = typeof storeAccountMappings.$inferInsert;
export type DepreciationSchedule = typeof depreciationSchedules.$inferSelect;
export type NewDepreciationSchedule = typeof depreciationSchedules.$inferInsert;
export type DepreciationEntry = typeof depreciationEntries.$inferSelect;
export type NewDepreciationEntry = typeof depreciationEntries.$inferInsert;
export type ActualBalanceSnapshot = typeof actualBalanceSnapshots.$inferSelect;
export type NewActualBalanceSnapshot =
  typeof actualBalanceSnapshots.$inferInsert;
export type ActualBalanceEntry = typeof actualBalanceEntries.$inferSelect;
export type NewActualBalanceEntry = typeof actualBalanceEntries.$inferInsert;
export type ActualBalanceCreditCardState =
  typeof actualBalanceCreditCardState.$inferSelect;
export type NewActualBalanceCreditCardState =
  typeof actualBalanceCreditCardState.$inferInsert;
export type LoanSettlement = typeof loanSettlements.$inferSelect;
export type NewLoanSettlement = typeof loanSettlements.$inferInsert;
export type AccountCompletion = typeof accountCompletions.$inferSelect;
export type NewAccountCompletion = typeof accountCompletions.$inferInsert;
export type EnabledCurrencyRow = typeof enabledCurrencies.$inferSelect;
export type NewEnabledCurrencyRow = typeof enabledCurrencies.$inferInsert;
export type LongTermLoanPlan = typeof longTermLoanPlans.$inferSelect;
export type NewLongTermLoanPlan = typeof longTermLoanPlans.$inferInsert;
export type LongTermLoanPlanRow = typeof longTermLoanPlanRows.$inferSelect;
export type NewLongTermLoanPlanRow = typeof longTermLoanPlanRows.$inferInsert;
