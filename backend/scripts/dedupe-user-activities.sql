-- Optional one-off: remove duplicate buy/sell rows created when both the frontend
-- /marketplace/record-purchase and the marketplace indexer called recordPurchase for the same sale.
-- Keeps the oldest id per (wallet, type, tx_hash, token_id).
-- Run manually against your DB if you still see duplicate activity rows for old data.

DELETE FROM user_activities ua
WHERE ua.id IN (
  SELECT id FROM (
    SELECT ua2.id,
           ROW_NUMBER() OVER (
             PARTITION BY ua2.wallet, ua2.type, COALESCE(LOWER(ua2.tx_hash), ''), COALESCE(ua2.token_id, '')
             ORDER BY ua2.id ASC
           ) AS rn
    FROM user_activities ua2
    WHERE ua2.type IN ('buy', 'sell')
      AND ua2.tx_hash IS NOT NULL
      AND TRIM(ua2.tx_hash) <> ''
  ) d
  WHERE d.rn > 1
);

-- After deduping, you may want to recalibrate users.total_trades from activity (example pattern only):
-- UPDATE users u SET total_trades = sub.c FROM (
--   SELECT wallet, COUNT(*)::int AS c FROM user_activities WHERE type IN ('buy','sell') GROUP BY wallet
-- ) sub WHERE LOWER(u.wallet) = sub.wallet;
