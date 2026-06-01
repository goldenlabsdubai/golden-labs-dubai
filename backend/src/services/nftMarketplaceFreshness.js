/**
 * Whether an NFT is "new" for Telegram copy (first listing / first sale on marketplace).
 * Uses PostgreSQL only — no chain RPC. Mint alerts stay separate (always "new" in mint kind).
 */
import { getPool, query } from "../config/postgres.js";

function normalizeTokenId(tokenId) {
  const tid = String(tokenId ?? "").trim();
  return /^\d+$/.test(tid) ? tid : "";
}

/** Token was sold on the marketplace before (resale / re-list scenario). */
export async function tokenHasMarketplaceSaleHistory(tokenId) {
  if (!getPool()) return false;
  const tid = normalizeTokenId(tokenId);
  if (!tid) return false;

  const { rows: purchases } = await query(
    `SELECT 1 FROM nft_purchases WHERE token_id = $1 LIMIT 1`,
    [tid]
  );
  if (purchases.length > 0) return true;

  const { rows: sold } = await query(
    `SELECT 1 FROM marketplace_processed_sales
     WHERE payload->>'tokenId' = $1
       AND COALESCE(payload->>'type', '') <> 'listed'
       AND NULLIF(TRIM(payload->>'buyer'), '') IS NOT NULL
     LIMIT 1`,
    [tid]
  );
  return sold.length > 0;
}

export async function tokenListedEventCount(tokenId) {
  if (!getPool()) return 0;
  const tid = normalizeTokenId(tokenId);
  if (!tid) return 0;
  const { rows } = await query(
    `SELECT COUNT(*)::int AS c FROM marketplace_processed_sales
     WHERE COALESCE(payload->>'type', '') = 'listed' AND payload->>'tokenId' = $1`,
    [tid]
  );
  return Number(rows[0]?.c) || 0;
}

/** First-ever marketplace listing (user mint → list, or dynamic mint → auto-list). Not re-lists after a sale. */
export async function isFreshNftListing(tokenId) {
  if (!getPool()) return false;
  const tid = normalizeTokenId(tokenId);
  if (!tid) return false;
  if (await tokenHasMarketplaceSaleHistory(tid)) return false;
  const listedCount = await tokenListedEventCount(tid);
  return listedCount <= 1;
}

/** First marketplace purchase for this token (primary sale). Not secondary trades. */
export async function isFreshNftPurchase(tokenId, options = {}) {
  if (!getPool()) return false;
  const tid = normalizeTokenId(tokenId);
  if (!tid) return false;

  const tx = options.txHash ? String(options.txHash).trim().toLowerCase() : "";
  if (tx.startsWith("0x")) {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS c FROM nft_purchases
       WHERE token_id = $1 AND LOWER(COALESCE(tx_hash, '')) <> $2`,
      [tid, tx]
    );
    return (Number(rows[0]?.c) || 0) === 0;
  }

  const { rows } = await query(
    `SELECT COUNT(*)::int AS c FROM nft_purchases WHERE token_id = $1`,
    [tid]
  );
  return (Number(rows[0]?.c) || 0) <= 1;
}
