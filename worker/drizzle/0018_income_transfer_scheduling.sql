ALTER TABLE budget_settings ADD COLUMN income_transfer_settings TEXT;

UPDATE budget_settings
SET income_transfer_settings = json_object(
  'transfer_thresholds',
  json(json_extract(interest_income_rule, '$.transfer_thresholds'))
)
WHERE CASE
  WHEN json_valid(interest_income_rule) THEN
    json_type(interest_income_rule) = 'object'
    AND json_type(interest_income_rule, '$.transfer_thresholds') = 'object'
  ELSE 0
END;

ALTER TABLE income_transfer_requirements
  ADD COLUMN is_deferred INTEGER DEFAULT NULL
  CHECK (is_deferred IS NULL OR is_deferred IN (0, 1));
