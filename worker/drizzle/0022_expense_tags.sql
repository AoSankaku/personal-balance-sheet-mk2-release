CREATE TABLE expense_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE journal_entry_expense_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES expense_tags(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX idx_journal_entry_expense_tags_entry_tag_unique
  ON journal_entry_expense_tags(journal_entry_id, tag_id);
CREATE INDEX idx_journal_entry_expense_tags_tag_entry
  ON journal_entry_expense_tags(tag_id, journal_entry_id);

CREATE TABLE journal_entry_tag_amounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  amount INTEGER NOT NULL,
  CHECK (typeof(amount) = 'integer')
);

CREATE UNIQUE INDEX idx_journal_entry_tag_amounts_entry_currency_unique
  ON journal_entry_tag_amounts(journal_entry_id, currency);
