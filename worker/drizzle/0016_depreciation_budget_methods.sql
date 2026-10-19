ALTER TABLE depreciation_schedules ADD COLUMN budget_method TEXT
  CHECK (budget_method IS NULL OR budget_method IN ('assigned', 'special', 'unallocated'));
ALTER TABLE depreciation_schedules ADD COLUMN budget_settings TEXT;
ALTER TABLE depreciation_schedules ADD COLUMN budget_revision INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(budget_revision) = 'integer' AND budget_revision >= 0);
ALTER TABLE depreciation_schedules ADD COLUMN budget_special_category_id INTEGER
  REFERENCES budget_categories(id) ON DELETE SET NULL;
ALTER TABLE depreciation_schedules ADD COLUMN budget_target_amount INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(budget_target_amount) = 'integer' AND budget_target_amount >= 0);
ALTER TABLE depreciation_schedules ADD COLUMN budget_currency TEXT NOT NULL DEFAULT 'JPY';
ALTER TABLE depreciation_schedules ADD COLUMN budget_idempotency_key TEXT;

CREATE UNIQUE INDEX uq_depreciation_schedules_budget_idempotency_key
  ON depreciation_schedules(budget_idempotency_key);
CREATE UNIQUE INDEX uq_depreciation_schedules_special_category
  ON depreciation_schedules(budget_special_category_id)
  WHERE budget_special_category_id IS NOT NULL;

ALTER TABLE budget_adjustment_logs ADD COLUMN depreciation_schedule_id INTEGER
  REFERENCES depreciation_schedules(id) ON DELETE CASCADE;
ALTER TABLE budget_adjustment_logs ADD COLUMN depreciation_event_key TEXT;
ALTER TABLE budget_adjustment_logs ADD COLUMN depreciation_event_side TEXT
  CHECK (depreciation_event_side IS NULL OR depreciation_event_side IN ('source', 'destination'));
ALTER TABLE budget_adjustment_logs ADD COLUMN reset_scope TEXT
  CHECK (reset_scope IS NULL OR reset_scope IN ('category', 'all'));
ALTER TABLE budget_adjustment_logs ADD COLUMN reset_group_key TEXT;

CREATE UNIQUE INDEX uq_budget_adjustment_logs_depreciation_event_side
  ON budget_adjustment_logs(depreciation_schedule_id, depreciation_event_key, depreciation_event_side)
  WHERE depreciation_schedule_id IS NOT NULL AND depreciation_event_key IS NOT NULL;
CREATE INDEX idx_budget_adjustment_logs_depreciation_schedule
  ON budget_adjustment_logs(depreciation_schedule_id, date, created_at);

CREATE TABLE depreciation_budget_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  schedule_id INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  action TEXT NOT NULL,
  request_key TEXT,
  before_settings TEXT,
  after_settings TEXT,
  before_events TEXT,
  after_events TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT uq_depreciation_budget_revisions_schedule_revision UNIQUE(schedule_id, revision)
);
CREATE UNIQUE INDEX uq_depreciation_budget_revisions_schedule_request
  ON depreciation_budget_revisions(schedule_id, request_key)
  WHERE request_key IS NOT NULL;

CREATE TABLE depreciation_budget_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (typeof(revision) = 'integer' AND revision >= 0)
);
INSERT INTO depreciation_budget_state(id, revision) VALUES (1, 0);

CREATE TABLE depreciation_budget_apply_guard (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  expected_revision INTEGER NOT NULL CHECK (typeof(expected_revision) = 'integer')
);

CREATE TRIGGER depreciation_budget_guard_revision_insert
BEFORE INSERT ON depreciation_budget_apply_guard
WHEN NEW.expected_revision != (SELECT revision FROM depreciation_budget_state WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'stale_depreciation_budget_preview');
END;
CREATE TRIGGER depreciation_budget_guard_revision_update
BEFORE UPDATE OF expected_revision ON depreciation_budget_apply_guard
WHEN NEW.expected_revision != (SELECT revision FROM depreciation_budget_state WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'stale_depreciation_budget_preview');
END;
CREATE TRIGGER depreciation_budget_guard_bump_insert
AFTER INSERT ON depreciation_budget_apply_guard
BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER depreciation_budget_guard_bump_update
AFTER UPDATE OF expected_revision ON depreciation_budget_apply_guard
BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;

