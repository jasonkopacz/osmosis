-- All existing users were created via email verification, so default to 1.
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1;
