-- SRS word cards: one row per (user, word, target_lang)
-- Cards are created on the first explicit rating from the tooltip or quiz.
-- Encounter counts (passive page views) are tracked locally in the extension.
CREATE TABLE IF NOT EXISTS word_cards (
  user_id         TEXT    NOT NULL,
  word            TEXT    NOT NULL,
  target_lang     TEXT    NOT NULL,
  -- FSRS state machine
  state           TEXT    NOT NULL DEFAULT 'review' CHECK (state IN ('review', 'relearning')),
  stability       REAL    NOT NULL DEFAULT 1,   -- FSRS stability S (interval in days for 90% retention)
  difficulty      REAL    NOT NULL DEFAULT 5,   -- FSRS difficulty D (1–10, higher = harder)
  lapses          INTEGER NOT NULL DEFAULT 0,   -- times user pressed "Again" on a mature card
  reps            INTEGER NOT NULL DEFAULT 0,   -- total explicit ratings received
  -- Scheduling
  due_at          INTEGER NOT NULL DEFAULT 0,   -- unix seconds; 0 = immediately due
  last_rated_at   INTEGER,                       -- unix seconds; null = never explicitly rated
  -- Passive encounter tracking (piggy-backed from translate results)
  encounter_count INTEGER NOT NULL DEFAULT 0,   -- times this word appeared in a translation batch
  last_seen_at    INTEGER NOT NULL DEFAULT 0,   -- unix seconds
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, word, target_lang),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Efficient due-card queries for the quiz
CREATE INDEX IF NOT EXISTS idx_word_cards_due
  ON word_cards (user_id, target_lang, due_at);

-- Efficient stats queries by state
CREATE INDEX IF NOT EXISTS idx_word_cards_state
  ON word_cards (user_id, target_lang, state);
