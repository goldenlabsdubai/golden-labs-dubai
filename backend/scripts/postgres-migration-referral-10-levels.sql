-- Run once on existing PostgreSQL DBs to extend referral to 10 levels.
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_count_l10 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_earnings_l10 TEXT NOT NULL DEFAULT '0';
