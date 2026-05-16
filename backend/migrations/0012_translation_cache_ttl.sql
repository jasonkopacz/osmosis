ALTER TABLE translation_cache ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0;
-- Give all existing rows a 90-day window from migration time so they are not
-- immediately invalidated.
UPDATE translation_cache SET expires_at = unixepoch() + 7776000;
