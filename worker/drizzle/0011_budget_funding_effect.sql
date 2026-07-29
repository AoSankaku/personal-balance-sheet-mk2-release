ALTER TABLE `budget_funding_allocations`
  ADD COLUMN `effect` TEXT NOT NULL DEFAULT 'apply'
  CHECK (`effect` IN ('apply', 'component_only'));

CREATE INDEX `idx_budget_funding_allocations_effect`
  ON `budget_funding_allocations` (`effect`);
