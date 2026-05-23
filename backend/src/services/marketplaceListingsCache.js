/**
 * Marketplace listings: one sequential warm-up scan, then in-memory cache.
 * Listed / Sold / ListingCancelled patch the cache immediately (indexer + record-purchase).
 */
import { ethers } from "ethers";
import * as User from "./user.js";
import { getListingBlocksMap } from "./marketplaceActivityIndexer.js";
import { getMarketplaceAndReservePoolAddress } from "../config/contractsEnv.js";
import { getSharedMainRpcProvider, isRpcRateLimitError } from "../config/ethersRpc.js";
import { USDT_DECIMALS } from "../constants/usdtDecimals.js";

const MARKETPLACE_ABI = [
  "function listings(uint256) view returns (address, uint256, uint256, bool)",
  "function listingListedAt(uint256) view returns (uint64)",
  "function isBotTrader(address) view returns (bool)",
];

let listingsCache = [];
let listingsCacheAt = 0;
let listingsStale = true;
/** False until the first successful full on-chain scan completes. */
let listingsWarmReady = false;
let refreshPromise = null;
let rpcCooldownUntil = 0;

function getListingsCacheTtlMs() {
  const raw = process.env.MARKETPLACE_LISTINGS_CACHE_TTL_MS;
  const n = raw != null && String(raw).trim() !== "" ? Number(raw) : 90_000;
  return Number.isFinite(n) && n >= 0 ? n : 90_000;
}

function getListingsRpcCooldownMs() {
  const raw = process.env.MARKETPLACE_LISTINGS_RPC_COOLDOWN_MS;
  const n = raw != null && String(raw).trim() !== "" ? Number(raw) : 60_000;
  return Number.isFinite(n) && n > 0 ? n : 60_000;
}

function getWarmScanDelayMs() {
  const raw = process.env.MARKETPLACE_LISTINGS_WARM_DELAY_MS;
  const n = raw != null && String(raw).trim() !== "" ? Number(raw) : 50;
  return Number.isFinite(n) && n >= 0 ? n : 50;
}

function isWarmSequentialScan() {
  return (process.env.MARKETPLACE_LISTINGS_WARM_SEQUENTIAL || "1").trim() !== "0";
}

function sortByListedTimeOldestFirst(a, b) {
  const ta = Number(a.listedAt ?? 0);
  const tb = Number(b.listedAt ?? 0);
  const aMissing = !Number.isFinite(ta) || ta <= 0;
  const bMissing = !Number.isFinite(tb) || tb <= 0;
  if (aMissing && bMissing) return String(a.seller || "").localeCompare(String(b.seller || ""));
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (ta !== tb) return ta - tb;
  return String(a.seller || "").localeCompare(String(b.seller || ""));
}

function sortListingsArray(arr) {
  arr.sort((a, b) => {
    if (a.listingTierRank !== b.listingTierRank) return a.listingTierRank - b.listingTierRank;
    return sortByListedTimeOldestFirst(a, b);
  });
}

function sortListingsCache() {
  sortListingsArray(listingsCache);
}

function formatListingPriceUsdtLabel(priceWei) {
  try {
    const s = ethers.formatUnits(String(priceWei ?? "0"), USDT_DECIMALS);
    const n = Number.parseFloat(s);
    return `${Number.isFinite(n) ? n.toFixed(0) : s} USDT`;
  } catch {
    return "0 USDT";
  }
}

