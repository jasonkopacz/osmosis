-- Applied to production. Restored to fill sequence gap.
-- Microsoft OAuth support (superseded and removed by 0009_remove_meta_apple_microsoft.sql).
ALTER TABLE users ADD COLUMN microsoft_sub TEXT;

DROP TABLE IF EXISTS users__new;
CREATE TABLE users__new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  google_sub TEXT,
  meta_sub TEXT,
  apple_sub TEXT,
  microsoft_sub TEXT,
  auth_provider TEXT NOT NULL DEFAULT 'email' CHECK (auth_provider IN ('email', 'google', 'meta', 'apple', 'microsoft', 'both')),
  stripe_customer_id TEXT,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO users__new (id, email, password_hash, google_sub, meta_sub, apple_sub, microsoft_sub, auth_provider, stripe_customer_id, plan, created_at)
SELECT id, email, password_hash, google_sub, meta_sub, apple_sub, microsoft_sub, auth_provider, stripe_customer_id, plan, created_at
FROM users;

DROP TABLE users;
ALTER TABLE users__new RENAME TO users;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_meta_sub ON users(meta_sub) WHERE meta_sub IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_apple_sub ON users(apple_sub) WHERE apple_sub IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_microsoft_sub ON users(microsoft_sub) WHERE microsoft_sub IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
