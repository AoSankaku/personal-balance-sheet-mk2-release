ALTER TABLE store_account_mappings
  ADD COLUMN budget_category_id INTEGER
  REFERENCES budget_categories(id) ON DELETE SET NULL;
