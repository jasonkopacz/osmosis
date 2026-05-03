-- Composite index for the primary cache lookup pattern: target_lang + word IN (...)
-- Replaces the single-column target_lang index which couldn't efficiently resolve the word IN clause
DROP INDEX IF EXISTS idx_translation_cache_lang;
CREATE INDEX idx_translation_cache_lang_word ON translation_cache(target_lang, word);
