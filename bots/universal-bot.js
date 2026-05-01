/**
 * Universal Auto Trading Bot (Bot 1..5)
 *
 * Usage:
 *   node universal-bot.js 1
 *   BOT_ID=2 node universal-bot.js
 *   Crash restart (no PM2): node bot-supervisor.mjs 1  or  npm run bot1:supervise
 *   Production: pm2 start ecosystem.config.cjs
 *
 * Env keys used:
 *   RPC_URL
 *   CHAIN_ID or BOT_CHAIN_ID — e.g. 97 (BSC testnet), 56 (BSC mainnet); pins network to avoid eth_chainId RPS issues
 *   MARKETPLACE_AND_RESERVE_POOL_CONTRACT_ADDRESS (legacy: MARKETPLACE_CONTRACT_ADDRESS)
 *   NFT_CONTRACT_ADDRESS
 *   USDT_ADDRESS
 *   BOT1_PRIVATE_KEY … BOT5_PRIVATE_KEY
 *   BOT_USER_BUYBACK_SAFETY_SWEEP_MS — re-sync if Listed events missed (default 300000)
 *   BOT_USER_BUYBACK_WAIT_CHUNK_MS — max ms between light RPC checks while waiting buyback delay (default 60000)
 *   BOT_SKIP_LIST_STATIC_SIMULATE — if "true", skip eth_call simulation for list() only (dynamic mint tail can make eth_call look like a custom error)
 *   BOT_RELIST_OWNER_RPC_GAP_MS — delay between ownerOf calls during relist scan (default 60; 0 = no gap)
 *   BOT_LISTED_POLL_MS — how often to scan for Listed via getLogs (default 20000; avoids eth_getFilterChanges)
 *   BOT_LISTED_LOGS_CHUNK_BLOCKS — max block span per getLogs chunk (default 400)
 *   BOT_LISTED_CATCHUP_BLOCKS — on first poll, start this many blocks behind head (default 128)
 *   BOT_EVENT_PENDING_QUEUE — keep user listing candidates from Listed events only (default true; avoids full mint scan)
 *   BOT_LISTING_SOURCE — rpc (default), database, api (or listings). database = GET /api/bot-control/listing-queue. api = GET /api/marketplace/listings (same listedAt as UI; oldest-first buyback).
 *   BOT_LISTING_QUEUE_URL — optional full URL to listing-queue; else uses BOT_CONTROL_BASE_URL + /listing-queue
 *   BOT_MARKETPLACE_LISTINGS_URL — optional full URL to GET /marketplace/listings; else derived from BOT_CONTROL_BASE_URL (/bot-control → /marketplace/listings)
 *   BOT_LISTING_QUEUE_POLL_MS — poll interval for database / api listing source (default BOT_LISTED_POLL_MS)
 *   BOT_SINGLE_CHAIN_LISTENER — if true (default), one process polls **on-chain** getLogs (Listed/Sold): lowest **admin-running** bot id. **Not** used for HTTP listing sources: database / api listing-queue + marketplace polls run in **every** bot process so followers always have the same queue as the leader.
 *   User buyback (parallel): queue sorted by listedAt (oldest first). Running bots (from admin, or all key-configured ids if admin list is empty) take slot 0,1,2… on **unlocked** rows only — rows with an active `.locks/token-*.lock` are skipped so peers pick the next oldest.
 *   BOT_CHAIN_LISTENER_BOT_ID — optional override only (forces which id listens; normally omit and use admin Start/Stop).
 *   BOT_RELIST_RETRY_MIN_MS / BOT_RELIST_RETRY_MAX_MS — random backoff between relist retries (default 60s–5m)
 *   BOT_BOOTSTRAP_LISTING_SCAN — one-time full mint scan on startup to seed pending file (default false; heavy)
 */
import "dotenv/config";
import { ethers, Network } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { LIST_PRICE_WEI } from "./config.js";

/** Exit non-zero so PM2 or `node bot-supervisor.mjs` can restart the process. */
process.on("unhandledRejection", (reason) => {
  console.error("[bot fatal] unhandledRejection:", reason);
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  console.error("[bot fatal] uncaughtException:", err);
  process.exit(1);
});

const RPC = process.env.RPC_URL || "http://127.0.0.1:8545";
/** If set, skips automatic chain detection (fewer RPC calls; avoids RPS failures during startup). BSC testnet = 97, BSC mainnet = 56. */
const BOT_CHAIN_ID_RAW = process.env.CHAIN_ID || process.env.BOT_CHAIN_ID || "";
const BOT_CHAIN_ID = (() => {
  const s = String(BOT_CHAIN_ID_RAW || "").trim();
  if (!s) return NaN;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : NaN;
})();
const MARKETPLACE_ADDR =
  process.env.MARKETPLACE_AND_RESERVE_POOL_CONTRACT_ADDRESS || process.env.MARKETPLACE_CONTRACT_ADDRESS;
const NFT_ADDR = process.env.NFT_CONTRACT_ADDRESS;
const USDT_ADDR = process.env.USDT_ADDRESS;
/** When CHAIN_ID is unset, infer from common RPC host patterns so JsonRpcProvider skips detectNetwork (saves RPS). */
function inferChainIdFromRpcUrl(url) {
  const u = String(url || "").toLowerCase();
  if (
    u.includes("bsc-testnet") ||
    u.includes("chapel") ||
    u.includes("prebsc") ||
    (u.includes("chainstack") && u.includes("testnet"))
  ) {
    return 97;
  }
  if (u.includes("bsc-mainnet") || u.includes("bsc-dataseed") || u.includes("binance.org/nodes")) {
    return 56;
  }
  return NaN;
}
const RESOLVED_CHAIN_ID = (() => {
  if (Number.isFinite(BOT_CHAIN_ID) && BOT_CHAIN_ID > 0) return BOT_CHAIN_ID;
  return inferChainIdFromRpcUrl(RPC);
})();
const LOCK_TTL_MS = Number(process.env.BOT_LOCK_TTL_MS || 2 * 60 * 1000);
const CONTROL_REFRESH_MS = Number(process.env.BOT_CONTROL_REFRESH_MS || 5000);
const CONTROL_REQUEST_TIMEOUT_MS = Number(process.env.BOT_CONTROL_REQUEST_TIMEOUT_MS || 4000);
const BOT_CONTROL_BASE_URL = process.env.BOT_CONTROL_BASE_URL || "http://localhost:3001/api/bot-control";
const BOT_CONTROL_API_KEY = process.env.BOT_CONTROL_API_KEY || "";
const BOT_RECORD_PURCHASE_URL =
  process.env.BOT_RECORD_PURCHASE_URL || "http://127.0.0.1:3001/api/marketplace/record-purchase";
const USER_LISTINGS_CACHE_MS = Number(process.env.BOT_USER_LISTINGS_CACHE_MS || 10000);
const ACTIVE_SCAN_BATCH_SIZE = Number(process.env.BOT_ACTIVE_SCAN_BATCH_SIZE || 40);
/** Fallback full sweep interval (safety net if events missed). Default 5 min — primary timing uses oldest-list + internal wait. */
const USER_BUYBACK_SAFETY_SWEEP_MS = Number(process.env.BOT_USER_BUYBACK_SAFETY_SWEEP_MS || 300000);
/** During buyback wait, re-check target listing + admin settings at most this often (ms). */
const USER_BUYBACK_WAIT_CHUNK_MS = Number(process.env.BOT_USER_BUYBACK_WAIT_CHUNK_MS || 60000);
const RELIST_CHECK_MS = Number(process.env.BOT_RELIST_CHECK_MS || 30000);
const RELIST_SCAN_BATCH_SIZE = Number(process.env.BOT_RELIST_SCAN_BATCH_SIZE || 40);
const RELIST_MAX_PER_RUN = Number(process.env.BOT_RELIST_MAX_PER_RUN || 3);
/** Pause between each ownerOf during relist scan (0 = no gap). Reduces RPS bursts on low Chainstack tiers. */
const RELIST_OWNER_RPC_GAP_MS = Math.max(0, Number(process.env.BOT_RELIST_OWNER_RPC_GAP_MS ?? 60));
/**
 * Listed discovery: ethers `contract.on` uses eth_newFilter + eth_getFilterChanges every poll — brutal on Chainstack RPS.
 * Instead we poll getLogs on an interval (see pollListedEventsLoop).
 */
const LISTED_POLL_MS = Math.max(4000, Number(process.env.BOT_LISTED_POLL_MS ?? 20000));
const LISTED_LOGS_CHUNK_BLOCKS = Math.max(30, Math.min(Number(process.env.BOT_LISTED_LOGS_CHUNK_BLOCKS ?? 400), 8000));
const LISTED_CATCHUP_BLOCKS = Math.max(0, Math.min(Number(process.env.BOT_LISTED_CATCHUP_BLOCKS ?? 128), 50_000));
const INTER_BOT_COOLDOWN_MS = Number(process.env.BOT_INTERBOT_COOLDOWN_MS || 24 * 60 * 60 * 1000);
const USER_LISTING_MIN_AGE_MS = Number(process.env.BOT_USER_LISTING_MIN_AGE_MS || 60 * 60 * 1000);
/** Max blocks to scan backward for latest Listed(tokenId) when resolving listing time (startup sweep). */
const LISTED_EVENT_LOOKBACK_BLOCKS = Math.max(
  1000,
  Number(process.env.BOT_LISTED_EVENT_LOOKBACK_BLOCKS || 120_000)
);
const BUY_MAX_ATTEMPTS = Math.max(1, Math.min(Number(process.env.BOT_BUY_MAX_ATTEMPTS || 2), 5));
const RELIST_AFTER_BUY_MAX_ATTEMPTS = Math.max(1, Math.min(Number(process.env.BOT_RELIST_AFTER_BUY_MAX_ATTEMPTS || 4), 10));
const RELIST_RETRY_GAP_MS = Math.max(500, Number(process.env.BOT_RELIST_RETRY_GAP_MS || 2500));
/** Randomized relist backoff (preferred over RELIST_RETRY_GAP_MS when both min/max set). */
const RELIST_RETRY_MIN_MS = Math.max(5000, Number(process.env.BOT_RELIST_RETRY_MIN_MS ?? 60_000));
const RELIST_RETRY_MAX_MS = Math.max(
  RELIST_RETRY_MIN_MS,
  Number(process.env.BOT_RELIST_RETRY_MAX_MS ?? 300_000)
);
const BUY_RETRY_GAP_MS = Math.max(500, Number(process.env.BOT_BUY_RETRY_GAP_MS || 2000));
/** Bot 2+ waits (id-1) * this ms before competing for the same token lock (bot 1 tries first). */
/** True: user buyback candidates come from Listed events + small validation reads only (no full supply scan). */
const USE_EVENT_PENDING_QUEUE =
  String(process.env.BOT_EVENT_PENDING_QUEUE ?? "true").toLowerCase() !== "false";
