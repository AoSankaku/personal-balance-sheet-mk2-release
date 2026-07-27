CREATE TABLE `budget_funding_allocations` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `journal_entry_id` INTEGER NOT NULL,
  `budget_category_id` INTEGER,
  `kind` TEXT NOT NULL,
  `amount` INTEGER NOT NULL,
  `currency` TEXT NOT NULL DEFAULT 'JPY',
  `source_journal_entry_id` INTEGER,
  `created_at` TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`budget_category_id`) REFERENCES `budget_categories`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`source_journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE set null,
  CONSTRAINT `chk_budget_funding_allocations_kind`
    CHECK (`kind` IN ('borrow', 'repay', 'lend', 'collect')),
  CONSTRAINT `chk_budget_funding_allocations_amount_integer`
    CHECK (typeof(`amount`) = 'integer'),
  CONSTRAINT `chk_budget_funding_allocations_amount_positive`
    CHECK (`amount` > 0)
);

CREATE INDEX `idx_budget_funding_allocations_entry`
  ON `budget_funding_allocations` (`journal_entry_id`);

CREATE INDEX `idx_budget_funding_allocations_category_currency`
  ON `budget_funding_allocations` (`budget_category_id`, `currency`);

CREATE INDEX `idx_budget_funding_allocations_source`
  ON `budget_funding_allocations` (`source_journal_entry_id`);
