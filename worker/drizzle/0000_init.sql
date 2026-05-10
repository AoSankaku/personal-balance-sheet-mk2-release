-- Consolidated canonical schema for personal-balance-sheet-mk2.
-- Keep migrations in this repository as a single SQL file.

CREATE TABLE IF NOT EXISTS `accounts` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` TEXT NOT NULL,
  `type` TEXT NOT NULL,
  `category` TEXT NOT NULL,
  `payday` INTEGER,
  `is_depreciable` INTEGER NOT NULL DEFAULT 0,
  `include_in_allocatable` INTEGER NOT NULL DEFAULT 1,
  `is_system` INTEGER NOT NULL DEFAULT 0,
  `created_at` TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS `journal_entries` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `date` TEXT NOT NULL,
  `description` TEXT NOT NULL,
  `source` TEXT,
  `created_at` TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS `journal_lines` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `journal_entry_id` INTEGER NOT NULL REFERENCES `journal_entries`(`id`) ON DELETE CASCADE,
  `account_id` INTEGER NOT NULL REFERENCES `accounts`(`id`),
  `debit` INTEGER NOT NULL DEFAULT 0,
  `credit` INTEGER NOT NULL DEFAULT 0,
  `currency` TEXT NOT NULL DEFAULT 'JPY',
  `credit_card_billing_offset_months` INTEGER,
  `created_at` TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(typeof(`debit`) = 'integer'),
  CHECK(typeof(`credit`) = 'integer')
);

CREATE TABLE IF NOT EXISTS `crypto_wallets` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `account_id` INTEGER NOT NULL UNIQUE REFERENCES `accounts`(`id`) ON DELETE CASCADE,
  `address` TEXT NOT NULL,
  `chain` TEXT NOT NULL,
  `created_at` TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS `exchange_credentials` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `exchange` TEXT NOT NULL UNIQUE,
  `api_key` TEXT NOT NULL,
  `api_secret` TEXT NOT NULL,
  `created_at` TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS `budget_categories` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` TEXT NOT NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `rollover_months` INTEGER NOT NULL DEFAULT 2,
  `budget_group` TEXT NOT NULL DEFAULT '日常支出',
  `goal_balance` INTEGER,
  `balance_cap` INTEGER,
  `overflow_budget_category_id` INTEGER REFERENCES `budget_categories`(`id`),
  `is_archived` INTEGER NOT NULL DEFAULT 0,
  `created_at` TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(`goal_balance` IS NULL OR typeof(`goal_balance`) = 'integer'),
  CHECK(`balance_cap` IS NULL OR typeof(`balance_cap`) = 'integer')
);

CREATE TABLE IF NOT EXISTS `budget_category_accounts` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `budget_category_id` INTEGER NOT NULL REFERENCES `budget_categories`(`id`) ON DELETE CASCADE,
  `account_id` INTEGER NOT NULL REFERENCES `accounts`(`id`) ON DELETE CASCADE,
  `ratio` REAL NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS `budget_category_account_targets` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `budget_category_id` INTEGER NOT NULL REFERENCES `budget_categories`(`id`) ON DELETE CASCADE,
  `account_id` INTEGER NOT NULL REFERENCES `accounts`(`id`) ON DELETE CASCADE,
  `ratio` REAL NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS `budget_allocations` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `budget_category_id` INTEGER NOT NULL REFERENCES `budget_categories`(`id`) ON DELETE CASCADE,
  `year_month` TEXT NOT NULL,
  `currency` TEXT NOT NULL DEFAULT 'JPY',
  `fixed_amount` INTEGER NOT NULL DEFAULT 0,
  `income_ratio` REAL NOT NULL DEFAULT 0,
  `adhoc_amount` INTEGER NOT NULL DEFAULT 0,
  `created_at` TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(typeof(`fixed_amount`) = 'integer'),
  CHECK(typeof(`adhoc_amount`) = 'integer')
);

