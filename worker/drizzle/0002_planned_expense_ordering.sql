PRAGMA foreign_keys = OFF;

CREATE TABLE planned_expenses_new (
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
  priority INTEGER NOT NULL DEFAULT 3,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  keep_on_routine_clear INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  url TEXT,
  product_metadata_cache_id INTEGER REFERENCES product_metadata_cache(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(kind IN ('shopping_list', 'wishlist', 'scheduled_payment')),
  CHECK(typeof(estimated_amount) = 'integer'),
  CHECK(priority BETWEEN 1 AND 5),
  CHECK(status IN ('open', 'completed', 'cancelled')),
  CHECK(recurrence_type IN ('one_time', 'recurring')),
  CHECK(recurrence_interval_months IS NULL OR recurrence_interval_months > 0),
  CHECK(recurrence_day IS NULL OR recurrence_day BETWEEN 1 AND 31)
);

INSERT INTO planned_expenses_new (
  id,
  kind,
  category_id,
  name,
  estimated_amount,
  currency,
  budget_category_id,
  expense_account_id,
  target_date,
  recurrence_type,
  recurrence_interval_months,
  recurrence_day,
  next_due_date,
  end_date,
  priority,
  sort_order,
  status,
  keep_on_routine_clear,
  note,
  url,
  product_metadata_cache_id,
  created_at,
  updated_at
)
SELECT
  id,
  kind,
  category_id,
  name,
  estimated_amount,
  currency,
  budget_category_id,
  expense_account_id,
  target_date,
  recurrence_type,
  recurrence_interval_months,
  recurrence_day,
  next_due_date,
  end_date,
  priority,
  ROW_NUMBER() OVER (
    PARTITION BY kind, COALESCE(category_id, 0)
    ORDER BY status, target_date, priority DESC, created_at DESC, id DESC
  ) - 1,
  status,
  keep_on_routine_clear,
  note,
  url,
  product_metadata_cache_id,
  created_at,
  updated_at
FROM planned_expenses;

DROP TABLE planned_expenses;

ALTER TABLE planned_expenses_new RENAME TO planned_expenses;

CREATE INDEX IF NOT EXISTS idx_planned_expenses_kind_status_date
  ON planned_expenses (kind, status, target_date);

CREATE INDEX IF NOT EXISTS idx_planned_expenses_category
  ON planned_expenses (category_id);

CREATE INDEX IF NOT EXISTS idx_planned_expenses_expense_account
  ON planned_expenses (expense_account_id);

CREATE INDEX IF NOT EXISTS idx_planned_expenses_kind_category_order
  ON planned_expenses (kind, category_id, sort_order, name);

PRAGMA foreign_keys = ON;
