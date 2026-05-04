-- One-time: merge referral_earnings from duplicate rows where the indexer used id = wallet,
-- while the real profile row is firebase_* with the same users.wallet.
-- Run against goldenlabs after deploying userPostgres canonical-wallet lookup.
-- Review with SELECT before DELETE.

-- Preview pairs (optional):
-- SELECT prof.id AS profile_id, sh.id AS shell_id, prof.wallet, sh.referral_earnings_total AS shell_total
-- FROM users prof
-- INNER JOIN users sh ON LOWER(TRIM(prof.wallet)) = LOWER(TRIM(sh.id))
-- WHERE prof.firebase_uid IS NOT NULL AND BTRIM(prof.firebase_uid) <> ''
--   AND sh.id LIKE '0x%' AND prof.id <> sh.id;

UPDATE users AS prof
SET
  referral_earnings_l1 = (COALESCE(prof.referral_earnings_l1, '0')::numeric + COALESCE(sh.referral_earnings_l1, '0')::numeric)::text,
  referral_earnings_l2 = (COALESCE(prof.referral_earnings_l2, '0')::numeric + COALESCE(sh.referral_earnings_l2, '0')::numeric)::text,
  referral_earnings_l3 = (COALESCE(prof.referral_earnings_l3, '0')::numeric + COALESCE(sh.referral_earnings_l3, '0')::numeric)::text,
  referral_earnings_l4 = (COALESCE(prof.referral_earnings_l4, '0')::numeric + COALESCE(sh.referral_earnings_l4, '0')::numeric)::text,
  referral_earnings_l5 = (COALESCE(prof.referral_earnings_l5, '0')::numeric + COALESCE(sh.referral_earnings_l5, '0')::numeric)::text,
  referral_earnings_l6 = (COALESCE(prof.referral_earnings_l6, '0')::numeric + COALESCE(sh.referral_earnings_l6, '0')::numeric)::text,
  referral_earnings_l7 = (COALESCE(prof.referral_earnings_l7, '0')::numeric + COALESCE(sh.referral_earnings_l7, '0')::numeric)::text,
  referral_earnings_l8 = (COALESCE(prof.referral_earnings_l8, '0')::numeric + COALESCE(sh.referral_earnings_l8, '0')::numeric)::text,
  referral_earnings_l9 = (COALESCE(prof.referral_earnings_l9, '0')::numeric + COALESCE(sh.referral_earnings_l9, '0')::numeric)::text,
  referral_earnings_l10 = (COALESCE(prof.referral_earnings_l10, '0')::numeric + COALESCE(sh.referral_earnings_l10, '0')::numeric)::text,
  referral_earnings_total = (COALESCE(prof.referral_earnings_total, '0')::numeric + COALESCE(sh.referral_earnings_total, '0')::numeric)::text,
  last_activity = NOW()
FROM users AS sh
WHERE prof.firebase_uid IS NOT NULL AND BTRIM(prof.firebase_uid) <> ''
  AND prof.wallet IS NOT NULL AND BTRIM(prof.wallet) <> ''
  AND LOWER(TRIM(prof.wallet)) = LOWER(TRIM(sh.id))
  AND sh.id LIKE '0x%'
  AND prof.id <> sh.id;

DELETE FROM users AS sh
USING users AS prof
WHERE prof.firebase_uid IS NOT NULL AND BTRIM(prof.firebase_uid) <> ''
  AND prof.wallet IS NOT NULL AND BTRIM(prof.wallet) <> ''
  AND LOWER(TRIM(prof.wallet)) = LOWER(TRIM(sh.id))
  AND sh.id LIKE '0x%'
  AND prof.id <> sh.id;
