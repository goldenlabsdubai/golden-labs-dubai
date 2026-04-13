-- =============================================================================
-- DESTRUCTIVE: Deletes ALL application data in PostgreSQL (Golden Labs RDS).
-- Keeps table structure. Run ONLY after a backup if you might need old data.
--
-- Usage (from machine with network access to RDS, e.g. EC2):
--   cd backend && export $(grep -v '^#' .env | xargs) && psql "$DATABASE_URL" -f scripts/postgres-reset-all-data.sql
-- Or with discrete vars:
--   PGPASSWORD=... psql -h ... -U ... -d goldenlabs -f scripts/postgres-reset-all-data.sql
--
-- After this:
--   1. npm run seed-admins          (restores default admin wallet in `admins`)
--   2. Restart backend + PM2        (indexers restart from genesis blocks in .env)
-- =============================================================================

BEGIN;

-- Activity / marketplace / users (no FKs in schema — order is flexible)
TRUNCATE TABLE user_activities RESTART IDENTITY CASCADE;
TRUNCATE TABLE nft_purchases CASCADE;
TRUNCATE TABLE marketplace_processed_sales CASCADE;
TRUNCATE TABLE users CASCADE;

-- Admin logins — cleared; run `npm run seed-admins` after this script
TRUNCATE TABLE admins CASCADE;

-- Bot run/stop state — empty JSON
UPDATE bot_control SET running_by_bot_id = '{}'::jsonb, updated_at = NOW() WHERE id = 'bots';

-- Optional stored contract overrides in DB (admin panel) — clear
UPDATE admin_settings SET addresses = '{}'::jsonb, updated_at = NOW(), updated_by = NULL WHERE id = 'contracts';

-- Indexer checkpoints — force re-scan from REFERRAL_INDEXER_FROM_BLOCK / MARKETPLACE_* in .env
UPDATE meta SET data = '{"lastProcessedBlock": null}'::jsonb, updated_at = NOW() WHERE key = 'referralIndexer';
UPDATE meta SET data = '{"lastProcessedBlock": null}'::jsonb, updated_at = NOW() WHERE key = 'marketplaceActivityIndexer';
UPDATE meta SET data = '{"byTokenId": {}}'::jsonb, updated_at = NOW() WHERE key = 'marketplace_listing_blocks';

COMMIT;

-- Verify counts (should be 0 for users)
-- SELECT 'users', COUNT(*) FROM users UNION ALL SELECT 'user_activities', COUNT(*) FROM user_activities;
