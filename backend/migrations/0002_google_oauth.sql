ALTER TABLE users ADD COLUMN google_sub TEXT;
ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'email' CHECK (auth_provider IN ('email', 'google', 'both'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;
