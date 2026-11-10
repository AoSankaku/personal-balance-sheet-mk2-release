CREATE INDEX IF NOT EXISTS `idx_journal_lines_entry_currency`
  ON `journal_lines` (`journal_entry_id`, `currency`);

CREATE INDEX IF NOT EXISTS `idx_budget_adjustment_logs_journal_entry`
  ON `budget_adjustment_logs` (`journal_entry_id`);

CREATE INDEX IF NOT EXISTS `idx_depreciation_entries_journal_entry`
  ON `depreciation_entries` (`journal_entry_id`);
