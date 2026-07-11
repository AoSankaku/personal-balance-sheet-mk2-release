PRAGMA defer_foreign_keys = true;

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
  recurrence_interval INTEGER,
  recurrence_unit TEXT,
  recurrence_monthly_mode TEXT,
  recurrence_interval_months INTEGER,
  recurrence_day INTEGER,
  recurrence_weeks_of_month TEXT,
  recurrence_weekday INTEGER,
  recurrence_week_fallback TEXT DEFAULT 'previous_week',
  next_due_date TEXT,
  end_date TEXT,
  recurrence_count INTEGER,
  skipped_dates TEXT,
  completed_dates TEXT,
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
  CHECK(status IN ('open', 'completed', 'cancelled')),
  CHECK(recurrence_type IN ('one_time', 'recurring')),
  CHECK(recurrence_interval IS NULL OR recurrence_interval > 0),
  CHECK(recurrence_interval_months IS NULL OR recurrence_interval_months > 0),
  CHECK(recurrence_day IS NULL OR recurrence_day BETWEEN 0 AND 31),
  CHECK(recurrence_weekday IS NULL OR recurrence_weekday BETWEEN 0 AND 6),
  CHECK(recurrence_count IS NULL OR recurrence_count > 0),
  CHECK(recurrence_unit IS NULL OR recurrence_unit IN ('week', 'month', 'year')),
  CHECK(recurrence_monthly_mode IS NULL OR recurrence_monthly_mode IN ('day_of_month', 'week_of_month')),
  CHECK(recurrence_week_fallback IS NULL OR recurrence_week_fallback IN ('skip', 'last_day_of_month', 'previous_week', 'next_month_first_week'))
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
  recurrence_interval,
  recurrence_unit,
  recurrence_monthly_mode,
  recurrence_interval_months,
  recurrence_day,
  recurrence_weeks_of_month,
  recurrence_weekday,
  recurrence_week_fallback,
  next_due_date,
  end_date,
  recurrence_count,
  skipped_dates,
  completed_dates,
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
  CASE
    WHEN recurrence_type = 'recurring' THEN COALESCE(recurrence_interval_months, 1)
    ELSE NULL
  END,
  CASE
    WHEN recurrence_type = 'recurring' THEN 'month'
    ELSE NULL
  END,
  CASE
    WHEN recurrence_type = 'recurring' AND recurrence_day IS NOT NULL THEN 'day_of_month'
    ELSE NULL
  END,
  recurrence_interval_months,
  recurrence_day,
  NULL,
  NULL,
  'previous_week',
  next_due_date,
  end_date,
  NULL,
  NULL,
  NULL,
  sort_order,
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

ALTER TABLE budget_settings ADD COLUMN calendar_week_start INTEGER NOT NULL DEFAULT 0;
