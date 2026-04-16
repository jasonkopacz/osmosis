CREATE TABLE translation_cache (
  word TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  translation TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (word, target_lang)
);

CREATE INDEX idx_translation_cache_lang ON translation_cache(target_lang);