function getMetadataBaseForToken(tokenId) {
  const multi = (process.env.NFT_METADATA_BASE_URIS || "")
    .trim()
    .split(",")
    .map((s) => s.trim().replace(/^ipfs:\/\//, ""))
    .filter(Boolean);
  if (multi.length > 0) {
    const batchSize = Number(process.env.NFT_METADATA_BATCH_SIZE) || 500;
    const index = Math.min(Math.floor((Number(tokenId) - 1) / batchSize), multi.length - 1);
    return multi[index] || multi[0];
  }
  return (process.env.NFT_METADATA_BASE_URI || "").trim().replace(/^ipfs:\/\//, "");
}

async function readWithRetry(fn, fallback, retries = 2, timeoutMs = 7000) {
  let lastError = null;
  for (let i = 0; i <= retries; i++) {
    try {
      return await Promise.race([
        fn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("read timeout")), timeoutMs)),
      ]);
    } catch (e) {
      lastError = e;
      if (isRpcRateLimitError(e)) throw e;
      if (i < retries) {
        await new Promise((r) => setTimeout(r, 250 * (i + 1)));
      }
    }
  }
  if (lastError) {
    /* caller applies fallback */
  }
  return fallback;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getContracts() {
  const marketAddr = (getMarketplaceAndReservePoolAddress() || "").trim();
  const nftAddr = (process.env.NFT_CONTRACT_ADDRESS || "").trim();
  if (!marketAddr || !nftAddr) return null;
  const provider = getSharedMainRpcProvider();
  const nftContract = new ethers.Contract(
    nftAddr,
    ["function totalMinted() view returns (uint256)", "function tokenURI(uint256 tokenId) view returns (string)"],
    provider
  );
  const marketContract = new ethers.Contract(marketAddr, MARKETPLACE_ABI, provider);
  return { marketAddr, nftAddr, nftContract, marketContract };
}

async function fetchActiveListingRaw(tokenId, nftContract, marketContract) {
  const [listing, tokenURI] = await Promise.all([
    readWithRetry(() => marketContract.listings(tokenId), null, 2, 7000),
    readWithRetry(() => nftContract.tokenURI(tokenId), "", 1, 5000),
  ]);
  if (!listing) return { ok: false, failed: true, row: null };
  const active = listing?.[3];
  const seller = listing?.[0];
  const price = listing?.[2];
  if (!active || !seller || price == null) {
    return { ok: true, failed: false, row: null };
  }
  let listedAtSec = 0;
  try {
    const la = await readWithRetry(() => marketContract.listingListedAt(tokenId), 0n, 1, 5000);
    listedAtSec = la != null ? Number(la) : 0;
  } catch (_) {
    listedAtSec = 0;
  }
  let uri = (tokenURI && String(tokenURI).trim()) || "";
  if (!uri) {
    const base = getMetadataBaseForToken(tokenId);
    if (base) uri = `ipfs://${base}/${tokenId}.json`;
  }
  uri = (uri || "").replace(/^(ipfs:\/\/)+/i, "ipfs://");
  return {
    ok: true,
    failed: false,
    row: {
      tokenId: String(tokenId),
      seller: String(seller),
      price: String(price),
      priceFormatted: formatListingPriceUsdtLabel(price),
      tokenURI: uri || "",
      listedAtSec,
    },
  };
}

async function enrichListings(listings, marketAddr, marketContract, listingBlocks) {
  listings.forEach((l) => {
    const fromChainMs = (l.listedAtSec ?? 0) > 0 ? l.listedAtSec * 1000 : 0;
    const entry = listingBlocks[String(l.tokenId)];
    const fromIndexer = entry?.timestamp != null ? Number(entry.timestamp) : 0;
    l.listedAt = fromChainMs > 0 ? fromChainMs : fromIndexer;
    delete l.listedAtSec;
  });

  const marketNorm = marketAddr.toLowerCase();
  const uniqueForBotCheck = [...new Set(listings.map((l) => (l.seller || "").toLowerCase()))].filter(Boolean);
  const botTraderCache = {};
  await Promise.all(
    uniqueForBotCheck.map(async (w) => {
      if (w === marketNorm) {
        botTraderCache[w] = false;
        return;
      }
      botTraderCache[w] = !!(await readWithRetry(() => marketContract.isBotTrader(w), false, 1, 4000));
    })
  );
  listings.forEach((l) => {
    const s = (l.seller || "").toLowerCase();
    if (s === marketNorm) {
      l.listingTier = "dynamic";
      l.listingTierRank = 0;
      l.listingTierLabel = "Dynamic";
    } else if (botTraderCache[s]) {
      l.listingTier = "bot";
      l.listingTierRank = 1;
      l.listingTierLabel = "Bot";
    } else {
      l.listingTier = "user";
      l.listingTierRank = 2;
      l.listingTierLabel = "Member";
    }
  });

  const uniqueSellers = [...new Set(listings.map((l) => (l.seller || "").toLowerCase()))].filter(Boolean);
  const sellerMap = {};
  await Promise.all(
    uniqueSellers.map(async (wallet) => {
      const u = await User.getUserByWallet(wallet);
      sellerMap[wallet] = { username: u?.username ?? null, name: u?.name ?? null };
    })
  );
  listings.forEach((l) => {
    const key = (l.seller || "").toLowerCase();
    const info = sellerMap[key] || {};
    l.sellerUsername = info.username ?? null;
    l.sellerName = info.name ?? null;
  });

  sortListingsArray(listings);
}

function commitListingsCache(listings) {
  listingsCache = listings;
  listingsCacheAt = Date.now();
  listingsStale = false;
  listingsWarmReady = true;
}

/** Remove a token from cache immediately (buy, cancel, sold). */
export function removeListingFromCache(tokenId) {
  const tid = String(tokenId);
  const next = listingsCache.filter((l) => String(l.tokenId) !== tid);
  if (next.length !== listingsCache.length) {
    listingsCache = next;
    listingsCacheAt = Date.now();
    listingsStale = false;
  }
}

/**
 * Add or update one listing from chain (Listed event or repair).
 * @param {string|number} tokenId
 * @param {{ listedAtMs?: number }} [opts]
 */
export async function upsertListingFromChain(tokenId, opts = {}) {
  if (!listingsWarmReady) return;
  const contracts = getContracts();
  if (!contracts) return;
  const { marketAddr, nftContract, marketContract } = contracts;
  const tid = String(tokenId);
  const raw = await fetchActiveListingRaw(Number(tid), nftContract, marketContract);
  if (raw.failed) {
    listingsStale = true;
    scheduleBackgroundRefresh();
    return;
  }
  if (!raw.row) {
    removeListingFromCache(tid);
    return;
  }

  const listingBlocks = await getListingBlocksMap().catch(() => ({}));
  const rows = [raw.row];
  await enrichListings(rows, marketAddr, marketContract, listingBlocks);
  const row = rows[0];
  if (opts.listedAtMs != null && Number(opts.listedAtMs) > 0) {
    row.listedAt = Number(opts.listedAtMs);
  }

  const idx = listingsCache.findIndex((l) => String(l.tokenId) === tid);
  if (idx >= 0) listingsCache[idx] = row;
  else listingsCache.push(row);
  sortListingsCache();
  listingsCacheAt = Date.now();
  listingsStale = false;
}

/** Fallback: full rescan when event patch is not enough. */
export function markMarketplaceListingsStale() {
  listingsStale = true;
}

function scheduleBackgroundRefresh() {
  if (refreshPromise || !listingsWarmReady) return;
  if (Date.now() < rpcCooldownUntil) return;
  refreshPromise = refreshListingsFromChain({ warm: false })
    .catch((e) => {
      if (isRpcRateLimitError(e)) {
        rpcCooldownUntil = Date.now() + getListingsRpcCooldownMs();
        console.warn("marketplace listings refresh: RPC rate limit; serving cache until cooldown");
      } else {
        console.warn("marketplace listings background refresh:", e?.message || e);
      }
    })
    .finally(() => {
      refreshPromise = null;
    });
}

/**
 * Boot-time warm-up: scan tokens (sequential by default for free RPC), then enable cache.
 */
export function warmMarketplaceListingsCache() {
  if (listingsWarmReady || refreshPromise) return refreshPromise || Promise.resolve();
  console.log("[marketplace] Warming listings cache (first full on-chain scan)…");
  return refreshListingsFromChain({ warm: true }).then((r) => {
    if (listingsWarmReady) {
      console.log(`[marketplace] Listings cache warm (${(r.listings || []).length} active listing(s))`);
    }
    return r;
  });
}

/**
 * @param {{ forceRefresh?: boolean }} [options]
 */
export async function getMarketplaceListingsResponse(options = {}) {
  if (!listingsWarmReady || options.forceRefresh) {
    return refreshListingsFromChain({ warm: !listingsWarmReady, force: !!options.forceRefresh });
  }

  const now = Date.now();
  const ttl = getListingsCacheTtlMs();
  const cacheAgeMs = now - listingsCacheAt;
  const fresh = !listingsStale && cacheAgeMs < ttl;

  if (fresh) {
    return { listings: listingsCache, fromCache: true, cacheAgeMs };
  }

  if (now < rpcCooldownUntil) {
    return { listings: listingsCache, fromCache: true, cacheAgeMs };
  }

  scheduleBackgroundRefresh();
  return { listings: listingsCache, fromCache: true, cacheAgeMs };
}

/**
 * @param {{ warm?: boolean, force?: boolean }} [opts]
 */
async function refreshListingsFromChain(opts = {}) {
  if (refreshPromise) return refreshPromise;

  const run = async () => {
    const contracts = getContracts();
    if (!contracts) {
      console.warn("marketplace listings: NFT_CONTRACT_ADDRESS or marketplace address missing in env");
      listingsStale = true;
      return { listings: [], configMissing: true, warming: true };
    }
    const { marketAddr, nftContract, marketContract } = contracts;

    const totalMintedRaw = await readWithRetry(() => nftContract.totalMinted(), null, 2, 7000);
    const totalMinted = totalMintedRaw != null ? Number(totalMintedRaw) : NaN;
    if (!Number.isFinite(totalMinted)) {
      if (listingsWarmReady && listingsCacheAt) {
        return { listings: listingsCache, fromCache: true, cacheAgeMs: Date.now() - listingsCacheAt, rpcScanFailed: true };
      }
      return { listings: [], warming: true, rpcScanFailed: true };
    }
    if (totalMinted === 0) {
      commitListingsCache([]);
      return { listings: [] };
    }

    const listings = [];
    let listingReadsOk = 0;
    let listingReadsFailed = 0;
    const useSequential = opts.warm !== false && isWarmSequentialScan();
    const warmDelay = getWarmScanDelayMs();

    if (useSequential) {
      for (let tokenId = 1; tokenId <= totalMinted; tokenId++) {
        const raw = await fetchActiveListingRaw(tokenId, nftContract, marketContract);
        if (raw.failed) listingReadsFailed += 1;
        else {
          listingReadsOk += 1;
          if (raw.row) listings.push(raw.row);
        }
        if (warmDelay > 0 && tokenId < totalMinted) await sleep(warmDelay);
      }
    } else {
      const BATCH = Math.max(10, Math.min(Number(process.env.MARKETPLACE_LISTINGS_BATCH || 25), 60));
      for (let start = 1; start <= totalMinted; start += BATCH) {
        const end = Math.min(start + BATCH - 1, totalMinted);
        const promises = [];
        for (let tokenId = start; tokenId <= end; tokenId++) {
          promises.push(
            fetchActiveListingRaw(tokenId, nftContract, marketContract).then((raw) => {
              if (raw.failed) {
                listingReadsFailed += 1;
                return null;
              }
              listingReadsOk += 1;
              return raw.row;
            })
          );
        }
        const batch = await Promise.all(promises);
        batch.forEach((r) => {
          if (r) listings.push(r);
        });
      }
    }

    if (listings.length === 0 && totalMinted > 0 && listingReadsOk === 0 && listingReadsFailed > 0) {
      listingsStale = true;
      listingsWarmReady = false;
      console.warn(
        `marketplace listings: RPC scan failed (${listingReadsFailed}/${totalMinted} reads null); warm not ready`
      );
      if (listingsCache.length > 0) {
        return { listings: listingsCache, fromCache: true, cacheAgeMs: Date.now() - listingsCacheAt, rpcScanFailed: true };
      }
      return { listings: [], rpcScanFailed: true, warming: true };
    }

    const listingBlocks = await getListingBlocksMap().catch(() => ({}));
    await enrichListings(listings, marketAddr, marketContract, listingBlocks);
    commitListingsCache(listings);
    return { listings: listingsCache };
  };

  refreshPromise = run()
    .catch((e) => {
      if (isRpcRateLimitError(e)) {
        rpcCooldownUntil = Date.now() + getListingsRpcCooldownMs();
        listingsWarmReady = false;
      }
      if (listingsWarmReady && listingsCacheAt) {
        return { listings: listingsCache, fromCache: true, cacheAgeMs: Date.now() - listingsCacheAt };
      }
      throw e;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}
