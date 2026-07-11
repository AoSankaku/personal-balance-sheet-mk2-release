CREATE TABLE planned_expense_completion_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  planned_expense_id INTEGER NOT NULL,
  journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  completion TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(completion IN ('completed', 'shopping_list_archived', 'none'))
);

CREATE INDEX idx_planned_expense_completion_requests_expense
  ON planned_expense_completion_requests(planned_expense_id);
