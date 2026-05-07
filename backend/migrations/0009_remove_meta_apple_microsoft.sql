DROP TABLE IF EXISTS users__new;
CREATE TABLE users__new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  google_sub TEXT,
  auth_provider TEXT NOT NULL DEFAULT 'email' CHECK (auth_provider IN ('email', 'google', 'both')),
  stripe_customer_id TEXT,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO users__new (id, email, password_hash, google_sub, auth_provider, stripe_customer_id, plan, created_at)
SELECT id, email, password_hash, google_sub,
  CASE
    WHEN auth_provider IN ('meta', 'apple', 'microsoft') THEN 'email'
    WHEN auth_provider = 'both' THEN 'both'
    ELSE auth_provider
  END,
  stripe_customer_id, plan, created_at
FROM users;

DROP TABLE users;
ALTER TABLE users__new RENAME TO users;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
