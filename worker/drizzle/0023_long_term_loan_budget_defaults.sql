CREATE TABLE long_term_loan_budget_defaults (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, currency)
);

CREATE TABLE long_term_loan_budget_default_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  default_id INTEGER NOT NULL REFERENCES long_term_loan_budget_defaults(id) ON DELETE CASCADE,
  budget_category_id INTEGER REFERENCES budget_categories(id) ON DELETE SET NULL,
  weight INTEGER NOT NULL CHECK (
    typeof(weight) = 'integer'
    AND weight > 0
    AND weight <= 9007199254740991
  )
);

CREATE INDEX idx_long_term_loan_budget_default_allocations_default
  ON long_term_loan_budget_default_allocations(default_id);
