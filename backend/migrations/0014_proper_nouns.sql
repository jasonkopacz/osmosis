CREATE TABLE IF NOT EXISTS proper_nouns (
  word TEXT PRIMARY KEY,
  reported_by TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE SET NULL
);
