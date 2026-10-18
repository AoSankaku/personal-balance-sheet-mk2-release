ALTER TABLE accounts ADD COLUMN deduct_from_budget INTEGER NOT NULL DEFAULT 0
  CHECK (deduct_from_budget IN (0, 1));

UPDATE accounts SET deduct_from_budget = 1
WHERE type = 'liability' AND category = 'credit_card';

-- Existing observations retain their original default-currency storage scale.
ALTER TABLE actual_balance_entries ADD COLUMN money_scale INTEGER
  CHECK (money_scale BETWEEN 0 AND 9);

CREATE TABLE actual_balance_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  actual_balance_entry_id INTEGER NOT NULL UNIQUE
    REFERENCES actual_balance_entries(id) ON DELETE CASCADE,
  journal_entry_id INTEGER NOT NULL UNIQUE
    REFERENCES journal_entries(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL DEFAULT 0 CHECK (typeof(amount) = 'integer'),
  is_resolved INTEGER NOT NULL DEFAULT 0 CHECK (is_resolved IN (0, 1)),
  default_money_scale INTEGER CHECK (default_money_scale BETWEEN 0 AND 9)
);
