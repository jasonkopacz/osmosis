CREATE TABLE IF NOT EXISTS bad_translation (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL,
  word TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  bad_translation TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bad_translation_word ON bad_translation(word, target_lang);
