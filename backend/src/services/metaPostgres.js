/**
 * Meta and marketplace_processed_sales in PostgreSQL for indexers.
 */
import { query, getPool } from "../config/postgres.js";

const META_MARKETPLACE = "marketplaceActivityIndexer";
const META_REFERRAL = "referralIndexer";
const META_LISTING_BLOCKS = "marketplace_listing_blocks";
/** Set of tokenId strings that have an active on-chain listing (maintained by marketplaceActivityIndexer). */
const META_ACTIVE_LISTINGS = "marketplace_active_listings";

export async function getMetaPg(key) {
  const p = getPool();
  if (!p) return null;
  const { rows } = await query("SELECT data FROM meta WHERE key = $1", [key]);
  return rows[0]?.data ?? null;
}

export async function setMetaPg(key, data) {
  const p = getPool();
  if (!p) return;
  await query(
    `INSERT INTO meta (key, data, updated_at) VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET data = $2::jsonb, updated_at = NOW()`,
    [key, JSON.stringify(data && typeof data === "object" ? data : {})]
  );
}

export async function getLastProcessedBlockMarketplacePg() {
  const d = await getMetaPg(META_MARKETPLACE);
  if (!d || typeof d !== "object") return null;
  const block = d.lastProcessedBlock;
  return typeof block === "number" ? block : null;
}

export async function setLastProcessedBlockMarketplacePg(block) {
  await setMetaPg(META_MARKETPLACE, { lastProcessedBlock: block });
}

export async function getLastProcessedBlockReferralPg() {
  const d = await getMetaPg(META_REFERRAL);
  if (!d || typeof d !== "object") return null;
  const block = d.lastProcessedBlock;
  return typeof block === "number" ? block : null;
}

export async function setLastProcessedBlockReferralPg(block) {
  await setMetaPg(META_REFERRAL, { lastProcessedBlock: block });
}

export async function getListingBlocksMapPg() {
  const d = await getMetaPg(META_LISTING_BLOCKS);
  if (!d || typeof d !== "object") return {};
  return d.byTokenId && typeof d.byTokenId === "object" ? d.byTokenId : {};
}

export async function setListingBlocksMapPg(byTokenId) {
  await setMetaPg(META_LISTING_BLOCKS, { byTokenId: byTokenId && typeof byTokenId === "object" ? byTokenId : {} });
}

/** @returns {Promise<string[]>} */
export async function getActiveListingTokenIdsPg() {
  const d = await getMetaPg(META_ACTIVE_LISTINGS);
  if (!d || typeof d !== "object") return [];
  const arr = d.tokenIds;
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.map((t) => String(t)))].filter(Boolean);
}

/** @param {Iterable<string|number|bigint>} tokenIds */
export async function setActiveListingTokenIdsPg(tokenIds) {
  const sorted = [...new Set([...tokenIds].map((t) => String(t)))].filter(Boolean).sort((a, b) => Number(a) - Number(b));
  await setMetaPg(META_ACTIVE_LISTINGS, { tokenIds: sorted });
}

/** Remove token ids from the active-listing index (chain no longer shows them listed). */
export async function subtractActiveListingTokenIdsPg(ids) {
  if (!getPool() || !ids || !ids.length) return;
  const cur = await getActiveListingTokenIdsPg();
  if (!cur.length) return;
  const rm = new Set(ids.map((t) => String(t)));
  const next = cur.filter((t) => !rm.has(String(t)));
  if (next.length === cur.length) return;
  await setActiveListingTokenIdsPg(next);
}

export async function isProcessedSalePg(eventId) {
  const p = getPool();
  if (!p || !eventId) return false;
  const { rows } = await query("SELECT 1 FROM marketplace_processed_sales WHERE event_id = $1", [eventId]);
  return rows.length > 0;
}

export async function markProcessedSalePg(eventId, payload) {
  const p = getPool();
  if (!p || !eventId) return;
  const payloadJson = payload && typeof payload === "object" ? { ...payload } : {};
  await query(
    `INSERT INTO marketplace_processed_sales (event_id, payload, created_at) VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (event_id) DO NOTHING`,
    [eventId, JSON.stringify(payloadJson)]
  );
}