/** Only one bot process runs getLogs (Listed/Sold/Cancel) — set false for legacy dual-listener. */
const BOT_SINGLE_CHAIN_LISTENER =
  String(process.env.BOT_SINGLE_CHAIN_LISTENER ?? "true").toLowerCase() !== "false";
/** Optional: force chain listener id (overrides admin “lowest running bot id” election). */
const BOT_CHAIN_LISTENER_BOT_ID_ENV = String(process.env.BOT_CHAIN_LISTENER_BOT_ID || "").trim();
const BOT_BOOTSTRAP_LISTING_SCAN =
  String(process.env.BOT_BOOTSTRAP_LISTING_SCAN ?? "false").toLowerCase() === "true";
/** When database, universal listener fills pending queue from backend Postgres instead of Listed/Sold getLogs. When api/listings, from GET /api/marketplace/listings (listedAt ms). */
const BOT_LISTING_SOURCE = String(process.env.BOT_LISTING_SOURCE || "rpc").toLowerCase();
const BOT_LISTING_QUEUE_URL = String(process.env.BOT_LISTING_QUEUE_URL || "").trim();
const BOT_MARKETPLACE_LISTINGS_URL = String(process.env.BOT_MARKETPLACE_LISTINGS_URL || "").trim();
const USE_DB_LISTING_QUEUE = BOT_LISTING_SOURCE === "database" && USE_EVENT_PENDING_QUEUE;
const USE_MARKETPLACE_LISTINGS_API =
  (BOT_LISTING_SOURCE === "api" || BOT_LISTING_SOURCE === "listings") && USE_EVENT_PENDING_QUEUE;
const USE_HTTP_LISTING_DISCOVERY = USE_DB_LISTING_QUEUE || USE_MARKETPLACE_LISTINGS_API;
const LISTING_DISCOVERY_POLL_MS = USE_HTTP_LISTING_DISCOVERY
  ? Math.max(4000, Number(process.env.BOT_LISTING_QUEUE_POLL_MS ?? LISTED_POLL_MS))
  : LISTED_POLL_MS;

function resolveMarketplaceListingsUrl() {
  const explicit = (BOT_MARKETPLACE_LISTINGS_URL || "").replace(/\/$/, "");
  if (explicit) return explicit;
  const base = (BOT_CONTROL_BASE_URL || "").replace(/\/$/, "");
  if (/\/bot-control$/i.test(base)) return base.replace(/\/bot-control$/i, "/marketplace/listings");
  return "";
}
const POST_APPROVE_DELAY_MS = Number(process.env.BOT_POST_APPROVE_DELAY_MS || 2000);
/** Extra wait after NFT approve is mined, before `list` (defaults to same as USDT delay). */
const POST_NFT_APPROVE_DELAY_MS =
  process.env.BOT_POST_NFT_APPROVE_DELAY_MS !== undefined && String(process.env.BOT_POST_NFT_APPROVE_DELAY_MS).trim() !== ""
    ? Number(process.env.BOT_POST_NFT_APPROVE_DELAY_MS)
    : POST_APPROVE_DELAY_MS;
/** Block confirmations to wait on approve txs (1 = first receipt, 2+ = safer on reorgs). */
const APPROVE_TX_CONFIRMATIONS = Math.max(1, Math.min(Number(process.env.BOT_APPROVE_TX_CONFIRMATIONS || 1), 32));
const RPC_POLLING_INTERVAL_MS = Number(process.env.BOT_RPC_POLLING_INTERVAL_MS || 20000);
const BOT_TX_GAS_GWEI = Number(process.env.BOT_TX_GAS_GWEI || 3);
const BOT_GAS_LIMIT_APPROVE = Number(process.env.BOT_GAS_LIMIT_APPROVE || 120000);
const BOT_GAS_LIMIT_BUY = Number(process.env.BOT_GAS_LIMIT_BUY || 350000);
const BOT_GAS_LIMIT_LIST = Number(process.env.BOT_GAS_LIMIT_LIST || 350000);
/** eth_call simulation before buy/list — avoids broadcasting txs that would revert (saves BNB). Default on. */
const BOT_STATIC_SIMULATE =
  String(process.env.BOT_STATIC_SIMULATE ?? "true").toLowerCase() !== "false";
const BOT_SKIP_USDT_APPROVE_IF_OK =
  String(process.env.BOT_SKIP_USDT_APPROVE_IF_OK ?? "true").toLowerCase() !== "false";
const BOT_SKIP_NFT_APPROVE_IF_OK =
  String(process.env.BOT_SKIP_NFT_APPROVE_IF_OK ?? "true").toLowerCase() !== "false";
const BOT_SKIP_LIST_STATIC_SIMULATE =
  String(process.env.BOT_SKIP_LIST_STATIC_SIMULATE ?? "false").toLowerCase() === "true";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOCK_DIR = path.join(__dirname, ".locks");
const COOLDOWN_FILE = path.join(__dirname, ".bot-intercooldowns.json");
const LISTING_TIMESTAMPS_FILE = path.join(__dirname, ".bot-listing-timestamps.json");
/** Shared across PM2 bots: user listings discovered via events (seller ≠ marketplace, ∉ bots). */
const PENDING_USER_LISTINGS_FILE = path.join(__dirname, ".bot-pending-user-listings.json");
/** Last block scanned for Listed/Sold/ListingCancelled — shared so listener handoff does not skip logs. */
const LISTENER_CURSOR_FILE = path.join(__dirname, ".bot-listener-cursor.json");

function resolveBotId() {
  const argId = (process.argv[2] || "").trim();
  const envId = (process.env.BOT_ID || "").trim();
  const raw = argId || envId || "1";
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1 || id > 5) {
    throw new Error(`Invalid bot id "${raw}". Use 1..5.`);
  }
  return String(id);
}

function pendingPriceMatchesRecord(meta) {
  try {
    if (!meta?.priceWei) return true;
    return BigInt(String(meta.priceWei)) === LIST_PRICE_WEI;
  } catch {
    return false;
  }
}

