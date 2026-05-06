ALTER TABLE translation_cache ADD COLUMN pos_tag TEXT;
-- alternatives stores JSON: [{"t":"word","p":"POS"}]
ALTER TABLE translation_cache ADD COLUMN alternatives TEXT;
