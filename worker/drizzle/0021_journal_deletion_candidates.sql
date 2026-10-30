CREATE TABLE journal_history_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  retention_limit INTEGER NOT NULL DEFAULT 100
    CHECK (typeof(retention_limit) = 'integer' AND retention_limit BETWEEN 1 AND 10000)
);
INSERT INTO journal_history_settings(id, retention_limit) VALUES (1, 100);

-- No foreign keys: deleting an active entry/account/category must not erase its history.
CREATE TABLE journal_deletion_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_journal_entry_id INTEGER NOT NULL,
  is_deleted INTEGER NOT NULL DEFAULT 1 CHECK (is_deleted = 1),
  reason TEXT NOT NULL CHECK (reason IN ('deleted', 'edited')),
  archived_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot))
);

-- Archive insertion and eviction share the caller's mutation transaction.
CREATE TRIGGER journal_history_trim_after_insert AFTER INSERT ON journal_deletion_candidates
BEGIN
  DELETE FROM journal_deletion_candidates WHERE id IN (
    SELECT id FROM journal_deletion_candidates ORDER BY id DESC LIMIT -1
      OFFSET (SELECT retention_limit FROM journal_history_settings WHERE id=1)
  );
END;
CREATE TRIGGER journal_history_trim_after_limit AFTER UPDATE OF retention_limit ON journal_history_settings
BEGIN
  DELETE FROM journal_deletion_candidates WHERE id IN (
    SELECT id FROM journal_deletion_candidates ORDER BY id DESC LIMIT -1 OFFSET NEW.retention_limit
  );
END;
