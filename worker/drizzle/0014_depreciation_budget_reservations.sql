CREATE TABLE depreciation_budget_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  schedule_id INTEGER NOT NULL,
  budget_category_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'JPY',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (schedule_id) REFERENCES depreciation_schedules(id) ON DELETE CASCADE,
  FOREIGN KEY (budget_category_id) REFERENCES budget_categories(id) ON DELETE CASCADE,
  CONSTRAINT chk_depreciation_budget_reservations_amount_positive
    CHECK (amount > 0),
  CONSTRAINT uq_depreciation_budget_reservations_schedule_category_currency
    UNIQUE (schedule_id, budget_category_id, currency)
);

CREATE INDEX idx_depreciation_budget_reservations_schedule
  ON depreciation_budget_reservations(schedule_id);

CREATE INDEX idx_depreciation_budget_reservations_category_currency
  ON depreciation_budget_reservations(budget_category_id, currency);

INSERT INTO depreciation_budget_reservations (
  schedule_id,
  budget_category_id,
  amount,
  currency
)
SELECT
  depreciation_entries.schedule_id,
  journal_entry_budget_allocations.budget_category_id,
  -SUM(journal_entry_budget_allocations.amount),
  journal_entry_budget_allocations.currency
FROM depreciation_entries
INNER JOIN journal_entry_budget_allocations
  ON journal_entry_budget_allocations.journal_entry_id = depreciation_entries.journal_entry_id
GROUP BY
  depreciation_entries.schedule_id,
  journal_entry_budget_allocations.budget_category_id,
  journal_entry_budget_allocations.currency
HAVING -SUM(journal_entry_budget_allocations.amount) > 0;