-- Any input that can change a preview snapshot advances one shared revision.
-- A guarded D1 batch checks this revision before making its first mutation.
CREATE TRIGGER depreciation_budget_revision_accounts_insert AFTER INSERT ON accounts BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER depreciation_budget_revision_accounts_update AFTER UPDATE ON accounts BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER depreciation_budget_revision_accounts_delete AFTER DELETE ON accounts BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER depreciation_budget_revision_journal_entries_insert AFTER INSERT ON journal_entries BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER depreciation_budget_revision_journal_entries_update AFTER UPDATE ON journal_entries BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER depreciation_budget_revision_journal_entries_delete AFTER DELETE ON journal_entries BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER depreciation_budget_revision_journal_lines_insert AFTER INSERT ON journal_lines BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER depreciation_budget_revision_journal_lines_update AFTER UPDATE ON journal_lines BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER depreciation_budget_revision_journal_lines_delete AFTER DELETE ON journal_lines BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER depreciation_budget_revision_allocations_insert AFTER INSERT ON journal_entry_budget_allocations BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER depreciation_budget_revision_allocations_update AFTER UPDATE ON journal_entry_budget_allocations BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER depreciation_budget_revision_allocations_delete AFTER DELETE ON journal_entry_budget_allocations BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER depreciation_budget_revision_adjustments_insert AFTER INSERT ON budget_adjustment_logs BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER depreciation_budget_revision_adjustments_update AFTER UPDATE ON budget_adjustment_logs BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER depreciation_budget_revision_adjustments_delete AFTER DELETE ON budget_adjustment_logs BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER depreciation_budget_revision_categories_insert AFTER INSERT ON budget_categories BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER depreciation_budget_revision_categories_update AFTER UPDATE ON budget_categories BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER depreciation_budget_revision_categories_delete AFTER DELETE ON budget_categories BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER depreciation_budget_revision_category_accounts_insert AFTER INSERT ON budget_category_accounts BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER depreciation_budget_revision_category_accounts_update AFTER UPDATE ON budget_category_accounts BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER depreciation_budget_revision_category_accounts_delete AFTER DELETE ON budget_category_accounts BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER depreciation_budget_revision_budget_allocations_insert AFTER INSERT ON budget_allocations BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER depreciation_budget_revision_budget_allocations_update AFTER UPDATE ON budget_allocations BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER depreciation_budget_revision_budget_allocations_delete AFTER DELETE ON budget_allocations BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER depreciation_budget_revision_budget_funding_insert AFTER INSERT ON budget_funding_allocations BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER depreciation_budget_revision_budget_funding_update AFTER UPDATE ON budget_funding_allocations BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER depreciation_budget_revision_budget_funding_delete AFTER DELETE ON budget_funding_allocations BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER depreciation_budget_revision_depreciation_schedules_insert AFTER INSERT ON depreciation_schedules BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER depreciation_budget_revision_depreciation_schedules_update AFTER UPDATE ON depreciation_schedules BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER depreciation_budget_revision_depreciation_schedules_delete AFTER DELETE ON depreciation_schedules BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER depreciation_budget_revision_depreciation_entries_insert AFTER INSERT ON depreciation_entries BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER depreciation_budget_revision_depreciation_entries_update AFTER UPDATE ON depreciation_entries BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER depreciation_budget_revision_depreciation_entries_delete AFTER DELETE ON depreciation_entries BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER depreciation_budget_revision_reservations_insert AFTER INSERT ON depreciation_budget_reservations BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER depreciation_budget_revision_reservations_update AFTER UPDATE ON depreciation_budget_reservations BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER depreciation_budget_revision_reservations_delete AFTER DELETE ON depreciation_budget_reservations BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER depreciation_budget_revision_currencies_insert AFTER INSERT ON enabled_currencies BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER depreciation_budget_revision_currencies_update AFTER UPDATE ON enabled_currencies BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER depreciation_budget_revision_currencies_delete AFTER DELETE ON enabled_currencies BEGIN
  UPDATE depreciation_budget_state SET revision = revision + 1 WHERE id = 1;
END;
