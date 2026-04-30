/**
 * Postgres-backed queue of user listing candidates for bots (replaces Listed getLogs when BOT_LISTING_SOURCE=database).
 * Uses marketplace_processed_sales (indexer) + meta.marketplace_listing_blocks timestamps.
 */
import { query, getPool } from "../config/postgres.js";
import { getMarketplaceAndReservePoolAddress } from "../config/contractsEnv.js";
import * as MetaPg from "./metaPostgres.js";
import * as BotService from "./botService.js";

function normAddr(a) {
  if (!a || typeof a !== "string") return "";
  const s = a.trim().toLowerCase();
  if (!s) return "";
  return s.startsWith("0x") ? s : `0x${s}`;
}

/**
 * Latest Listed row per token, excluding tokens whose latest Sold block is >= that list block.
 * Filters marketplace contract and configured BOT_1..5 sellers in app code (same env as bots).
 */
export async function getBotListingQueueCandidates({ limit = 500 } = {}) {
  if (!getPool()) return [];

  const maxRows = Math.max(1, Math.min(Number(limit) || 500, 2000));

  const sql = `
WITH listed AS (
  SELECT
    trim(payload->>'tokenId') AS token_id,
    (payload->>'blockNumber')::bigint AS list_block,
    lower(trim(coalesce(payload->>'seller', ''))) AS seller,
    trim(coalesce(payload->>'price', '')) AS price_wei
  FROM marketplace_processed_sales
  WHERE payload->>'type' = 'listed'
    AND trim(coalesce(payload->>'tokenId', '')) <> ''
),
sold_max AS (
  SELECT
    trim(payload->>'tokenId') AS token_id,
    max((payload->>'blockNumber')::bigint) AS max_sold_block
  FROM marketplace_processed_sales
  WHERE trim(coalesce(payload->>'buyer', '')) <> ''
    AND trim(coalesce(payload->>'tokenId', '')) <> ''
  GROUP BY 1
),
latest_listed AS (
  SELECT DISTINCT ON (token_id)
    token_id,
    list_block,
    seller,
    price_wei
  FROM listed
  ORDER BY token_id, list_block DESC
)
SELECT
  ll.token_id AS "tokenId",
  ll.seller,
  ll.price_wei AS "priceWei",
  ll.list_block AS "listBlockNumber"
FROM latest_listed ll
LEFT JOIN sold_max sm ON sm.token_id = ll.token_id
WHERE ll.list_block > coalesce(sm.max_sold_block, -1)
  AND ll.seller IS NOT NULL
  AND ll.seller <> ''
ORDER BY ll.list_block ASC
LIMIT $1
`;

  const { rows } = await query(sql, [maxRows]);

  const marketplaceLc = normAddr(getMarketplaceAndReservePoolAddress());
  const botSet = new Set(BotService.getBotConfig().map((b) => normAddr(b.address)));

  let blocksMap = {};
  try {
    blocksMap = await MetaPg.getListingBlocksMapPg();
  } catch (e) {
    console.warn("getBotListingQueueCandidates meta:", e?.message);
  }

  const out = [];
  for (const r of rows) {
    const tid = String(r.tokenId || "").trim();
    if (!tid) continue;
    const seller = String(r.seller || "").toLowerCase();
    if (!seller) continue;
    if (marketplaceLc && seller === marketplaceLc) continue;
    if (botSet.has(seller)) continue;

    let listedAtMs = null;
    const meta = blocksMap[tid];
    if (meta && typeof meta === "object") {
      const ts = meta.timestamp;
      if (typeof ts === "number" && Number.isFinite(ts) && ts > 0) {
        listedAtMs = Math.floor(ts);
      } else if (typeof ts === "string" && ts.trim() !== "") {
        const n = Number(ts);
        if (Number.isFinite(n) && n > 0) listedAtMs = Math.floor(n);
      }
    }

    out.push({
      tokenId: tid,
      seller,
      priceWei: String(r.priceWei || "0"),
      listBlockNumber: r.listBlockNumber != null ? String(r.listBlockNumber) : null,
      listedAtMs,
    });
  }
  return out;
}