const marketplaceAbi = [
  "function listings(uint256) view returns (address seller, uint256 tokenId, uint256 price, bool active)",
  "function listingListedAt(uint256) view returns (uint64)",
  "function isBotTrader(address) view returns (bool)",
  "function listPrice() view returns (uint256)",
  "event Listed(uint256 indexed tokenId, address indexed seller, uint256 price)",
  "event Sold(uint256 indexed tokenId, address seller, address buyer, uint256 price)",
  "event ListingCancelled(uint256 indexed tokenId)",
  "function buy(uint256 tokenId, address referrer)",
  "function list(uint256 tokenId, uint256 price)",
];
const nftAbi = [
  "function approve(address, uint256) returns (bool)",
  "function getApproved(uint256 tokenId) view returns (address)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function totalMinted() view returns (uint256)",
];
const usdtAbi = [
  "function approve(address, uint256) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];

function ensureLockDir() {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
}

function lockPathForToken(tokenId) {
  return path.join(LOCK_DIR, `token-${tokenId}.lock`);
}

async function acquireTokenLock(tokenId) {
  ensureLockDir();
  const p = lockPathForToken(tokenId);
  const now = Date.now();
  try {
    const handle = await fs.promises.open(p, "wx");
    await handle.writeFile(String(now));
    return { path: p, handle };
  } catch (e) {
    if (e?.code !== "EEXIST") return null;
    try {
      const stat = await fs.promises.stat(p);
      if (now - stat.mtimeMs > LOCK_TTL_MS) {
        await fs.promises.unlink(p).catch(() => {});
        const handle = await fs.promises.open(p, "wx");
        await handle.writeFile(String(now));
        return { path: p, handle };
      }
    } catch (_) {}
    return null;
  }
}

async function releaseTokenLock(lock) {
  if (!lock) return;
  try {
    await lock.handle?.close();
  } catch (_) {}
  try {
    await fs.promises.unlink(lock.path);
  } catch (_) {}
}

/** True if another bot holds a non-expired buy lock for this token (parallel buyback: skip this row). */
function isTokenLockFileHeld(tokenIdStr) {
  const tid = String(tokenIdStr ?? "").trim();
  if (!tid) return false;
  const p = lockPathForToken(tid);
  const now = Date.now();
  try {
    const st = fs.statSync(p);
    return now - st.mtimeMs <= LOCK_TTL_MS;
  } catch {
    return false;
  }
}

async function main() {
  const botId = resolveBotId();
  const keyVar = `BOT${botId}_PRIVATE_KEY`;
  const privateKey = process.env[keyVar];
  const isConfigured = privateKey && MARKETPLACE_ADDR && NFT_ADDR && USDT_ADDR;

  if (!isConfigured) {
    console.log(
      `Bot ${botId} idle - set ${keyVar}, MARKETPLACE_AND_RESERVE_POOL_CONTRACT_ADDRESS, NFT_CONTRACT_ADDRESS, USDT_ADDRESS in bots/.env`
    );
    return;
  }

  // staticNetwork + explicit chain avoids extra eth_chainId / detectNetwork traffic (helps on low RPS plans).
  const staticNetwork =
    Number.isFinite(RESOLVED_CHAIN_ID) && RESOLVED_CHAIN_ID > 0
      ? Network.from(RESOLVED_CHAIN_ID)
      : undefined;
  const provider = new ethers.JsonRpcProvider(RPC, staticNetwork, { staticNetwork: true });
  provider.pollingInterval = Math.max(4000, RPC_POLLING_INTERVAL_MS);
  if (Number.isFinite(RESOLVED_CHAIN_ID) && RESOLVED_CHAIN_ID > 0) {
    const src =
      Number.isFinite(BOT_CHAIN_ID) && BOT_CHAIN_ID > 0 ? "CHAIN_ID/BOT_CHAIN_ID" : "RPC_URL (inferred)";
    console.log(`Bot ${botId}: RPC chain pinned CHAIN_ID=${RESOLVED_CHAIN_ID} (${src})`);
  } else {
    console.warn(
      `Bot ${botId}: set CHAIN_ID in .env (e.g. 97 BSC testnet, 56 BSC mainnet) to skip network auto-detect and reduce RPC usage`
    );
  }
  const wallet = new ethers.Wallet(privateKey, provider);
  const self = wallet.address.toLowerCase();
  const marketplace = new ethers.Contract(MARKETPLACE_ADDR, marketplaceAbi, wallet);
  /** Read-only contract for view calls (no wallet sender on eth_call). */
  const marketplaceRead = new ethers.Contract(MARKETPLACE_ADDR, marketplaceAbi, provider);
  const nft = new ethers.Contract(NFT_ADDR, nftAbi, wallet);
  const usdt = new ethers.Contract(USDT_ADDR, usdtAbi, wallet);
  let queue = Promise.resolve();
  let cachedEnabled = true;
  let botTraderEligible = null;
  let lastControlFetchAt = 0;
  let hadControlError = false;
  let wasEnabled = false;
  let canScanByTotalMinted = true;
  let warnedTotalMintedUnavailable = false;
  let cachedHasUserListings = false;
  let lastUserListingsCheckAt = 0;
  const knownBotWallets = new Set();
  /** Lowercase marketplace address — listings from this seller are dynamic/system supply. */
  let marketLc = "";
  const interBotCooldowns = readInterBotCooldowns();
  let listingTimestamps = readListingTimestamps();
  /** Listener-owned mirror of pending file; traders re-read file when not leader. */
  let pendingUserListings = readPendingUserListingsFile();
  /** Set by refreshUniversalListenerRole(): this process runs getLogs (admin: lowest running bot id). */
  let runsChainPoll = false;
  let wasUniversalChainListener = false;
  let dynamicUserListingMinAgeMs = Math.max(60_000, USER_LISTING_MIN_AGE_MS);
  /** Bump to cancel in-flight buyback wait; new Listed events reschedule oldest-list logic. */
  let userBuybackGeneration = 0;
  /** Last block fully scanned for Listed logs (getLogs polling; avoids contract.on filter RPC spam). */
  let lastListedBlockScanned = null;

  async function getListingListedAtMs(tokenId) {
    try {
      const sec = await marketplace.listingListedAt(tokenId);
      const n = sec != null ? Number(sec) : 0;
      if (Number.isFinite(n) && n > 0) return n * 1000;
      return null;
    } catch {
      return null;
    }
  }

  /** Fallback when listingListedAt is 0 (legacy deployment): latest Listed event in lookback window. */
  async function getListedEventTimeMsForToken(tokenId) {
    try {
      const tid = typeof tokenId === "bigint" ? tokenId : BigInt(String(tokenId));
      const filter = marketplace.filters.Listed(tid);
      const latest = await provider.getBlockNumber();
      const from = Math.max(0, latest - LISTED_EVENT_LOOKBACK_BLOCKS);
      const events = await marketplace.queryFilter(filter, from, latest);
      if (!events.length) return null;
      const last = events[events.length - 1];
      const blk = await last.getBlock();
      if (blk?.timestamp == null) return null;
      return Number(blk.timestamp) * 1000;
    } catch (e) {
      console.warn(
        `Bot ${botId}: Listed time lookup failed token ${tokenId}`,
        e?.shortMessage || e?.message || e
      );
      return null;
    }
  }

  async function ensureUserListingTimestampFromChain(tokenIdStr, tokenId) {
    if (listingTimestamps[tokenIdStr] !== undefined) return;
    let chainMs = await getListingListedAtMs(tokenId);
    if (chainMs == null) chainMs = await getListedEventTimeMsForToken(tokenId);
    listingTimestamps[tokenIdStr] = chainMs ?? Date.now();
    writeListingTimestamps(listingTimestamps);
  }

  process.on("unhandledRejection", (reason) => {
    if (isRateLimitError(reason) || isRateLimitError(reason?.cause)) {
      console.warn(`Bot ${botId}: RPC rate limited (background)`);
      return;
    }
    try {
      const blob = JSON.stringify(reason?.error || reason || "").toLowerCase();
      if (blob.includes("-32005") || blob.includes("429") || blob.includes("rate limit")) {
        console.warn(`Bot ${botId}: RPC rate limited (background)`);
        return;
      }
    } catch (_) {}
    console.error(`Bot ${botId}: unhandled rejection`, reason?.shortMessage || reason?.message || reason);
  });

  function enqueue(task) {
    queue = queue
      .then(task)
      .catch((e) => console.error(`Bot ${botId} queued task error:`, e?.message || e));
    return queue;
  }

  function buildKnownBotWalletSet() {
    for (let i = 1; i <= 5; i++) {
      const pk = (process.env[`BOT${i}_PRIVATE_KEY`] || "").trim();
      if (!pk) continue;
      try {
        const addr = new ethers.Wallet(pk).address.toLowerCase();
        knownBotWallets.add(addr);
      } catch (_) {}
    }
  }

  async function getTotalMintedSafe() {
    if (!canScanByTotalMinted) return null;
    try {
      const totalMinted = Number(await nft.totalMinted());
      if (!Number.isFinite(totalMinted) || totalMinted < 0) return null;
      return totalMinted;
    } catch (e) {
      canScanByTotalMinted = false;
      if (!warnedTotalMintedUnavailable) {
        warnedTotalMintedUnavailable = true;
        console.warn(
          `Bot ${botId}: NFT totalMinted unavailable, disabling active-sweep/relist scanner; continuing live Listed listening`
        );
      }
      return null;
    }
  }

/** Direction-specific cooldown: buyer|seller so each bot has its own 24h for buying from the other. */
function interBotCooldownKey(buyer, seller) {
  const x = String(buyer || "").toLowerCase();
  const y = String(seller || "").toLowerCase();
  return `${x}|${y}`;
}

function readInterBotCooldowns() {
  try {
    if (!fs.existsSync(COOLDOWN_FILE)) return {};
    const raw = fs.readFileSync(COOLDOWN_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeInterBotCooldowns(data) {
  try {
    fs.writeFileSync(COOLDOWN_FILE, JSON.stringify(data, null, 2));
  } catch (_) {}
}

function readListingTimestamps() {
  try {
    if (!fs.existsSync(LISTING_TIMESTAMPS_FILE)) return {};
    const raw = fs.readFileSync(LISTING_TIMESTAMPS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeListingTimestamps(data) {
  try {
    fs.writeFileSync(LISTING_TIMESTAMPS_FILE, JSON.stringify(data, null, 2));
  } catch (_) {}
}

function readPendingUserListingsFile() {
  try {
    if (!fs.existsSync(PENDING_USER_LISTINGS_FILE)) return {};
    const raw = fs.readFileSync(PENDING_USER_LISTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writePendingUserListingsFile(data) {
  try {
    fs.writeFileSync(PENDING_USER_LISTINGS_FILE, JSON.stringify(data, null, 2));
  } catch (_) {}
}

function readListenerCursorBlock() {
  try {
    if (!fs.existsSync(LISTENER_CURSOR_FILE)) return null;
    const raw = fs.readFileSync(LISTENER_CURSOR_FILE, "utf8");
    const j = JSON.parse(raw);
    const n = Number(j?.lastListedBlockScanned);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  } catch {
    return null;
  }
}

function writeListenerCursorBlock(blockNumber) {
  try {
    const n = Math.floor(Number(blockNumber));
    if (!Number.isFinite(n) || n < 0) return;
    fs.writeFileSync(LISTENER_CURSOR_FILE, JSON.stringify({ lastListedBlockScanned: n }, null, 2));
  } catch (_) {}
}

function relistRandomBackoffMs() {
  const span = Math.max(0, RELIST_RETRY_MAX_MS - RELIST_RETRY_MIN_MS);
  return RELIST_RETRY_MIN_MS + Math.floor(Math.random() * (span + 1));
}

function isRateLimitError(e) {
  const msg = String(e?.message || e?.shortMessage || JSON.stringify(e?.info || e?.value || "")).toLowerCase();
  const codes = [
    Number(e?.code),
    Number(e?.error?.code),
    Number(e?.info?.error?.code),
  ];
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("-32005") ||
    msg.includes("exceeded the rps") ||
    msg.includes("compute units per second") ||
    msg.includes("could not coalesce") ||
    codes.some((c) => c === 429 || c === -32005)
  );
}

/** Readable RPC / revert line for logs (ethers often hides JSON-RPC details behind "could not coalesce error"). */
function summarizeEthersError(e) {
  const parts = [];
  const sm = e?.shortMessage;
  const m = e?.message;
  if (sm) parts.push(sm);
  if (m && m !== sm) parts.push(m);
  try {
    const rpc = e?.error || e?.info?.error;
    if (rpc?.message) parts.push(`jsonrpc: ${rpc.message}`);
    if (rpc?.code != null && String(rpc.code) !== "") parts.push(`code=${rpc.code}`);
    const d = rpc?.data ?? e?.data;
    if (d && typeof d === "object" && d.try_again_in != null) {
      parts.push(`try_again_in=${d.try_again_in}`);
    }
    if (typeof d === "string" && d.startsWith("0x") && d.length > 2) {
      parts.push(`data=${d.slice(0, 18)}…`);
    }
  } catch {
    /* ignore */
  }
  return parts.length ? parts.join(" | ") : String(e ?? "error");
}

/** One-line log: shorten Chainstack RPS noise; keep detail for real reverts. */
function formatEthersErrorForLog(e) {
  if (isRateLimitError(e)) {
    const ms = rateLimitPauseMs(e) || 500;
    return `RPC rate limit (Chainstack RPS) — retry after ~${ms}ms`;
  }
  return summarizeEthersError(e);
}

/** Chainstack / similar: parse try_again_in e.g. "595.814718ms". */
function rateLimitPauseMs(e) {
  try {
    const data = e?.info?.error?.data ?? e?.data ?? e?.error?.data;
    const raw = data?.try_again_in ?? data?.tryAgainIn;
    if (raw == null) return 0;
    const s = String(raw).trim();
    const m = s.match(/^([\d.]+)\s*ms$/i);
    if (m) return Math.ceil(parseFloat(m[1]));
    const n = Number(s);
    return Number.isFinite(n) ? Math.ceil(n) : 0;
  } catch {
    return 0;
  }
}

function txOverrides(kind = "default") {
  const base = {};
  if (Number.isFinite(BOT_TX_GAS_GWEI) && BOT_TX_GAS_GWEI > 0) {
    base.gasPrice = ethers.parseUnits(String(BOT_TX_GAS_GWEI), "gwei");
  }
  if (kind === "approve") return { ...base, gasLimit: BigInt(Math.max(50000, BOT_GAS_LIMIT_APPROVE)) };
  if (kind === "buy") return { ...base, gasLimit: BigInt(Math.max(120000, BOT_GAS_LIMIT_BUY)) };
  if (kind === "list") return { ...base, gasLimit: BigInt(Math.max(120000, BOT_GAS_LIMIT_LIST)) };
  return base;
}

  /** eth_call — if this fails, broadcasting buy() would revert too (saves gas). */
  async function simulateBuyCall(tokenId) {
    if (!BOT_STATIC_SIMULATE) return true;
    try {
      await marketplace.buy.staticCall(tokenId, ethers.ZeroAddress);
      return true;
    } catch (e) {
      console.log(
        `Bot ${botId}: buy simulation would revert, skip token ${tokenId.toString()} — ${summarizeEthersError(e)}`
      );
      return false;
    }
  }

  async function simulateListCall(tokenId) {
    if (!BOT_STATIC_SIMULATE || BOT_SKIP_LIST_STATIC_SIMULATE) return true;
    try {
      await marketplace.list.staticCall(tokenId, LIST_PRICE_WEI);
      return true;
    } catch (e) {
      const s = summarizeEthersError(e);
      console.log(`Bot ${botId}: list simulation would revert token ${tokenId.toString()} — ${s}`);
      const raw = String(e?.data || e?.info?.error?.data || "");
      const hasInsufficientApproval =
        raw.startsWith("0x177e802f") || s.includes("0x177e802f") || raw.toLowerCase().includes("177e802f");
      if (hasInsufficientApproval) {
        console.log(
          `Bot ${botId}: list sim revert = ERC721InsufficientApproval (marketplace cannot transfer this tokenId; approve marketplace on NFT first)`
        );
      } else if (
        String(s).toLowerCase().includes("custom error") ||
        String(s).toLowerCase().includes("unknown")
      ) {
        console.log(
          `Bot ${botId}: hint: list() ends with _runDynamicMintIfNeeded(); nested NFT revert can look like a custom error. ` +
            `If real list txs work, set BOT_SKIP_LIST_STATIC_SIMULATE=true.`
        );
      }
      return false;
    }
  }

  async function delayMs(ms) {
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }

  async function withBotRpcRetry(fn, { retries = 6, baseMs = 500 } = {}) {
    let last;
    for (let i = 0; i <= retries; i++) {
      try {
        return await fn();
      } catch (e) {
        last = e;
        if (!isRateLimitError(e) || i === retries) throw e;
        const pause = rateLimitPauseMs(e) || baseMs * 2 ** i;
        await delayMs(Math.min(15_000, Math.max(300, pause)));
      }
    }
    throw last;
  }

  function configuredBotIdsWithKeys() {
    const ids = [];
    for (let i = 1; i <= 5; i++) {
      if ((process.env[`BOT${i}_PRIVATE_KEY`] || "").trim()) ids.push(String(i));
    }
    return ids.sort((a, b) => Number(a) - Number(b));
  }

  async function fetchControlGet(pathSuffix) {
    const base = (BOT_CONTROL_BASE_URL || "").replace(/\/$/, "");
    const url = `${base}/${pathSuffix}`;
    const headers = BOT_CONTROL_API_KEY ? { "x-bot-control-key": BOT_CONTROL_API_KEY } : {};
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, CONTROL_REQUEST_TIMEOUT_MS));
    try {
      return await fetch(url, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Full URL override or bot-control relative /listing-queue (same auth as other bot-control calls). */
  async function fetchListingQueueResponse() {
    const explicit = BOT_LISTING_QUEUE_URL.replace(/\/$/, "");
    if (explicit) {
      const headers = { accept: "application/json" };
      if (BOT_CONTROL_API_KEY) headers["x-bot-control-key"] = BOT_CONTROL_API_KEY;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1000, CONTROL_REQUEST_TIMEOUT_MS));
      try {
        return await fetch(explicit, { headers, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    }
    const base = (BOT_CONTROL_BASE_URL || "").replace(/\/$/, "");
    if (!base) return null;
    return fetchControlGet("listing-queue");
  }

  /** Public GET /api/marketplace/listings — same listedAt as dashboard (no bot-control auth). */
  async function fetchMarketplaceListingsResponse() {
    const url = resolveMarketplaceListingsUrl();
    if (!url) return null;
    const headers = { accept: "application/json" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, CONTROL_REQUEST_TIMEOUT_MS));
    try {
      return await fetch(url, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  let cachedRunningBotIds = null;
  let cachedRunningBotIdsAt = 0;
  const RUNNING_BOT_IDS_TTL_MS = Math.min(15_000, Math.max(2500, CONTROL_REFRESH_MS));

  async function getRunningBotIdsFromAdmin() {
    const now = Date.now();
    if (cachedRunningBotIds != null && now - cachedRunningBotIdsAt < RUNNING_BOT_IDS_TTL_MS) {
      return cachedRunningBotIds;
    }
    const configured = configuredBotIdsWithKeys();
    let next = [];
    const base = (BOT_CONTROL_BASE_URL || "").replace(/\/$/, "");
    if (!base) {
      next = [...configured];
    } else {
      for (const id of configured) {
        try {
          const res = await fetchControlGet(id);
          if (!res.ok) continue;
          const data = await res.json();
          if (data?.running) next.push(id);
        } catch (_) {
          /* skip */
        }
      }
      if (next.length === 0 && configured.length > 0) {
        next = cachedRunningBotIds != null ? [...cachedRunningBotIds] : [];
      }
    }
    cachedRunningBotIds = next;
    cachedRunningBotIdsAt = now;
    return next;
  }

  async function refreshUniversalListenerRole() {
    if (!BOT_SINGLE_CHAIN_LISTENER) {
      runsChainPoll = true;
      wasUniversalChainListener = true;
      return;
    }
    if (BOT_CHAIN_LISTENER_BOT_ID_ENV) {
      runsChainPoll = botId === BOT_CHAIN_LISTENER_BOT_ID_ENV;
      wasUniversalChainListener = runsChainPoll;
      return;
    }
    const running = await getRunningBotIdsFromAdmin();
    const prevLeader = wasUniversalChainListener;
    if (running.length === 0) {
      if (prevLeader && runsChainPoll) {
        console.log(`Bot ${botId}: universal chain listener stopped — all bots stopped in admin`);
      }
      runsChainPoll = false;
      wasUniversalChainListener = false;
      return;
    }
    const leader = running.reduce((a, b) => (Number(a) <= Number(b) ? a : b));
    const amLeader = botId === leader;
    if (amLeader && !prevLeader) {
      pendingUserListings = readPendingUserListingsFile();
      const persisted = readListenerCursorBlock();
      lastListedBlockScanned = persisted != null ? persisted : null;
      console.log(
        `Bot ${botId}: universal chain listener (admin: running bots ${running.join(", ")})`
      );
    }
    if (!amLeader && prevLeader) {
      console.log(`Bot ${botId}: handed off chain listener to bot ${leader}`);
    }
    wasUniversalChainListener = amLeader;
    runsChainPoll = amLeader;
  }

  function prunePendingKey(tokenIdStr) {
    if (!USE_EVENT_PENDING_QUEUE) return;
    const disk = readPendingUserListingsFile();
    if (!disk[tokenIdStr]) return;
    delete disk[tokenIdStr];
    writePendingUserListingsFile(disk);
    if (runsChainPoll || USE_HTTP_LISTING_DISCOVERY) delete pendingUserListings[tokenIdStr];
  }

  function upsertPendingForUserListing(tokenIdStr, sellerLc, priceBn, listedAtMs) {
    if (!USE_EVENT_PENDING_QUEUE || !runsChainPoll) return;
    if (!sellerLc || sellerLc === marketLc || knownBotWallets.has(sellerLc)) return;
    if (priceBn !== LIST_PRICE_WEI) return;
    pendingUserListings[tokenIdStr] = {
      seller: sellerLc,
      priceWei: priceBn.toString(),
      listedAtMs: Number(listedAtMs),
    };
    writePendingUserListingsFile(pendingUserListings);
  }

  async function hasAnyActiveUserListing(force = false) {
    const now = Date.now();
    if (!force && now - lastUserListingsCheckAt < Math.max(2000, USER_LISTINGS_CACHE_MS)) {
      return cachedHasUserListings;
    }
    lastUserListingsCheckAt = now;
    try {
      if (USE_EVENT_PENDING_QUEUE && BOT_SINGLE_CHAIN_LISTENER) {
        await refreshUniversalListenerRole();
      }
      if (USE_EVENT_PENDING_QUEUE) {
        const snap = runsChainPoll || USE_HTTP_LISTING_DISCOVERY ? pendingUserListings : readPendingUserListingsFile();
        const n = Object.keys(snap).filter((k) => {
          const m = snap[k];
          if (!m || typeof m !== "object") return false;
          if (!pendingPriceMatchesRecord(m)) return false;
          const s = (m.seller || "").toLowerCase();
          if (!s || s === marketLc || knownBotWallets.has(s)) return false;
          return true;
        }).length;
        cachedHasUserListings = n > 0;
        return cachedHasUserListings;
      }
      const totalMinted = await getTotalMintedSafe();
      if (!Number.isFinite(totalMinted) || totalMinted <= 0) {
        cachedHasUserListings = false;
        return false;
      }
      const batchSize = Math.max(1, Math.min(ACTIVE_SCAN_BATCH_SIZE, 200));
      for (let start = 1; start <= totalMinted; start += batchSize) {
        const end = Math.min(totalMinted, start + batchSize - 1);
        const chunk = await Promise.all(
          Array.from({ length: end - start + 1 }, (_, idx) => start + idx).map((tokenId) =>
            marketplace
              .listings(tokenId)
              .then((l) => ({
                active: Boolean(l?.active ?? l?.[3]),
                seller: (l?.seller || l?.[0] || "").toString().toLowerCase(),
              }))
              .catch(() => null)
          )
        );
        for (const row of chunk) {
          if (!row?.active) continue;
          if (!row.seller) continue;
          if (marketLc && row.seller === marketLc) continue;
          if (!knownBotWallets.has(row.seller)) {
            cachedHasUserListings = true;
            return true;
          }
        }
      }
      cachedHasUserListings = false;
      return false;
    } catch (e) {
      console.warn(`Bot ${botId}: user-listings check failed`, e?.message || e);
      // Fail-safe: if uncertain, keep previous state to avoid aggressive bot-vs-bot buying.
      return cachedHasUserListings;
    }
  }

  /** Pending queue + one `listings()` per candidate (not O(totalMinted)). */
  async function collectUserListingRowsFromPendingOnly() {
    if (USE_EVENT_PENDING_QUEUE && BOT_SINGLE_CHAIN_LISTENER) {
      await refreshUniversalListenerRole();
    }
    const snap = runsChainPoll || USE_HTTP_LISTING_DISCOVERY ? pendingUserListings : readPendingUserListingsFile();
    const out = [];
    for (const [tidStr, meta] of Object.entries(snap)) {
      if (!meta || typeof meta !== "object") continue;
      if (!pendingPriceMatchesRecord(meta)) {
        prunePendingKey(tidStr);
        continue;
      }
      const sellerLc = (meta.seller || "").toLowerCase();
      if (!sellerLc || sellerLc === marketLc || knownBotWallets.has(sellerLc)) {
        prunePendingKey(tidStr);
        continue;
      }
      let tokenId;
      try {
        tokenId = BigInt(tidStr);
      } catch {
        prunePendingKey(tidStr);
        continue;
      }
      try {
        const l = await marketplace.listings(tokenId);
        const active = Boolean(l?.active ?? l?.[3]);
        if (!active) {
          prunePendingKey(tidStr);
          continue;
        }
        const curSeller = (l?.seller || l?.[0] || "").toString().toLowerCase();
        if (curSeller !== sellerLc) {
          prunePendingKey(tidStr);
          continue;
        }
        const price = l?.price ?? l?.[2] ?? 0n;
        if (BigInt(price.toString()) !== LIST_PRICE_WEI) {
          prunePendingKey(tidStr);
          continue;
        }
        let listedAtMs = meta.listedAtMs;
        if (listedAtMs == null || !Number.isFinite(Number(listedAtMs))) {
          listedAtMs = listingTimestamps[tidStr];
        }
        const chainMs = await getListingListedAtMs(tokenId);
        if (chainMs != null) listedAtMs = chainMs;
        if (listedAtMs == null || !Number.isFinite(Number(listedAtMs))) listedAtMs = Date.now();
        out.push({
          tokenId,
          seller: l?.seller || l?.[0],
          price,
          listedAtMs: Number(listedAtMs),
        });
      } catch {
        /* keep entry; RPC flake */
      }
    }
    return out;
  }

  /** Full mint scan — optional bootstrap / legacy when BOT_EVENT_PENDING_QUEUE=false. */
  async function collectUserListingRowsFullScan() {
    const totalMinted = await getTotalMintedSafe();
    if (!Number.isFinite(totalMinted) || totalMinted <= 0) return [];
    const batchSize = Math.max(1, Math.min(ACTIVE_SCAN_BATCH_SIZE, 200));
    const out = [];
    for (let start = 1; start <= totalMinted; start += batchSize) {
      const end = Math.min(totalMinted, start + batchSize - 1);
      const tokenIds = Array.from({ length: end - start + 1 }, (_, idx) => start + idx);
      const rows = await Promise.all(
        tokenIds.map(async (tokenId) => {
          try {
            const l = await marketplace.listings(tokenId);
            const active = Boolean(l?.active ?? l?.[3]);
            if (!active) return null;
            const seller = (l?.seller || l?.[0] || "").toString().toLowerCase();
            if (!seller || seller === self) return null;
            if (marketLc && seller === marketLc) return null;
            if (knownBotWallets.has(seller)) return null;
            const price = l?.price ?? l?.[2] ?? 0n;
            if (BigInt(price.toString()) !== LIST_PRICE_WEI) return null;
            let listedAtMs = null;
            try {
              const sec = await marketplace.listingListedAt(tokenId);
              const n = sec != null ? Number(sec) : 0;
              if (Number.isFinite(n) && n > 0) listedAtMs = n * 1000;
            } catch (_) {
              listedAtMs = null;
            }
            return {
              tokenId: BigInt(tokenId),
              seller: l?.seller || l?.[0],
              price,
              listedAtMs,
            };
          } catch {
            return null;
          }
        })
      );
      for (const row of rows) {
        if (!row) continue;
        const tid = row.tokenId.toString();
        let listedAtMs = row.listedAtMs;
        if (listedAtMs == null) {
          if (listingTimestamps[tid] !== undefined) listedAtMs = listingTimestamps[tid];
          else {
            await ensureUserListingTimestampFromChain(tid, row.tokenId);
            listedAtMs = listingTimestamps[tid];
          }
        }
        if (listedAtMs == null || !Number.isFinite(Number(listedAtMs))) listedAtMs = Date.now();
        out.push({ tokenId: row.tokenId, seller: row.seller, price: row.price, listedAtMs: Number(listedAtMs) });
      }
    }
    return out;
  }

  async function collectUserListingRows() {
    if (USE_EVENT_PENDING_QUEUE) {
      return collectUserListingRowsFromPendingOnly();
    }
    return collectUserListingRowsFullScan();
  }

  async function runUserBuybackWorkerImpl() {
    const myGen = userBuybackGeneration;
    let idleNoListings = false;
    try {
      const enabled = await isBotEnabled(true);
      if (!enabled) return;
      if (myGen !== userBuybackGeneration) return;

      let runningForSlots = await getRunningBotIdsFromAdmin();
      if (!runningForSlots.length) {
        runningForSlots = [...configuredBotIdsWithKeys()].sort((a, b) => Number(a) - Number(b));
      }
      if (!runningForSlots.length) runningForSlots = [String(botId)];
      const activeSorted = [...runningForSlots].sort((a, b) => Number(a) - Number(b));
      const idxInRunning = activeSorted.indexOf(String(botId));
      if (idxInRunning < 0) {
        idleNoListings = true;
        return;
      }
      const buybackSlotIndex = idxInRunning;

      const rows = await collectUserListingRows();
      if (!rows.length) {
        idleNoListings = true;
        return;
      }
      rows.sort((a, b) => {
        const d = a.listedAtMs - b.listedAtMs;
        if (d !== 0) return d;
        if (a.tokenId < b.tokenId) return -1;
        if (a.tokenId > b.tokenId) return 1;
        return 0;
      });
      const availableRows = rows.filter((r) => !isTokenLockFileHeld(String(r.tokenId)));
      if (buybackSlotIndex >= availableRows.length) {
        idleNoListings = true;
        return;
      }
      const myRow = availableRows[buybackSlotIndex];
      const sellerNorm = (myRow.seller || "").toString().toLowerCase();

      await isBotEnabled(true);
      let until = myRow.listedAtMs + dynamicUserListingMinAgeMs;
      let lastLoggedMins = null;
      while (Date.now() < until) {
        if (myGen !== userBuybackGeneration) return;
        await isBotEnabled(true);
        until = myRow.listedAtMs + dynamicUserListingMinAgeMs;
        const now = Date.now();
        if (now >= until) break;
        const minsLeft = Math.ceil((until - now) / 60000);
        if (minsLeft !== lastLoggedMins) {
          lastLoggedMins = minsLeft;
          console.log(
            `Bot ${botId}: user buyback ~${minsLeft}m remaining (slot ${buybackSlotIndex + 1}/${activeSorted.length}, open queue #${buybackSlotIndex + 1}/${availableRows.length} of ${rows.length} listings, token ${myRow.tokenId})`
          );
        }
        try {
          const l = await marketplace.listings(myRow.tokenId);
          const active = Boolean(l?.active ?? l?.[3]);
          const curSeller = (l?.seller || l?.[0] || "").toString().toLowerCase();
          if (!active || curSeller !== sellerNorm) {
            console.log(`Bot ${botId}: buyback target token ${myRow.tokenId} changed — re-scan`);
            return;
          }
        } catch (_) {}
        const slice = Math.min(USER_BUYBACK_WAIT_CHUNK_MS, Math.max(1500, until - Date.now()));
        await delayMs(slice);
      }

      if (myGen !== userBuybackGeneration) return;
      await isBotEnabled(true);
      const rows2 = await collectUserListingRows();
      if (!rows2.length) return;
      rows2.sort((a, b) => {
        const d = a.listedAtMs - b.listedAtMs;
        if (d !== 0) return d;
        if (a.tokenId < b.tokenId) return -1;
        if (a.tokenId > b.tokenId) return 1;
        return 0;
      });
      const available2 = rows2.filter((r) => !isTokenLockFileHeld(String(r.tokenId)));
      if (buybackSlotIndex >= available2.length) return;
      const target = available2[buybackSlotIndex];
      if (Date.now() < target.listedAtMs + dynamicUserListingMinAgeMs) return;
      await tryBuyAndRelist(target.tokenId, target.seller, target.price, `buyback-slot-${buybackSlotIndex}`);
    } catch (e) {
      console.warn(`Bot ${botId}: user buyback worker`, e?.message || e);
    } finally {
      void (async () => {
        if (myGen !== userBuybackGeneration) return;
        const on = await isBotEnabled().catch(() => false);
        if (!on) {
          setTimeout(() => enqueue(runUserBuybackWorkerImpl), Math.max(5000, CONTROL_REFRESH_MS));
          return;
        }
        const backoff = idleNoListings ? Math.max(30000, USER_LISTINGS_CACHE_MS * 4) : 2500;
        setTimeout(() => enqueue(runUserBuybackWorkerImpl), backoff);
      })();
    }
  }

  function kickUserBuybackRescan() {
    userBuybackGeneration++;
    enqueue(runUserBuybackWorkerImpl);
  }

  function handleListedLogArgs(tokenId, seller, price, blockNumber) {
    enqueue(async () => {
      const enabled = await isBotEnabled();
      if (!enabled) return;
      const sellerAddr = (seller || "").toString().toLowerCase();
      const isUserListing = sellerAddr && sellerAddr !== marketLc && !knownBotWallets.has(sellerAddr);
      if (!isUserListing) return;
      const tid = tokenId.toString();
      let tsMs = Date.now();
      try {
        if (blockNumber != null) {
          const blk = await withBotRpcRetry(() => provider.getBlock(blockNumber), { retries: 4, baseMs: 400 });
          if (blk?.timestamp != null) tsMs = Number(blk.timestamp) * 1000;
        }
      } catch (_) {}
      listingTimestamps[tid] = tsMs;
      writeListingTimestamps(listingTimestamps);
      const priceBn = price != null ? BigInt(price.toString()) : 0n;
      upsertPendingForUserListing(tid, sellerAddr, priceBn, tsMs);
      kickUserBuybackRescan();
    });
  }

  async function pollListingQueueFromApiLoop() {
    await refreshUniversalListenerRole();
    let res;
    try {
      res = await fetchListingQueueResponse();
    } catch (e) {
      console.warn(`Bot ${botId}: listing-queue fetch`, e?.message || e);
      return;
    }
    if (res == null) {
      console.warn(
        `Bot ${botId}: BOT_LISTING_SOURCE=database needs BOT_CONTROL_BASE_URL or BOT_LISTING_QUEUE_URL`
      );
      return;
    }
    try {
      if (!res.ok) {
        let msg = res.statusText || "";
        try {
          const errBody = await res.json();
          msg = String(errBody?.error || msg);
        } catch (_) {}
        console.warn(`Bot ${botId}: listing-queue HTTP ${res.status} — ${msg}`);
        return;
      }
      const data = await res.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      const next = {};
      for (const it of items) {
        const tidStr = String(it?.tokenId ?? "").trim();
        if (!tidStr) continue;
        const sellerLc = String(it?.seller ?? "").toLowerCase();
        if (!sellerLc || sellerLc === marketLc || knownBotWallets.has(sellerLc)) continue;
        let priceWei;
        try {
          priceWei = BigInt(String(it?.priceWei ?? "0"));
        } catch {
          continue;
        }
        if (priceWei !== LIST_PRICE_WEI) continue;

        const prev = pendingUserListings[tidStr] || {};
        let listedAtMs = Number(it?.listedAtMs);
        if (!Number.isFinite(listedAtMs) || listedAtMs <= 0) {
          listedAtMs = Number(prev.listedAtMs);
        }
        if (!Number.isFinite(listedAtMs) || listedAtMs <= 0) {
          listedAtMs = Number(listingTimestamps[tidStr]);
        }
        if (!Number.isFinite(listedAtMs) || listedAtMs <= 0) {
          listedAtMs = Date.now();
        }
        next[tidStr] = {
          seller: sellerLc,
          priceWei: priceWei.toString(),
          listedAtMs: Math.floor(listedAtMs),
        };
      }
      pendingUserListings = next;
      writePendingUserListingsFile(pendingUserListings);
      for (const [tidStr, m] of Object.entries(next)) {
        listingTimestamps[tidStr] = m.listedAtMs;
      }
      writeListingTimestamps(listingTimestamps);
      kickUserBuybackRescan();
    } catch (e) {
      console.warn(`Bot ${botId}: listing-queue poll`, e?.message || e);
    }
  }

  async function pollMarketplaceListingsFromApiLoop() {
    await refreshUniversalListenerRole();
    let res;
    try {
      res = await fetchMarketplaceListingsResponse();
    } catch (e) {
      console.warn(`Bot ${botId}: marketplace listings fetch`, e?.message || e);
      return;
    }
    if (res == null) {
      console.warn(
        `Bot ${botId}: BOT_LISTING_SOURCE=api needs BOT_MARKETPLACE_LISTINGS_URL or BOT_CONTROL_BASE_URL ending in /bot-control`
      );
      return;
    }
    try {
      if (!res.ok) {
        let msg = res.statusText || "";
        try {
          const errBody = await res.json();
          msg = String(errBody?.error || msg);
        } catch (_) {}
        console.warn(`Bot ${botId}: marketplace listings HTTP ${res.status} — ${msg}`);
        return;
      }
      const data = await res.json();
      const raw = Array.isArray(data?.listings) ? data.listings : [];
      const next = {};
      for (const it of raw) {
        const tier = String(it?.listingTier || "").toLowerCase();
        if (tier && tier !== "user") continue;
        const tidStr = String(it?.tokenId ?? "").trim();
        if (!tidStr) continue;
        const sellerLc = String(it?.seller ?? "").toLowerCase();
        if (!sellerLc || sellerLc === marketLc || knownBotWallets.has(sellerLc)) continue;
        let priceWei;
        try {
          priceWei = BigInt(String(it?.price ?? it?.priceWei ?? "0"));
        } catch {
          continue;
        }
        if (priceWei !== LIST_PRICE_WEI) continue;

        const prev = pendingUserListings[tidStr] || {};
        let listedAtMs = Number(it?.listedAt ?? it?.listedAtMs);
        if (!Number.isFinite(listedAtMs) || listedAtMs <= 0) {
          listedAtMs = Number(prev.listedAtMs);
        }
        if (!Number.isFinite(listedAtMs) || listedAtMs <= 0) {
          listedAtMs = Number(listingTimestamps[tidStr]);
        }
        if (!Number.isFinite(listedAtMs) || listedAtMs <= 0) {
          listedAtMs = Date.now();
        }
        next[tidStr] = {
          seller: sellerLc,
          priceWei: priceWei.toString(),
          listedAtMs: Math.floor(listedAtMs),
        };
      }
      pendingUserListings = next;
      writePendingUserListingsFile(pendingUserListings);
      for (const [tidStr, m] of Object.entries(next)) {
        listingTimestamps[tidStr] = m.listedAtMs;
      }
      writeListingTimestamps(listingTimestamps);
      kickUserBuybackRescan();
    } catch (e) {
      console.warn(`Bot ${botId}: marketplace listings poll`, e?.message || e);
    }
  }

  async function pollListingDiscoveryLoop() {
    if (USE_DB_LISTING_QUEUE) {
      await pollListingQueueFromApiLoop();
      return;
    }
    if (USE_MARKETPLACE_LISTINGS_API) {
      await pollMarketplaceListingsFromApiLoop();
      return;
    }
    await pollListedEventsLoop();
  }

  async function pollListedEventsLoop() {
    await refreshUniversalListenerRole();
    if (!runsChainPoll) return;
    try {
      const latest = await withBotRpcRetry(() => provider.getBlockNumber(), { retries: 5, baseMs: 500 });
      if (lastListedBlockScanned == null) {
        const persisted = readListenerCursorBlock();
        if (persisted != null && persisted <= latest) {
          lastListedBlockScanned = persisted;
        } else {
          lastListedBlockScanned = Math.max(0, latest - LISTED_CATCHUP_BLOCKS);
        }
      }
      let from = lastListedBlockScanned + 1;
      if (from > latest) return;

      const listedFilter = marketplace.filters.Listed();
      while (from <= latest) {
        const chunkFrom = from;
        const to = Math.min(from + LISTED_LOGS_CHUNK_BLOCKS - 1, latest);
        let events;
        try {
          events = await withBotRpcRetry(() => marketplace.queryFilter(listedFilter, chunkFrom, to), {
            retries: 5,
            baseMs: 550,
          });
        } catch (e) {
          if (isRateLimitError(e)) {
            await delayMs(Math.min(12_000, Math.max(500, rateLimitPauseMs(e) || 900)));
          } else {
            console.warn(`Bot ${botId}: Listed getLogs [${chunkFrom}-${to}]`, formatEthersErrorForLog(e));
          }
          return;
        }
        for (const ev of events) {
          const a = ev.args;
          const tokenId = a?.tokenId ?? a?.[0];
          const seller = a?.seller ?? a?.[1];
          const price = a?.price ?? a?.[2];
          if (tokenId == null || seller == null) continue;
          handleListedLogArgs(tokenId, seller, price, ev.blockNumber);
        }

        if (USE_EVENT_PENDING_QUEUE) {
          const soldFilter = marketplace.filters.Sold();
          const cancelFilter = marketplace.filters.ListingCancelled();
          try {
            const soldEvs = await withBotRpcRetry(() => marketplace.queryFilter(soldFilter, chunkFrom, to), {
              retries: 4,
              baseMs: 550,
            });
            for (const ev of soldEvs) {
              const st = ev.args?.tokenId ?? ev.args?.[0];
              if (st != null) prunePendingKey(st.toString());
            }
          } catch (e) {
            if (!isRateLimitError(e)) {
              console.warn(`Bot ${botId}: Sold getLogs [${chunkFrom}-${to}]`, formatEthersErrorForLog(e));
            }
          }
          try {
            const canEvs = await withBotRpcRetry(() => marketplace.queryFilter(cancelFilter, chunkFrom, to), {
              retries: 4,
              baseMs: 550,
            });
            for (const ev of canEvs) {
              const ct = ev.args?.tokenId ?? ev.args?.[0];
              if (ct != null) prunePendingKey(ct.toString());
            }
          } catch (e) {
            if (!isRateLimitError(e)) {
              console.warn(
                `Bot ${botId}: ListingCancelled getLogs [${chunkFrom}-${to}]`,
                formatEthersErrorForLog(e)
              );
            }
          }
        }

        from = to + 1;
      }
      lastListedBlockScanned = latest;
      writeListenerCursorBlock(latest);
    } catch (e) {
      if (isRateLimitError(e)) {
        console.warn(`Bot ${botId}: Listed poll rate limited`);
      } else {
        console.warn(`Bot ${botId}: Listed poll error`, formatEthersErrorForLog(e));
      }
    }
  }

  async function tryBuyAndRelist(tokenId, seller, price, source) {
    const tokenIdStr = tokenId.toString();
    const sellerAddr = (seller || "").toString().toLowerCase();
    const priceBn = BigInt(price.toString());
    const sellerIsBot = knownBotWallets.has(sellerAddr);

    if (sellerAddr === self) return; // never buy own listing
    // Buyback targets member listings only — not dynamic mint (seller = marketplace contract).
    if (marketLc && sellerAddr === marketLc) return;
    if (priceBn !== LIST_PRICE_WEI) return;

    const eligible = await ensureBotTraderEligibility();
    if (!eligible) return; // skip without logging every time; already logged at startup

    // Hard requirement: never allow bot-to-bot buys.
    if (sellerIsBot) return;

    // User listings: wait buyback delay from list time (prefer on-chain listingListedAt).
    if (!sellerIsBot) {
      let listTimeMs = await getListingListedAtMs(tokenId);
      if (listTimeMs == null) {
        await ensureUserListingTimestampFromChain(tokenIdStr, tokenId);
        listTimeMs = listingTimestamps[tokenIdStr];
      }
      const ageMs = Date.now() - Number(listTimeMs);
      if (ageMs < dynamicUserListingMinAgeMs) {
        const minsLeft = Math.ceil((dynamicUserListingMinAgeMs - ageMs) / 60000);
        console.log(`Bot ${botId}: skip token ${tokenIdStr}, user listing too new (${minsLeft}m left)`);
        return;
      }
    }

    const lock = await acquireTokenLock(tokenIdStr);
    if (!lock) {
      console.log(`Bot ${botId}: skip token ${tokenIdStr}, already handled by another bot`);
      return;
    }

    try {
      const listing = await marketplace.listings(tokenId);
      if (!listing?.active) return;
      if ((listing.seller || "").toString().toLowerCase() === self) return;
      if ((listing.seller || "").toString().toLowerCase() !== sellerAddr) return;
      if (BigInt(listing.price.toString()) !== priceBn) return;

      const balance = await usdt.balanceOf(wallet.address);
      if (balance < priceBn) {
        console.log(`Bot ${botId}: insufficient USDT, skip token ${tokenIdStr}`);
        return;
      }

      // Re-check listing right before any tx (avoid spending gas on approve if listing is gone)
      const listingPreApprove = await marketplace.listings(tokenId);
      if (!listingPreApprove?.active || (listingPreApprove.seller || "").toString().toLowerCase() !== sellerAddr || BigInt((listingPreApprove.price || 0).toString()) !== priceBn) {
        return;
      }

      let allowanceNow = await usdt.allowance(wallet.address, MARKETPLACE_ADDR);
      const needsUsdtApprove = !BOT_SKIP_USDT_APPROVE_IF_OK || allowanceNow < priceBn;
      if (needsUsdtApprove) {
        const approveUsdtTx = await usdt.approve(MARKETPLACE_ADDR, priceBn, txOverrides("approve"));
        await approveUsdtTx.wait(APPROVE_TX_CONFIRMATIONS);
        await delayMs(POST_APPROVE_DELAY_MS);
        allowanceNow = await usdt.allowance(wallet.address, MARKETPLACE_ADDR);
      }
      if (allowanceNow < priceBn) {
        console.log(`Bot ${botId}: USDT allowance not ready, skip token ${tokenIdStr}`);
        return;
      }
      const listingAgain = await marketplace.listings(tokenId);
      if (!listingAgain?.active || BigInt((listingAgain.price || 0).toString()) !== priceBn) {
        console.log(`Bot ${botId}: listing changed or sold, skip token ${tokenIdStr}`);
        return;
      }

      let buyTx = null;
      let buyReceipt = null;
      for (let attempt = 1; attempt <= BUY_MAX_ATTEMPTS; attempt++) {
        const live = await marketplace.listings(tokenId);
        if (!live?.active || (live.seller || "").toString().toLowerCase() !== sellerAddr) {
          console.log(`Bot ${botId}: listing gone before buy, token ${tokenIdStr}`);
          return;
        }
        if (BigInt((live.price || 0).toString()) !== priceBn) return;
        if (!(await simulateBuyCall(tokenId))) return;
        try {
          buyTx = await marketplace.buy(tokenId, ethers.ZeroAddress, txOverrides("buy"));
          buyReceipt = await buyTx.wait();
          break;
        } catch (e) {
          const summary = summarizeEthersError(e);
          console.warn(
            `Bot ${botId}: buy attempt ${attempt}/${BUY_MAX_ATTEMPTS} failed token ${tokenIdStr} — ${summary}`
          );
          if (attempt >= BUY_MAX_ATTEMPTS) {
            console.error(`Bot ${botId}: buy aborted after ${BUY_MAX_ATTEMPTS} attempts; another bot may succeed`);
            return;
          }
          const backoff = isRateLimitError(e)
            ? Math.min(15_000, Math.max(BUY_RETRY_GAP_MS * attempt, rateLimitPauseMs(e) || 600))
            : BUY_RETRY_GAP_MS * attempt;
          await delayMs(backoff);
        }
      }
      if (!buyTx || !buyReceipt) return;

      console.log(`Bot ${botId}: bought token ${tokenIdStr} (${source})`);
      delete listingTimestamps[tokenIdStr];
      writeListingTimestamps(listingTimestamps);
      prunePendingKey(tokenIdStr);
      await reportPurchaseToBackend({
        buyer: self,
        seller: sellerAddr,
        tokenId: tokenIdStr,
        fallbackPrice: priceBn.toString(),
        txHash: buyTx.hash,
        receipt: buyReceipt,
      });

      let relistOk = false;
      for (let attempt = 1; attempt <= RELIST_AFTER_BUY_MAX_ATTEMPTS; attempt++) {
        try {
          // NFT approve must exist before list() (transferFrom) or staticCall(list) reverts with
          // ERC721InsufficientApproval (selector 0x177e802f on recent OZ).
          let skipNftApprove = false;
          if (BOT_SKIP_NFT_APPROVE_IF_OK) {
            try {
              const curApproved = await nft.getApproved(tokenId);
              if (String(curApproved).toLowerCase() === String(MARKETPLACE_ADDR).toLowerCase()) {
                skipNftApprove = true;
              }
            } catch (_) {}
          }
          if (!skipNftApprove) {
            const approveNftTx = await nft.approve(MARKETPLACE_ADDR, tokenId, txOverrides("approve"));
            await approveNftTx.wait(APPROVE_TX_CONFIRMATIONS);
            await delayMs(POST_NFT_APPROVE_DELAY_MS);
          }
          if (!(await simulateListCall(tokenId))) {
            if (attempt < RELIST_AFTER_BUY_MAX_ATTEMPTS) {
              await new Promise((r) => setTimeout(r, relistRandomBackoffMs()));
            }
            continue;
          }
          const listTx = await marketplace.list(tokenId, LIST_PRICE_WEI, txOverrides("list"));
          await listTx.wait();
          relistOk = true;
          console.log(`Bot ${botId}: relisted token ${tokenIdStr} at $30 (attempt ${attempt})`);
          break;
        } catch (e) {
          if (isRateLimitError(e)) {
            const ms = Math.min(15_000, Math.max(250, rateLimitPauseMs(e) || 600));
            console.warn(
              `Bot ${botId}: relist attempt ${attempt}/${RELIST_AFTER_BUY_MAX_ATTEMPTS} token ${tokenIdStr} — RPC rate limit, wait ${ms}ms`
            );
            await delayMs(ms);
          } else {
            console.warn(
              `Bot ${botId}: relist attempt ${attempt}/${RELIST_AFTER_BUY_MAX_ATTEMPTS} token ${tokenIdStr} — ${formatEthersErrorForLog(e)}`
            );
            if (attempt < RELIST_AFTER_BUY_MAX_ATTEMPTS) {
              await new Promise((r) => setTimeout(r, relistRandomBackoffMs()));
            }
          }
        }
      }
      if (!relistOk) {
        console.error(
          `Bot ${botId}: relist failed after ${RELIST_AFTER_BUY_MAX_ATTEMPTS} attempts; relist-recovery will retry`
        );
      }
    } catch (e) {
      if (isRateLimitError(e)) {
        const ms = rateLimitPauseMs(e) || 700;
        console.warn(
          `Bot ${botId}: trade path rate-limited (${source}) token ${tokenIdStr}; ` +
            `Chainstack RPS — backing off ~${Math.min(10_000, Math.max(400, ms))}ms then worker retries.`
        );
        await delayMs(Math.min(10_000, Math.max(400, ms)));
        return;
      }
      console.error(`Bot ${botId} trade error (${source}) token ${tokenIdStr}:`, e?.message || e);
    } finally {
      await releaseTokenLock(lock);
    }
  }

  async function relistTokenIfNeeded(tokenId, source) {
    const tokenIdStr = tokenId.toString();
    const lock = await acquireTokenLock(tokenIdStr);
    if (!lock) return false;
    try {
      const listing = await marketplace.listings(tokenId);
      const seller = (listing?.seller || listing?.[0] || "").toString().toLowerCase();
      const isActive = Boolean(listing?.active ?? listing?.[3]);
      if (isActive && seller === self) return false; // already listed by this bot

      const owner = (await nft.ownerOf(tokenId)).toString().toLowerCase();
      if (owner !== self) return false; // not held anymore

      let skipNftApprove = false;
      if (BOT_SKIP_NFT_APPROVE_IF_OK) {
        try {
          const curApproved = await nft.getApproved(tokenId);
          if (String(curApproved).toLowerCase() === String(MARKETPLACE_ADDR).toLowerCase()) {
            skipNftApprove = true;
          }
        } catch (_) {}
      }
      if (!skipNftApprove) {
        const approveTx = await nft.approve(MARKETPLACE_ADDR, tokenId, txOverrides("approve"));
        await approveTx.wait(APPROVE_TX_CONFIRMATIONS);
        await delayMs(POST_NFT_APPROVE_DELAY_MS);
      }
      if (!(await simulateListCall(tokenId))) return false;

      const listTx = await marketplace.list(tokenId, LIST_PRICE_WEI, txOverrides("list"));
      await listTx.wait();
      console.log(`Bot ${botId}: relisted held token ${tokenIdStr} (${source})`);
      return true;
    } catch (e) {
      if (isRateLimitError(e)) {
        const ms = Math.min(12_000, Math.max(200, rateLimitPauseMs(e) || 400));
        console.warn(
          `Bot ${botId}: relist token ${tokenIdStr} (${source}) — RPC rate limit, wait ${ms}ms (next relist interval will retry)`
        );
        await delayMs(ms);
      } else {
        console.warn(
          `Bot ${botId}: relist retry failed token ${tokenIdStr} (${source}) — ${formatEthersErrorForLog(e)}`
        );
      }
      return false;
    } finally {
      await releaseTokenLock(lock);
    }
  }

  async function relistHeldNftsIfAny(source) {
    try {
      const totalMinted = await getTotalMintedSafe();
      if (!Number.isFinite(totalMinted) || totalMinted <= 0) return;

      const scanBatch = Math.max(1, Math.min(RELIST_SCAN_BATCH_SIZE, 200));
      const maxPerRun = Math.max(1, Math.min(RELIST_MAX_PER_RUN, 20));
      let relisted = 0;

      for (let start = 1; start <= totalMinted; start += scanBatch) {
        const end = Math.min(totalMinted, start + scanBatch - 1);
        const tokenIds = Array.from({ length: end - start + 1 }, (_, idx) => start + idx);
        const owners = [];
        for (const tid of tokenIds) {
          try {
            owners.push(String(await nft.ownerOf(tid) || "").toLowerCase());
          } catch {
            owners.push("");
          }
          if (RELIST_OWNER_RPC_GAP_MS > 0) {
            await delayMs(RELIST_OWNER_RPC_GAP_MS);
          }
        }
        for (let i = 0; i < tokenIds.length; i++) {
          if (owners[i] !== self) continue;
          const didRelist = await relistTokenIfNeeded(tokenIds[i], source);
          if (didRelist) relisted++;
          if (relisted >= maxPerRun) return;
        }
      }
    } catch (e) {
      console.warn(`Bot ${botId}: relist worker error`, e?.message || e);
    }
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function reportPurchaseToBackend({ buyer, seller, tokenId, fallbackPrice, txHash, receipt }) {
    try {
      if (!BOT_RECORD_PURCHASE_URL) return;
      let eventId = "";
      let salePrice = String(fallbackPrice || "0");
      const txHashLower = String(txHash || "").toLowerCase();
      for (const log of receipt?.logs || []) {
        try {
          const parsed = marketplace.interface.parseLog(log);
          if (!parsed || parsed.name !== "Sold") continue;
          const soldTokenId = parsed.args?.tokenId != null ? String(parsed.args.tokenId) : "";
          if (soldTokenId !== String(tokenId)) continue;
          const soldBuyer = String(parsed.args?.buyer || "").toLowerCase();
          if (soldBuyer && soldBuyer !== String(buyer || "").toLowerCase()) continue;
          salePrice = parsed.args?.price != null ? String(parsed.args.price) : salePrice;
          const logIndex = Number(log?.index ?? log?.logIndex ?? -1);
          if (txHashLower && logIndex >= 0) eventId = `${txHashLower}_${logIndex}`;
          break;
        } catch (_) {}
      }
      const headers = {
        "content-type": "application/json",
      };
      if (BOT_CONTROL_API_KEY) headers["x-bot-control-key"] = BOT_CONTROL_API_KEY;
      const res = await fetchWithTimeout(
        BOT_RECORD_PURCHASE_URL,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            buyer,
            seller: seller || null,
            tokenId: String(tokenId),
            price: salePrice,
            txHash: txHash || null,
            eventId: eventId || null,
            blockNumber: Number(receipt?.blockNumber ?? 0) || null,
          }),
        },
        Math.max(1500, CONTROL_REQUEST_TIMEOUT_MS)
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn(`Bot ${botId}: record-purchase API failed ${res.status} ${text}`.trim());
      }
    } catch (e) {
      console.warn(`Bot ${botId}: record-purchase call failed`, e?.message || e);
    }
  }

  async function isBotEnabled(force = false) {
    // No control URL configured -> always active (backward compatible).
    if (!BOT_CONTROL_BASE_URL) return true;
    const now = Date.now();
    if (!force && now - lastControlFetchAt < Math.max(1000, CONTROL_REFRESH_MS)) {
      return cachedEnabled;
    }
    lastControlFetchAt = now;
    try {
      const endpoint = `${BOT_CONTROL_BASE_URL.replace(/\/$/, "")}/${botId}`;
      const headers = BOT_CONTROL_API_KEY ? { "x-bot-control-key": BOT_CONTROL_API_KEY } : {};
      const res = await fetchWithTimeout(
        endpoint,
        { headers },
        Math.max(1000, CONTROL_REQUEST_TIMEOUT_MS)
      );
      if (!res.ok) throw new Error(`control endpoint ${res.status}`);
      const data = await res.json();
      cachedEnabled = Boolean(data?.running);
      const cfgDelay = Number(data?.settings?.buybackDelayMs);
      if (Number.isFinite(cfgDelay) && cfgDelay >= 60_000) {
        dynamicUserListingMinAgeMs = Math.floor(cfgDelay);
      }
      hadControlError = false;
      return cachedEnabled;
    } catch (e) {
      if (!hadControlError) {
        console.warn(`Bot ${botId}: control-state fetch failed, using last known state`, e?.message || e);
        hadControlError = true;
      }
      return cachedEnabled;
    }
  }

  console.log(`Bot ${botId} wallet: ${wallet.address}`);
  buildKnownBotWalletSet();
  marketLc = (MARKETPLACE_ADDR || "").toLowerCase();

  async function ensureBotTraderEligibility() {
    if (botTraderEligible !== null) return botTraderEligible;
    try {
      botTraderEligible = await withBotRpcRetry(() => marketplaceRead.isBotTrader(wallet.address), {
        retries: 8,
        baseMs: 600,
      });
      if (!botTraderEligible) {
        console.error(
          `Bot ${botId}: wallet is NOT whitelisted as bot trader. ` +
            `Marketplace will revert with "Subscribe to buy". ` +
            `Contract owner must call: marketplace.addBotTrader("${wallet.address}")`
        );
      }
      return botTraderEligible;
    } catch (e) {
      console.warn(
        `Bot ${botId}: could not check isBotTrader after retries`,
        e?.shortMessage || e?.message || e
      );
      return false;
    }
  }
  await ensureBotTraderEligibility();

  if (BOT_SKIP_LIST_STATIC_SIMULATE) {
    console.log(`Bot ${botId}: BOT_SKIP_LIST_STATIC_SIMULATE=true — skipping list() eth_call simulation`);
  }
  try {
    const onChainLp = await marketplaceRead.listPrice();
    const onChainBn = BigInt(onChainLp.toString());
    if (onChainBn !== LIST_PRICE_WEI) {
      console.warn(
        `Bot ${botId}: marketplace listPrice=${onChainBn.toString()} bot expects LIST_PRICE_WEI=${LIST_PRICE_WEI.toString()} (config.js); list() reverts with "Invalid price" if mismatched`
      );
    }
  } catch (e) {
    console.warn(`Bot ${botId}: could not read marketplace listPrice()`, summarizeEthersError(e));
  }

  await refreshUniversalListenerRole();

  if (USE_EVENT_PENDING_QUEUE && runsChainPoll && BOT_BOOTSTRAP_LISTING_SCAN) {
    try {
      if (Object.keys(pendingUserListings).length === 0) {
        console.log(`Bot ${botId}: BOT_BOOTSTRAP_LISTING_SCAN — one-time full mint scan to seed pending queue`);
        const rows = await collectUserListingRowsFullScan();
        for (const row of rows) {
          const tid = row.tokenId.toString();
          const sl = (row.seller || "").toString().toLowerCase();
          upsertPendingForUserListing(tid, sl, BigInt(row.price.toString()), row.listedAtMs);
        }
      }
    } catch (e) {
      console.warn(`Bot ${botId}: bootstrap listing scan failed`, e?.message || e);
    }
  }

  await hasAnyActiveUserListing(true).catch(() => {});
  const initialEnabled = await isBotEnabled(true);
  wasEnabled = Boolean(initialEnabled);
  if (!wasEnabled) console.log(`Bot ${botId} paused by admin state (running=false). Listening only.`);

  if (USE_HTTP_LISTING_DISCOVERY && !BOT_SINGLE_CHAIN_LISTENER) {
    console.warn(
      `Bot ${botId}: BOT_LISTING_SOURCE=${BOT_LISTING_SOURCE} with BOT_SINGLE_CHAIN_LISTENER=false may duplicate shared pending-listing writes across processes`
    );
  }
  if (
    (BOT_LISTING_SOURCE === "database" ||
      BOT_LISTING_SOURCE === "api" ||
      BOT_LISTING_SOURCE === "listings") &&
    !USE_EVENT_PENDING_QUEUE
  ) {
    console.warn(
      `Bot ${botId}: BOT_LISTING_SOURCE=${BOT_LISTING_SOURCE} has no effect while BOT_EVENT_PENDING_QUEUE=false (using rpc/full-scan paths)`
    );
  }
  const listingSourceLog = USE_DB_LISTING_QUEUE
    ? "database"
    : USE_MARKETPLACE_LISTINGS_API
      ? "api (/marketplace/listings)"
      : "rpc";
  const listingDiscoveryLog = USE_DB_LISTING_QUEUE
    ? "listing-queue API (each bot process)"
    : USE_MARKETPLACE_LISTINGS_API
      ? "marketplace listings API (each bot process)"
      : "getLogs";
  const listenerNote = USE_HTTP_LISTING_DISCOVERY
    ? `${listingDiscoveryLog}; poll ${LISTING_DISCOVERY_POLL_MS}ms`
    : `universal getLogs leader=${runsChainPoll} (${listingDiscoveryLog}); poll ${LISTING_DISCOVERY_POLL_MS}ms when leader`;
  console.log(
    `Bot ${botId} running. Buyback from admin delay; event queue=${USE_EVENT_PENDING_QUEUE}; ` +
      `listing source=${listingSourceLog}; ${listenerNote}.`
  );

  if (wasEnabled) {
    enqueue(runUserBuybackWorkerImpl);
  }

  enqueue(pollListingDiscoveryLoop);
  setInterval(() => {
    enqueue(pollListingDiscoveryLoop);
  }, LISTING_DISCOVERY_POLL_MS);

  setInterval(() => {
    enqueue(async () => {
      const enabled = await isBotEnabled();
      if (!enabled) return;
      kickUserBuybackRescan();
    });
  }, Math.max(60_000, USER_BUYBACK_SAFETY_SWEEP_MS));

  // Lightweight admin-state watcher (no chain scans).
  setInterval(async () => {
    try {
      const enabled = await isBotEnabled();
      if (enabled !== wasEnabled) {
        wasEnabled = enabled;
        cachedRunningBotIdsAt = 0;
        console.log(`Bot ${botId}: ${enabled ? "resumed" : "paused"} by admin state`);
        if (enabled) {
          kickUserBuybackRescan();
        }
      }
    } catch (e) {
      console.warn(`Bot ${botId}: control watcher error`, e?.shortMessage || e?.message || e);
    }
  }, Math.max(2000, CONTROL_REFRESH_MS));

  // Recovery worker: if bot holds NFTs that are not listed, list them automatically.
  setInterval(() => {
    enqueue(async () => {
      const enabled = await isBotEnabled();
      if (!enabled) return;
      await relistHeldNftsIfAny("relist-recovery");
    });
  }, Math.max(5000, RELIST_CHECK_MS));

  // Keep process alive (timers + task queue).
  await new Promise(() => {});
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