CREATE TABLE IF NOT EXISTS `budget_filters` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` TEXT NOT NULL,
  `is_active` INTEGER NOT NULL DEFAULT 1,
  `currency` TEXT NOT NULL DEFAULT 'JPY',
  `created_at` TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS `budget_filter_steps` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `filter_id` INTEGER NOT NULL REFERENCES `budget_filters`(`id`) ON DELETE CASCADE,
  `step_order` INTEGER NOT NULL,
  `step_type` TEXT NOT NULL,
  `created_at` TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS `budget_filter_step_allocations` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `step_id` INTEGER NOT NULL REFERENCES `budget_filter_steps`(`id`) ON DELETE CASCADE,
  `budget_category_id` INTEGER NOT NULL REFERENCES `budget_categories`(`id`),
  `amount` INTEGER,
  `ratio` REAL,
  `created_at` TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(`amount` IS NULL OR typeof(`amount`) = 'integer')
);

CREATE TABLE IF NOT EXISTS `journal_entry_budget_allocations` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `journal_entry_id` INTEGER NOT NULL REFERENCES `journal_entries`(`id`) ON DELETE CASCADE,
  `budget_category_id` INTEGER NOT NULL REFERENCES `budget_categories`(`id`) ON DELETE CASCADE,
  `amount` INTEGER NOT NULL DEFAULT 0,
  `currency` TEXT NOT NULL DEFAULT 'JPY',
  `source` TEXT,
  `created_at` TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(typeof(`amount`) = 'integer')
);

CREATE TABLE IF NOT EXISTS `budget_adjustment_logs` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `budget_category_id` INTEGER NOT NULL REFERENCES `budget_categories`(`id`) ON DELETE CASCADE,
  `year_month` TEXT NOT NULL,
  `amount` INTEGER NOT NULL,
  `currency` TEXT NOT NULL DEFAULT 'JPY',
  `date` TEXT NOT NULL,
  `adjustment_type` TEXT NOT NULL DEFAULT 'allocation',
  `note` TEXT,
  `journal_entry_id` INTEGER REFERENCES `journal_entries`(`id`) ON DELETE CASCADE,
  `created_at` TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(typeof(`amount`) = 'integer')
);

CREATE TABLE IF NOT EXISTS `budget_settings` (
  `id` INTEGER PRIMARY KEY NOT NULL DEFAULT 1,
  `preferred_payment_account_ids` TEXT,
  `preferred_filter_ids` TEXT,
  `is_business_owner` INTEGER NOT NULL DEFAULT 0,
  `business_advance_account_id` INTEGER REFERENCES `accounts`(`id`),
  `business_loss_account_id` INTEGER REFERENCES `accounts`(`id`),
  `business_advance_budget_category_id` INTEGER REFERENCES `budget_categories`(`id`)
);

CREATE TABLE IF NOT EXISTS `store_account_mappings` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `store_name` TEXT NOT NULL UNIQUE,
  `account_id` INTEGER NOT NULL REFERENCES `accounts`(`id`) ON DELETE CASCADE,
  `created_at` TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS `depreciation_schedules` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `source_journal_entry_id` INTEGER NOT NULL REFERENCES `journal_entries`(`id`) ON DELETE CASCADE,
  `asset_account_id` INTEGER NOT NULL REFERENCES `accounts`(`id`),
  `expense_account_id` INTEGER NOT NULL REFERENCES `accounts`(`id`),
  `total_amount` INTEGER NOT NULL,
  `months` INTEGER NOT NULL,
  `start_date` TEXT NOT NULL,
  `description` TEXT NOT NULL DEFAULT '',
  `created_at` TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(typeof(`total_amount`) = 'integer')
);

CREATE TABLE IF NOT EXISTS `depreciation_entries` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `schedule_id` INTEGER NOT NULL REFERENCES `depreciation_schedules`(`id`) ON DELETE CASCADE,
  `journal_entry_id` INTEGER NOT NULL REFERENCES `journal_entries`(`id`) ON DELETE CASCADE,
  `month_number` INTEGER NOT NULL,
  `created_at` TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS `actual_balance_snapshots` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `snapshot_date` TEXT NOT NULL,
  `snapshot_time` TEXT,
  `created_at` TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS `actual_balance_entries` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `snapshot_id` INTEGER NOT NULL REFERENCES `actual_balance_snapshots`(`id`) ON DELETE CASCADE,
  `account_id` INTEGER NOT NULL REFERENCES `accounts`(`id`) ON DELETE CASCADE,
  `amount` INTEGER NOT NULL,
  `created_at` TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(typeof(`amount`) = 'integer')
);

CREATE TABLE IF NOT EXISTS `actual_balance_credit_card_state` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `account_id` INTEGER NOT NULL REFERENCES `accounts`(`id`) ON DELETE CASCADE,
  `payment_month` TEXT NOT NULL,
  `status` TEXT NOT NULL CHECK(`status` IN ('open', 'confirmed', 'paid')),
  `amount` INTEGER NOT NULL,
  `last_updated_at` TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(typeof(`amount`) = 'integer')
);

CREATE TABLE IF NOT EXISTS `credit_card_settings` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `account_id` INTEGER NOT NULL UNIQUE REFERENCES `accounts`(`id`) ON DELETE CASCADE,
  `closing_day` INTEGER NOT NULL,
  `confirmation_day` INTEGER NOT NULL,
  `withdrawal_day` INTEGER NOT NULL,
  `billing_offset_months` INTEGER NOT NULL DEFAULT 0,
  `withdrawal_account_id` INTEGER REFERENCES `accounts`(`id`) ON DELETE SET NULL,
  `created_at` TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS `loan_settlements` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `journal_entry_id` INTEGER NOT NULL REFERENCES `journal_entries`(`id`) ON DELETE CASCADE,
  `settled_by_journal_entry_id` INTEGER REFERENCES `journal_entries`(`id`) ON DELETE SET NULL,
  `is_settled` INTEGER NOT NULL DEFAULT 0,
  `settled_at` TEXT,
  `created_at` TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS `account_completions` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `account_id` INTEGER NOT NULL UNIQUE REFERENCES `accounts`(`id`) ON DELETE CASCADE,
  `completed_at` TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS `long_term_loan_plans` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `account_id` INTEGER NOT NULL UNIQUE REFERENCES `accounts`(`id`) ON DELETE CASCADE,
  `note` TEXT,
  `currency` TEXT NOT NULL DEFAULT 'JPY',
  `total_principal` INTEGER,
  `annual_interest_rate` REAL,
  `monthly_payment` INTEGER,
  `start_year_month` TEXT,
  `created_at` TEXT NOT NULL DEFAULT (datetime('now')),
  `updated_at` TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(`total_principal` IS NULL OR typeof(`total_principal`) = 'integer'),
  CHECK(`monthly_payment` IS NULL OR typeof(`monthly_payment`) = 'integer')
);

CREATE TABLE IF NOT EXISTS `long_term_loan_plan_rows` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `plan_id` INTEGER NOT NULL REFERENCES `long_term_loan_plans`(`id`) ON DELETE CASCADE,
  `year_month` TEXT NOT NULL,
  `principal_amount` INTEGER NOT NULL DEFAULT 0,
  `interest_amount` INTEGER NOT NULL DEFAULT 0,
  `note` TEXT,
  `created_at` TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(typeof(`principal_amount`) = 'integer'),
  CHECK(typeof(`interest_amount`) = 'integer')
);

CREATE TABLE IF NOT EXISTS `enabled_currencies` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `code` TEXT NOT NULL UNIQUE,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `symbol_priority` INTEGER NOT NULL DEFAULT 0,
  `custom_symbol` TEXT,
  `custom_icon` TEXT,
  `decimal_places` INTEGER NOT NULL DEFAULT 2,
  `created_at` TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT `chk_enabled_currencies_decimal_places_range`
    CHECK(`decimal_places` BETWEEN 0 AND 9)
);

CREATE UNIQUE INDEX IF NOT EXISTS `idx_budget_category_account_targets_unique`
  ON `budget_category_account_targets` (`budget_category_id`, `account_id`);

CREATE UNIQUE INDEX IF NOT EXISTS `idx_budget_category_accounts_unique`
  ON `budget_category_accounts` (`budget_category_id`, `account_id`);

CREATE UNIQUE INDEX IF NOT EXISTS `idx_budget_allocations_category_month_currency_unique`
  ON `budget_allocations` (`budget_category_id`, `year_month`, `currency`);

CREATE UNIQUE INDEX IF NOT EXISTS `idx_budget_filter_steps_order_unique`
  ON `budget_filter_steps` (`filter_id`, `step_order`);

CREATE UNIQUE INDEX IF NOT EXISTS `idx_loan_settlements_entry_unique`
  ON `loan_settlements` (`journal_entry_id`);

CREATE UNIQUE INDEX IF NOT EXISTS `idx_actual_balance_entries_unique`
  ON `actual_balance_entries` (`snapshot_id`, `account_id`);

CREATE UNIQUE INDEX IF NOT EXISTS `idx_actual_balance_credit_card_state_account_month_unique`
  ON `actual_balance_credit_card_state` (`account_id`, `payment_month`);

CREATE UNIQUE INDEX IF NOT EXISTS `idx_long_term_loan_plan_rows_plan_month_unique`
  ON `long_term_loan_plan_rows` (`plan_id`, `year_month`);

CREATE INDEX IF NOT EXISTS `idx_journal_entries_date_id`
  ON `journal_entries` (`date`, `id`);

CREATE INDEX IF NOT EXISTS `idx_journal_lines_entry`
  ON `journal_lines` (`journal_entry_id`);

CREATE INDEX IF NOT EXISTS `idx_journal_lines_account_entry`
  ON `journal_lines` (`account_id`, `journal_entry_id`);

CREATE INDEX IF NOT EXISTS `idx_journal_lines_currency_account`
  ON `journal_lines` (`currency`, `account_id`);

CREATE INDEX IF NOT EXISTS `idx_budget_adjustment_logs_month_currency`
  ON `budget_adjustment_logs` (`year_month`, `currency`);

CREATE INDEX IF NOT EXISTS `idx_journal_entry_budget_allocations_entry_currency`
  ON `journal_entry_budget_allocations` (`journal_entry_id`, `currency`);

INSERT OR IGNORE INTO `budget_settings` (`id`) VALUES (1);

INSERT INTO `accounts` (`name`, `type`, `category`, `is_system`)
SELECT '__system:unknown_funds__', 'asset', 'other', 1
WHERE NOT EXISTS (SELECT 1 FROM `accounts` WHERE `name` = '__system:unknown_funds__' AND `is_system` = 1);

INSERT INTO `accounts` (`name`, `type`, `category`, `is_system`)
SELECT '__system:misc_expense__', 'expense', 'other', 1
WHERE NOT EXISTS (SELECT 1 FROM `accounts` WHERE `name` = '__system:misc_expense__' AND `is_system` = 1);

INSERT INTO `accounts` (`name`, `type`, `category`, `is_system`)
SELECT '__system:misc_income__', 'income', 'other', 1
WHERE NOT EXISTS (SELECT 1 FROM `accounts` WHERE `name` = '__system:misc_income__' AND `is_system` = 1);

INSERT INTO `accounts` (`name`, `type`, `category`, `is_system`)
SELECT '__system:securities_gain__', 'income', 'investment', 1
WHERE NOT EXISTS (SELECT 1 FROM `accounts` WHERE `name` = '__system:securities_gain__' AND `is_system` = 1);

INSERT INTO `accounts` (`name`, `type`, `category`, `is_system`)
SELECT '__system:securities_loss__', 'expense', 'investment_loss', 1
WHERE NOT EXISTS (SELECT 1 FROM `accounts` WHERE `name` = '__system:securities_loss__' AND `is_system` = 1);

INSERT INTO `accounts` (`name`, `type`, `category`, `is_system`)
SELECT '__system:crypto_gain__', 'income', 'investment', 1
WHERE NOT EXISTS (SELECT 1 FROM `accounts` WHERE `name` = '__system:crypto_gain__' AND `is_system` = 1);

INSERT INTO `accounts` (`name`, `type`, `category`, `is_system`)
SELECT '__system:crypto_loss__', 'expense', 'investment_loss', 1
WHERE NOT EXISTS (SELECT 1 FROM `accounts` WHERE `name` = '__system:crypto_loss__' AND `is_system` = 1);

INSERT INTO `accounts` (`name`, `type`, `category`, `is_system`)
SELECT '__system:property_gain__', 'income', 'other', 1
WHERE NOT EXISTS (SELECT 1 FROM `accounts` WHERE `name` = '__system:property_gain__' AND `is_system` = 1);

INSERT INTO `accounts` (`name`, `type`, `category`, `is_system`)
SELECT '__system:property_loss__', 'expense', 'other', 1
WHERE NOT EXISTS (SELECT 1 FROM `accounts` WHERE `name` = '__system:property_loss__' AND `is_system` = 1);

INSERT INTO `accounts` (`name`, `type`, `category`, `is_system`)
SELECT '__system:opening_balance__', 'equity', 'opening_balance', 1
WHERE NOT EXISTS (SELECT 1 FROM `accounts` WHERE `type` = 'equity' AND `category` = 'opening_balance');

INSERT INTO `accounts` (`name`, `type`, `category`, `is_system`)
SELECT '__system:bad_debt_loss__', 'expense', 'other', 1
WHERE NOT EXISTS (SELECT 1 FROM `accounts` WHERE `name` = '__system:bad_debt_loss__' AND `is_system` = 1);
