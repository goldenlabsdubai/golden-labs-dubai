-- Step 2: PostgreSQL schema for Golden Labs (replaces Firestore collections)
-- Run this once against your RDS database (e.g. psql or any SQL client)
-- Database name: goldenlabs

-- ========== USERS (was Firestore "users") ==========
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  wallet TEXT,
  firebase_uid TEXT,
  email TEXT,
  username TEXT,
  name TEXT,
  bio TEXT,
  avatar TEXT,
  website_url TEXT,
  x_url TEXT,
  telegram_url TEXT,
  total_trades INTEGER NOT NULL DEFAULT 0,
  nonce TEXT,
  state TEXT NOT NULL DEFAULT 'CONNECTED',
  referrer TEXT,
  referral_count_l1 INTEGER NOT NULL DEFAULT 0,
  referral_count_l2 INTEGER NOT NULL DEFAULT 0,
  referral_count_l3 INTEGER NOT NULL DEFAULT 0,
  referral_count_l4 INTEGER NOT NULL DEFAULT 0,
  referral_count_l5 INTEGER NOT NULL DEFAULT 0,
  total_referrals INTEGER NOT NULL DEFAULT 0,
  referral_earnings_l1 TEXT NOT NULL DEFAULT '0',
  referral_earnings_l2 TEXT NOT NULL DEFAULT '0',
  referral_earnings_l3 TEXT NOT NULL DEFAULT '0',
  referral_earnings_l4 TEXT NOT NULL DEFAULT '0',
  referral_earnings_l5 TEXT NOT NULL DEFAULT '0',
  referral_earnings_total TEXT NOT NULL DEFAULT '0',
  last_activity TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  owned_token_ids JSONB DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_users_wallet ON users (wallet);
CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users (firebase_uid);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (LOWER(username));
CREATE INDEX IF NOT EXISTS idx_users_total_trades ON users (total_trades DESC);

-- ========== USER_ACTIVITIES (was Firestore "user_activities") ==========
CREATE TABLE IF NOT EXISTS user_activities (
  id SERIAL PRIMARY KEY,
  wallet TEXT NOT NULL,
  type TEXT NOT NULL,
  token_id TEXT,
  price TEXT,
  tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_activities_wallet ON user_activities (wallet);
CREATE INDEX IF NOT EXISTS idx_user_activities_wallet_created ON user_activities (wallet, created_at DESC);

-- ========== NFT_PURCHASES (was Firestore "nft_purchases") ==========
CREATE TABLE IF NOT EXISTS nft_purchases (
  id TEXT PRIMARY KEY,
  buyer TEXT NOT NULL,
  seller TEXT,
  token_id TEXT NOT NULL,
  price TEXT NOT NULL,
  tx_hash TEXT,
  event_id TEXT,
  block_number INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nft_purchases_buyer ON nft_purchases (buyer);
CREATE INDEX IF NOT EXISTS idx_nft_purchases_seller ON nft_purchases (seller);

-- ========== ADMINS (was Firestore "admins") ==========
CREATE TABLE IF NOT EXISTS admins (
  wallet TEXT PRIMARY KEY,
  nonce TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========== BOT_CONTROL (was Firestore "bot_control" doc "bots") ==========
CREATE TABLE IF NOT EXISTS bot_control (
  id TEXT PRIMARY KEY DEFAULT 'bots',
  running_by_bot_id JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO bot_control (id, running_by_bot_id) VALUES ('bots', '{}')
ON CONFLICT (id) DO NOTHING;

-- ========== ADMIN_SETTINGS (was Firestore "admin_settings" doc "contracts") ==========
CREATE TABLE IF NOT EXISTS admin_settings (
  id TEXT PRIMARY KEY,
  addresses JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);

INSERT INTO admin_settings (id, addresses) VALUES ('contracts', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ========== MARKETPLACE_PROCESSED_SALES (was Firestore "marketplace_processed_sales") ==========
CREATE TABLE IF NOT EXISTS marketplace_processed_sales (
  event_id TEXT PRIMARY KEY,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========== META (indexer state & listing blocks; was Firestore "meta" collection) ==========
-- Docs: marketplaceActivityIndexer, referralIndexer, marketplace_listing_blocks
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  data JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Optional: insert placeholder keys so code can upsert by key
INSERT INTO meta (key, data) VALUES
  ('marketplaceActivityIndexer', '{"lastProcessedBlock": null}'),
  ('referralIndexer', '{"lastProcessedBlock": null}'),
  ('marketplace_listing_blocks', '{"byTokenId": {}}')
ON CONFLICT (key) DO NOTHING;
