CREATE TABLE IF NOT EXISTS product_metadata_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  normalized_url TEXT NOT NULL UNIQUE,
  source_site TEXT NOT NULL,
  source_product_id TEXT,
  name TEXT,
  price_amount INTEGER,
  currency TEXT NOT NULL DEFAULT 'JPY',
  availability_status TEXT NOT NULL DEFAULT 'unknown',
  availability_label TEXT,
  og_title TEXT,
  og_description TEXT,
  og_image_url TEXT,
  og_site_name TEXT,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT chk_product_metadata_price_amount_integer CHECK (price_amount IS NULL OR typeof(price_amount) = 'integer')
);

CREATE TABLE IF NOT EXISTS product_api_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  provider TEXT NOT NULL,
  api_key TEXT,
  api_secret TEXT,
  partner_tag TEXT,
  application_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS planned_expense_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  estimated_amount INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'JPY',
  default_expense_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  target_date TEXT,
  shopping_plan_type TEXT NOT NULL DEFAULT 'one_time',
  archived_at TEXT,
  last_checked_out_date TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(kind IN ('shopping_list', 'wishlist', 'scheduled_payment')),
  CHECK(typeof(estimated_amount) = 'integer')
);

CREATE TABLE IF NOT EXISTS planned_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  kind TEXT NOT NULL,
  category_id INTEGER REFERENCES planned_expense_categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  estimated_amount INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'JPY',
  budget_category_id INTEGER REFERENCES budget_categories(id) ON DELETE SET NULL,
  expense_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  target_date TEXT,
  recurrence_type TEXT NOT NULL DEFAULT 'one_time',
  recurrence_interval_months INTEGER,
  recurrence_day INTEGER,
  next_due_date TEXT,
  end_date TEXT,
  priority INTEGER NOT NULL DEFAULT 2,
  status TEXT NOT NULL DEFAULT 'open',
  keep_on_routine_clear INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  url TEXT,
  product_metadata_cache_id INTEGER REFERENCES product_metadata_cache(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(kind IN ('shopping_list', 'wishlist', 'scheduled_payment')),
  CHECK(typeof(estimated_amount) = 'integer'),
  CHECK(priority BETWEEN 1 AND 3),
  CHECK(status IN ('open', 'completed', 'cancelled')),
  CHECK(recurrence_type IN ('one_time', 'recurring')),
  CHECK(recurrence_interval_months IS NULL OR recurrence_interval_months > 0),
  CHECK(recurrence_day IS NULL OR recurrence_day BETWEEN 1 AND 31)
);

CREATE INDEX IF NOT EXISTS idx_product_metadata_cache_expires_at
  ON product_metadata_cache (expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_api_credentials_provider
  ON product_api_credentials (provider);

CREATE INDEX IF NOT EXISTS idx_planned_expense_categories_kind
  ON planned_expense_categories (kind, sort_order, name);

CREATE INDEX IF NOT EXISTS idx_planned_expense_categories_default_expense_account
  ON planned_expense_categories (default_expense_account_id);

CREATE INDEX IF NOT EXISTS idx_planned_expense_categories_kind_archived
  ON planned_expense_categories (kind, archived_at, sort_order, name);

CREATE INDEX IF NOT EXISTS idx_planned_expenses_kind_status_date
  ON planned_expenses (kind, status, target_date);

CREATE INDEX IF NOT EXISTS idx_planned_expenses_category
  ON planned_expenses (category_id);

CREATE INDEX IF NOT EXISTS idx_planned_expenses_expense_account
  ON planned_expenses (expense_account_id);
