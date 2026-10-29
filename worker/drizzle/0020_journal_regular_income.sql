ALTER TABLE journal_entries
  ADD COLUMN is_regular_income INTEGER NOT NULL DEFAULT 0
  CHECK (is_regular_income IN (0, 1));

ALTER TABLE journal_entries
  ADD COLUMN income_budget_filter_id INTEGER
  REFERENCES budget_filters(id) ON DELETE SET NULL;
