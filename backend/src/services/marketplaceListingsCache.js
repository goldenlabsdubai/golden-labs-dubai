/**
 * On-chain marketplace listings with TTL cache and stale-while-revalidate.
 * Reduces full 1..totalMinted scans on every GET /api/marketplace/listings (telegram poller, etc.).
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

/** Call when Listed / Sold / ListingCancelled is observed (indexer or record-purchase). */
export function markMarketplaceListingsStale() {
  listingsStale = true;
}

function scheduleBackgroundRefresh() {
  if (refreshPromise) return;
  if (Date.now() < rpcCooldownUntil) return;
  refreshPromise = refreshListingsFromChain()
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
 * @param {{ forceRefresh?: boolean }} [options]
 * @returns {Promise<{ listings: object[], fromCache?: boolean, cacheAgeMs?: number | null }>}
 */
export async function getMarketplaceListingsResponse(options = {}) {
  const now = Date.now();
  const ttl = getListingsCacheTtlMs();
  const hasCache = listingsCacheAt > 0;
  const cacheAgeMs = hasCache ? now - listingsCacheAt : null;
  const fresh = hasCache && !listingsStale && cacheAgeMs < ttl;

  if (!options.forceRefresh && fresh) {
    return { listings: listingsCache, fromCache: true, cacheAgeMs };
  }

  if (now < rpcCooldownUntil && hasCache) {
    return { listings: listingsCache, fromCache: true, cacheAgeMs };
  }

  if (!options.forceRefresh && hasCache) {
    scheduleBackgroundRefresh();
    return { listings: listingsCache, fromCache: true, cacheAgeMs };
  }

  if (refreshPromise) {
    try {
      return await refreshPromise;
    } catch (e) {
      if (hasCache) {
        return { listings: listingsCache, fromCache: true, cacheAgeMs };
      }
      throw e;
    }
  }

  return refreshListingsFromChain();
}

async function refreshListingsFromChain() {
  if (refreshPromise) return refreshPromise;

  const run = async () => {
    const marketAddr = (getMarketplaceAndReservePoolAddress() || "").trim();
    const nftAddr = (process.env.NFT_CONTRACT_ADDRESS || "").trim();
    if (!marketAddr || !nftAddr) {
      listingsCache = [];
      listingsCacheAt = Date.now();
      listingsStale = false;
      return { listings: [] };
    }

    const provider = getSharedMainRpcProvider();
    const nftContract = new ethers.Contract(
      nftAddr,
      ["function totalMinted() view returns (uint256)", "function tokenURI(uint256 tokenId) view returns (string)"],
      provider
    );
    const marketContract = new ethers.Contract(marketAddr, MARKETPLACE_ABI, provider);

    const totalMintedRaw = await readWithRetry(() => nftContract.totalMinted(), null, 2, 7000);
    const totalMinted = totalMintedRaw != null ? Number(totalMintedRaw) : NaN;
    if (!Number.isFinite(totalMinted)) {
      if (listingsCacheAt) {
        return { listings: listingsCache, fromCache: true, cacheAgeMs: Date.now() - listingsCacheAt };
      }
      return { listings: [] };
    }
    if (totalMinted === 0) {
      listingsCache = [];
      listingsCacheAt = Date.now();
      listingsStale = false;
      return { listings: [] };
    }

    const listings = [];
    const BATCH = Math.max(10, Math.min(Number(process.env.MARKETPLACE_LISTINGS_BATCH || 25), 60));
    for (let start = 1; start <= totalMinted; start += BATCH) {
      const end = Math.min(start + BATCH - 1, totalMinted);
      const promises = [];
      for (let tokenId = start; tokenId <= end; tokenId++) {
        promises.push(
          Promise.all([
            readWithRetry(() => marketContract.listings(tokenId), null, 2, 7000),
            readWithRetry(() => nftContract.tokenURI(tokenId), "", 1, 5000),
          ]).then(async ([listing, tokenURI]) => {
            if (!listing) return null;
            const active = listing?.[3];
            const seller = listing?.[0];
            const price = listing?.[2];
            if (active && seller && price != null) {
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
              return { tokenId: String(tokenId), seller, price: String(price), tokenURI: uri, listedAtSec };
            }
            return null;
          }, () => null)
        );
      }
      const batch = await Promise.all(promises);
      batch.forEach((r) => {
        if (r) {
          listings.push({
            tokenId: r.tokenId,
            seller: String(r.seller),
            price: r.price,
            priceFormatted: formatListingPriceUsdtLabel(r.price),
            tokenURI: r.tokenURI || "",
            listedAtSec: r.listedAtSec ?? 0,
          });
        }
      });
    }

    const listingBlocks = await getListingBlocksMap().catch(() => ({}));
    listings.forEach((l) => {
      const fromChainMs = l.listedAtSec > 0 ? l.listedAtSec * 1000 : 0;
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
    listings.sort((a, b) => {
      if (a.listingTierRank !== b.listingTierRank) return a.listingTierRank - b.listingTierRank;
      return sortByListedTimeOldestFirst(a, b);
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

    listingsCache = listings;
    listingsCacheAt = Date.now();
    listingsStale = false;
    return { listings };
  };

  refreshPromise = run()
    .catch((e) => {
      if (isRpcRateLimitError(e)) {
        rpcCooldownUntil = Date.now() + getListingsRpcCooldownMs();
      }
      if (listingsCacheAt) {
        return { listings: listingsCache, fromCache: true, cacheAgeMs: Date.now() - listingsCacheAt };
      }
      throw e;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}
