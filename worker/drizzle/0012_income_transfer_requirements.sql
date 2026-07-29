CREATE TABLE `income_transfer_requirements` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `source_income_journal_entry_id` INTEGER NOT NULL,
  `budget_category_id` INTEGER,
  `budget_category_name` TEXT NOT NULL,
  `from_account_id` INTEGER NOT NULL,
  `to_account_id` INTEGER NOT NULL,
  `amount` INTEGER NOT NULL,
  `currency` TEXT NOT NULL DEFAULT 'JPY',
  `transfer_journal_entry_id` INTEGER,
  `completion_source` TEXT,
  `created_at` TEXT NOT NULL DEFAULT (datetime('now')),
  `completed_at` TEXT,
  FOREIGN KEY (`source_income_journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`budget_category_id`) REFERENCES `budget_categories`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`from_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`to_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`transfer_journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE set null,
  CONSTRAINT `chk_income_transfer_requirements_amount_integer`
    CHECK (typeof(`amount`) = 'integer'),
  CONSTRAINT `chk_income_transfer_requirements_amount_positive`
    CHECK (`amount` > 0),
  CONSTRAINT `chk_income_transfer_requirements_completion_source`
    CHECK (`completion_source` IS NULL OR `completion_source` IN ('created', 'linked'))
);

CREATE INDEX `idx_income_transfer_requirements_source`
  ON `income_transfer_requirements` (`source_income_journal_entry_id`);

CREATE INDEX `idx_income_transfer_requirements_pending`
  ON `income_transfer_requirements` (`transfer_journal_entry_id`, `currency`);

CREATE INDEX `idx_income_transfer_requirements_transfer`
  ON `income_transfer_requirements` (`transfer_journal_entry_id`);
