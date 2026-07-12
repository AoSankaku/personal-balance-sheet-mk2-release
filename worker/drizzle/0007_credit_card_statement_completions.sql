CREATE TABLE `credit_card_statement_completions` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `account_id` INTEGER NOT NULL,
  `statement_month` TEXT NOT NULL,
  `payment_month` TEXT NOT NULL,
  `completion_method` TEXT NOT NULL,
  `completed_at` TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `idx_credit_card_statement_completions_account_month_unique`
  ON `credit_card_statement_completions` (`account_id`, `statement_month`);
