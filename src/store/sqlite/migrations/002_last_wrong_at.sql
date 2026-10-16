-- 002_last_wrong_at: when a node was last marked outdated or wrong, so reads can
-- warn until someone edits or verifies it.
ALTER TABLE nodes ADD COLUMN last_wrong_at TEXT;
