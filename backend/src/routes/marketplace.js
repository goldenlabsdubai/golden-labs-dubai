import { Router } from "express";
import { ethers } from "ethers";
import * as User from "../services/user.js";
import { getListingBlocksMap } from "../services/marketplaceActivityIndexer.js";
import { getMarketplaceAndReservePoolAddress } from "../config/contractsEnv.js";

const router = Router();
let listingsCache = [];
let listingsCacheAt = 0;

/**
 * Within the same queue tier: oldest listed first, recently listed last.
 * Missing listedAt (0) sorts last. Tie-break: seller address (not tokenId).
 */
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

/** Fixed list/buy price — must match MarketplaceAndReservePoolContract (30 USDT, 6 decimals). */
const MARKETPLACE_LIST_PRICE_USDT = 30;
const MARKETPLACE_LIST_PRICE_WEI = "30000000";

const getProvider = () => {
  const rpc = process.env.RPC_URL || "http://127.0.0.1:8545";
  return new ethers.JsonRpcProvider(rpc);
};

const MARKETPLACE_ABI = [
  "event Listed(uint256 indexed tokenId, address seller, uint256 price)",
  "event Sold(uint256 indexed tokenId, address seller, address buyer, uint256 price)",
  "event ListingCancelled(uint256 indexed tokenId)",
  "function listings(uint256) view returns (address, uint256, uint256, bool)",
  "function listingListedAt(uint256) view returns (uint64)",
  "function saleCount(uint256) view returns (uint256)",
  "function isBotTrader(address) view returns (bool)",
];

// Resolve wallet from JWT (req.wallet) or from DB user
async function getWalletForRequest(req) {
  if (req.wallet) return (req.wallet || "").toLowerCase();
  const user = await User.getUser(req);
  const w = (user?.wallet || "").toLowerCase();
  return w || null;
}

function isBotActivityAuthorized(req) {
  const expected = (process.env.BOT_CONTROL_API_KEY || "").trim();
  if (!expected) return true; // Backward-compatible for local setups.
  const provided = String(req.headers["x-bot-control-key"] || req.query.key || "").trim();
  return Boolean(provided) && provided === expected;
}

/** Base CID for tokenId when using NFT_METADATA_BASE_URIS (comma-separated). Batch size must match upload script (500). */
function getMetadataBaseForToken(tokenId) {
  const multi = (process.env.NFT_METADATA_BASE_URIS || "").trim().split(",").map((s) => s.trim().replace(/^ipfs:\/\//, "")).filter(Boolean);
  if (multi.length > 0) {
    const batchSize = Number(process.env.NFT_METADATA_BATCH_SIZE) || 500;
    const index = Math.min(Math.floor((Number(tokenId) - 1) / batchSize), multi.length - 1);
    return multi[index] || multi[0];
  }
  return (process.env.NFT_METADATA_BASE_URI || "").trim().replace(/^ipfs:\/\//, "");
}

/**
 * When NFT_LOCAL_ANIMATION_URL is set (full URL to e.g. /uploads/nft-asset.mp4), metadata points at that file — no IPFS.
 * When NFT_MP4_CID is set, metadata uses one IPFS CID for all tokens. Otherwise use IPFS base / on-chain URI.
 */
function ensureMetadataUri(uri, tokenId) {
  const localAnim = (process.env.NFT_LOCAL_ANIMATION_URL || "").trim();
  const backendBase = (process.env.BACKEND_URL || "").trim().replace(/\/$/, "");
  if (localAnim && backendBase) {
    return `${backendBase}/api/marketplace/nft-metadata/${tokenId}`;
  }
  const mp4Cid = (process.env.NFT_MP4_CID || "").trim();
  if (mp4Cid) {
    const base = (process.env.BACKEND_URL || "").trim().replace(/\/$/, "");
    if (base) return `${base}/api/marketplace/nft-metadata/${tokenId}`;
  }
  uri = (uri && String(uri).trim()) || "";
  uri = uri.replace(/^(ipfs:\/\/)+/i, "ipfs://");
  if (!uri) {
    const base = getMetadataBaseForToken(tokenId);
    return base ? `ipfs://${base}/${tokenId}.json` : "";
  }
  if (!uri.toLowerCase().includes(".json")) {
    uri = uri.replace(/\/?$/, "") + "/" + tokenId + ".json";
  }
  return uri;
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
      if (i < retries) {
        await new Promise((r) => setTimeout(r, 250 * (i + 1)));
      }
    }
  }
  if (lastError) {
    // keep logs concise; caller applies fallback.
  }
  return fallback;
}

/** ethers v6 may return struct as Result with numeric indices, named fields, or both. */
function parseMarketplaceListingTuple(l) {
  if (l == null) return { active: false, seller: "", price: null };
  const sellerRaw = l.seller !== undefined ? l.seller : l[0];
  const price = l.price !== undefined ? l.price : l[2];
  let active = false;
  if (typeof l.active === "boolean") active = l.active;
  else if (l[3] !== undefined && l[3] !== null) active = Boolean(l[3]);
  return {
    active,
    seller: String(sellerRaw ?? "").toLowerCase(),
    price,
  };
}

/**
 * Token IDs where `wallet` is the active listing seller (NFT held by marketplace contract).
 * Needed because `owned_token_ids` may be empty/stale while the listing is still live on-chain.
 */
async function collectTokenIdsWithActiveListingBySeller(provider, marketAddr, wallet, maxTokenId) {
  const w = (wallet || "").toLowerCase();
  if (!marketAddr || !w || maxTokenId < 1) return new Set();
  const marketContract = new ethers.Contract(marketAddr, MARKETPLACE_ABI, provider);
  const BATCH = Math.max(10, Math.min(Number(process.env.MARKETPLACE_MY_ASSETS_LISTING_SCAN_BATCH || 50), 80));
  const out = new Set();
  for (let start = 1; start <= maxTokenId; start += BATCH) {
    const end = Math.min(maxTokenId, start + BATCH - 1);
    const chunk = await Promise.all(
      Array.from({ length: end - start + 1 }, (_, i) => start + i).map(async (tid) => {
        try {
          const l = await marketContract.listings(tid);
          const { active, seller } = parseMarketplaceListingTuple(l);
          if (active && seller === w) return String(tid);
        } catch (_) {}
        return null;
      })
    );
    chunk.filter(Boolean).forEach((tid) => out.add(tid));
  }
  return out;
}

const NFT_TRANSFER_EVENT_ABI = ["event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"];

/**
 * Find token IDs ever transferred TO `wallet` (helps when `owned_token_ids` in Postgres was never set after mint).
 * Bounded lookback to avoid huge eth_getLogs on public RPCs.
 */
async function discoverTokenIdsFromIncomingTransfers(provider, nftAddress, wallet) {
  const w = (wallet || "").trim();
  if (!w || !w.startsWith("0x")) return [];
  let checksummed = w;
  try {
    checksummed = ethers.getAddress(w);
  } catch (_) {
    return [];
  }
  try {
    const c = new ethers.Contract(nftAddress, NFT_TRANSFER_EVENT_ABI, provider);
    const latest = await provider.getBlockNumber();
    const lookback = Math.max(
      50_000,
      Math.min(Number(process.env.MY_ASSETS_TRANSFER_LOOKBACK_BLOCKS || 6_000_000), 30_000_000)
    );
    const fromBlock = Math.max(0, latest - lookback);
    const filter = c.filters.Transfer(null, checksummed, null);
    const events = await c.queryFilter(filter, fromBlock, latest);
    const ids = new Set();
    for (const e of events) {
      const tid = e.args?.tokenId;
      if (tid == null) continue;
      ids.add(typeof tid === "bigint" ? tid.toString() : String(tid));
    }
    return [...ids];
  } catch (e) {
    console.warn("discoverTokenIdsFromIncomingTransfers:", e?.message || e);
    return [];
  }
}

// Listings: loop 1..totalMinted, call marketplace.listings(tokenId), keep where active. No events.
router.get("/listings", async (_, res) => {
  try {
    const marketAddr = (getMarketplaceAndReservePoolAddress() || "").trim();
    const nftAddr = (process.env.NFT_CONTRACT_ADDRESS || "").trim();
    if (!marketAddr || !nftAddr) return res.json({ listings: [] });

    const provider = getProvider();
    const nftContract = new ethers.Contract(nftAddr, ["function totalMinted() view returns (uint256)", "function tokenURI(uint256 tokenId) view returns (string)"], provider);
    const marketContract = new ethers.Contract(marketAddr, MARKETPLACE_ABI, provider);

    const totalMintedRaw = await readWithRetry(() => nftContract.totalMinted(), null, 2, 7000);
    const totalMinted = totalMintedRaw != null ? Number(totalMintedRaw) : NaN;
    if (!Number.isFinite(totalMinted)) {
      return res.json({
        listings: listingsCache,
        fromCache: true,
        cacheAgeMs: listingsCacheAt ? Date.now() - listingsCacheAt : null,
      });
    }
    if (totalMinted === 0) {
      listingsCache = [];
      listingsCacheAt = Date.now();
      return res.json({ listings: [] });
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
            const { active, seller: sellerLower, price } = parseMarketplaceListingTuple(listing);
            const seller = listing?.seller ?? listing?.[0];
            if (active && sellerLower && price != null) {
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
            priceFormatted: (Number(r.price) / 1e6).toFixed(0) + " USDT",
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
      // Prefer on-chain listingListedAt (no indexer dependency); indexer only for legacy listings pre-contract field.
      l.listedAt = fromChainMs > 0 ? fromChainMs : fromIndexer;
      delete l.listedAtSec;
    });

    /** Queue priority: (0) dynamic mint = seller is marketplace, (1) bot wallets (isBotTrader), (2) members. */
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

    // Resolve seller names (username/name) for "Owned by" display
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
    res.json({ listings });
  } catch (e) {
    if (listingsCacheAt) {
      return res.json({
        listings: listingsCache,
        fromCache: true,
        cacheAgeMs: Date.now() - listingsCacheAt,
      });
    }
    res.status(500).json({ error: e.message });
  }
});

// My listings: loop 1..totalMinted, call marketplace.listings(tokenId), keep where active && seller === wallet. No events.
router.get("/my-listings", async (req, res) => {
  try {
    const wallet = await getWalletForRequest(req);
    if (!wallet || !wallet.startsWith("0x")) return res.json({ listings: [] });

    const marketAddr = (getMarketplaceAndReservePoolAddress() || "").trim();
    const nftAddr = (process.env.NFT_CONTRACT_ADDRESS || "").trim();
    if (!marketAddr || !nftAddr) return res.json({ listings: [] });

    const provider = getProvider();
    const nftContract = new ethers.Contract(nftAddr, ["function totalMinted() view returns (uint256)"], provider);
    const marketContract = new ethers.Contract(marketAddr, MARKETPLACE_ABI, provider);

    let totalMinted = 0;
    try {
      totalMinted = Number(await nftContract.totalMinted());
    } catch (_) {
      return res.json({ listings: [] });
    }
    if (!Number.isFinite(totalMinted) || totalMinted === 0) return res.json({ listings: [] });
    const maxTokens = Math.max(
      1,
      Math.min(Number(process.env.MARKETPLACE_MY_ASSETS_MAX_TOKENS || 1500), totalMinted)
    );

    const listings = [];
    const BATCH = 50;
    for (let start = 1; start <= maxTokens; start += BATCH) {
      const end = Math.min(start + BATCH - 1, totalMinted);
      const promises = [];
      for (let tokenId = start; tokenId <= end; tokenId++) {
        promises.push(
          marketContract.listings(tokenId).then(
            (listing) => {
              const { active, seller, price } = parseMarketplaceListingTuple(listing);
              if (active && seller === wallet && price != null) {
                return { tokenId: String(tokenId), seller: listing?.seller ?? listing?.[0], price: String(price) };
              }
              return null;
            },
            () => null
          )
        );
      }
      const batch = await Promise.all(promises);
      batch.forEach((r) => {
        if (r) listings.push({ tokenId: r.tokenId, seller: String(r.seller), price: r.price, priceFormatted: (Number(r.price) / 1e6).toFixed(0) + " USDT" });
      });
    }
    res.json({ listings });
  } catch (e) {
    console.error("my-listings error:", e?.message || e);
    res.status(500).json({ error: e?.message || "Failed to load your listings" });
  }
});

const NFT_ABI = [
  "event Minted(address indexed to, uint256 tokenId, uint256 amount)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];

const NFT_VIEW_ABI = [
  "function totalMinted() view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
];

// My assets: tokenIds from PostgreSQL owned_token_ids + optional chain discover; on-chain enrich. Survives flaky RPC.
router.get("/my-assets", async (req, res) => {
  try {
    const wallet = await getWalletForRequest(req);
    if (!wallet || !wallet.startsWith("0x")) return res.json({ assets: [] });

    const marketAddr = (getMarketplaceAndReservePoolAddress() || "").trim();
    const nftAddr = (process.env.NFT_CONTRACT_ADDRESS || "").trim();
    if (!marketAddr || !nftAddr) return res.json({ assets: [] });

    const provider = getProvider();
    let ownedTokenIds = await User.getOwnedTokenIds(wallet);
    if (!Array.isArray(ownedTokenIds)) ownedTokenIds = [];

    const nftBalAbi = ["function balanceOf(address owner) view returns (uint256)"];
    const alwaysDiscover = String(process.env.MY_ASSETS_ALWAYS_DISCOVER || "").toLowerCase() === "true";
    const shouldRunTransferDiscover = ownedTokenIds.length === 0 || alwaysDiscover;

    // Self-heal: mint confirm may have failed to write Postgres — discover Transfer→wallet and merge.
    if (shouldRunTransferDiscover) {
      let mightHaveNft = ownedTokenIds.length === 0 || alwaysDiscover;
      if (ownedTokenIds.length === 0) {
        try {
          const bal = await readWithRetry(
            () =>
              new ethers.Contract(nftAddr, nftBalAbi, provider)
                .balanceOf(wallet)
                .then((b) => b),
            0n,
            2,
            8000
          );
          if (bal === 0n) mightHaveNft = false;
        } catch (_) {
          mightHaveNft = true;
        }
      }
      if (mightHaveNft) {
        const discovered = await discoverTokenIdsFromIncomingTransfers(provider, nftAddr, wallet);
        for (const tid of discovered) {
          try {
            await User.addOwnedTokenId(wallet, tid);
          } catch (_) {}
        }
        if (discovered.length > 0) {
          ownedTokenIds = await User.getOwnedTokenIds(wallet);
        }
      }
    }

    const dbTokenSet = new Set((ownedTokenIds || []).map((x) => String(x)));

    const maxScan = Math.max(1, Math.min(Number(process.env.MARKETPLACE_MY_ASSETS_MAX_TOKENS || 1500), 100_000));
    // Use null fallback so RPC failure is not confused with totalMinted() === 0 (which means no scan).
    let scanUpTo = 0;
    try {
      const nftMini = new ethers.Contract(nftAddr, ["function totalMinted() view returns (uint256)"], provider);
      const totalMintedRaw = await readWithRetry(() => nftMini.totalMinted(), null, 2, 8000);
      if (totalMintedRaw != null) {
        const n = Number(totalMintedRaw);
        if (Number.isFinite(n) && n > 0) scanUpTo = Math.min(maxScan, n);
      } else {
        // totalMinted unreadable — still scan listings up to maxScan so listed-in-escrow NFTs can merge.
        scanUpTo = maxScan;
      }
    } catch (_) {
      scanUpTo = maxScan;
    }

    const tokenIdSet = new Set((ownedTokenIds || []).map((x) => String(x)));
    if (scanUpTo > 0) {
      const listedBySeller = await collectTokenIdsWithActiveListingBySeller(provider, marketAddr, wallet, scanUpTo);
      listedBySeller.forEach((id) => tokenIdSet.add(id));
    }

    const tokens = [...tokenIdSet]
      .map((t) => Number(t))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);

    if (tokens.length === 0) return res.json({ assets: [] });

    const nftContract = new ethers.Contract(nftAddr, NFT_VIEW_ABI, provider);
    const marketContract = new ethers.Contract(marketAddr, MARKETPLACE_ABI, provider);

    const BATCH = 25;
    const assets = [];
    const ownerRetries = Math.max(2, Math.min(Number(process.env.MY_ASSETS_OWNER_RETRY || 5), 8));
    const ownerTimeoutMs = Math.max(5000, Math.min(Number(process.env.MY_ASSETS_OWNER_TIMEOUT_MS || 12000), 45000));

    for (let start = 0; start < tokens.length; start += BATCH) {
      const slice = tokens.slice(start, start + BATCH);
      const promises = slice.map((tokenId) =>
        Promise.all([
          readWithRetry(
            () =>
              nftContract
                .ownerOf(tokenId)
                .then((o) => String(o || "").toLowerCase())
                .catch(() => ""),
            "",
            ownerRetries,
            ownerTimeoutMs
          ),
          readWithRetry(
            () =>
              marketContract
                .listings(tokenId)
                .then((l) => parseMarketplaceListingTuple(l)),
            { active: false, seller: "", price: null },
            3,
            ownerTimeoutMs
          ),
          readWithRetry(
            () => marketContract.saleCount(tokenId).then((c) => (c != null ? Number(c) : null)),
            null,
            2,
            ownerTimeoutMs
          ),
          readWithRetry(() => nftContract.tokenURI(tokenId), "", 2, ownerTimeoutMs),
        ]).then(([owner, listing, saleCount, tokenURI]) => {
          const ownerLower = (owner || "").toLowerCase();
          const inWallet = Boolean(ownerLower && ownerLower === wallet);
          const isListedByMe = Boolean(listing.active && listing.seller === wallet);
          // Show only if wallet holds NFT OR has an active listing as seller (escrow: owner = marketplace).
          // Do not trust Postgres alone: stale owned_token_ids after a sale used to ghost-list $30 here.
          if (!inWallet && !isListedByMe) {
            if (dbTokenSet.has(String(tokenId))) {
              User.removeOwnedTokenId(wallet, tokenId).catch(() => {});
            }
            return null;
          }
          const uri = ensureMetadataUri(tokenURI, tokenId);
          const listPriceUsdt = MARKETPLACE_LIST_PRICE_USDT;
          const listPriceWei = MARKETPLACE_LIST_PRICE_WEI;
          return {
            tokenId: String(tokenId),
            saleCount: saleCount == null ? undefined : saleCount,
            listPriceUsdt,
            listPriceWei,
            isListed: isListedByMe,
            price: listing.price != null ? String(listing.price) : listPriceWei,
            tokenURI: uri,
          };
        })
      );
      const batch = await Promise.all(promises);
      batch.forEach((a) => {
        if (a) assets.push(a);
      });
    }

    res.json({ assets });
  } catch (e) {
    console.error("my-assets error:", e?.message || e);
    res.status(500).json({ error: e?.message || "Failed to load your assets" });
  }
});

// Keep my-nfts for backward compat: same as my-assets (frontend can use my-assets only)
router.get("/my-nfts", async (req, res) => {
  try {
    const wallet = await getWalletForRequest(req);
    if (!wallet || !wallet.startsWith("0x")) return res.json({ nfts: [] });
    const marketAddr = (getMarketplaceAndReservePoolAddress() || "").trim();
    const nftAddr = (process.env.NFT_CONTRACT_ADDRESS || "").trim();
    if (!marketAddr || !nftAddr) return res.json({ nfts: [] });
    const provider = getProvider();
    const nftContract = new ethers.Contract(nftAddr, NFT_VIEW_ABI, provider);
    const marketContract = new ethers.Contract(marketAddr, MARKETPLACE_ABI, provider);
    let totalMinted = 0;
    try { totalMinted = Number(await nftContract.totalMinted()); } catch (_) { return res.json({ nfts: [] }); }
    if (!Number.isFinite(totalMinted) || totalMinted === 0) return res.json({ nfts: [] });
    const maxTokens = Math.max(
      1,
      Math.min(Number(process.env.MARKETPLACE_MY_ASSETS_MAX_TOKENS || 1500), totalMinted)
    );
    const timeBudgetMs = Math.max(5000, Number(process.env.MARKETPLACE_MY_ASSETS_MAX_MS || 15000));
    const startedAt = Date.now();
    const nfts = [];
    const BATCH = Math.max(10, Math.min(Number(process.env.MARKETPLACE_MY_ASSETS_BATCH || 25), 60));
    for (let start = 1; start <= maxTokens; start += BATCH) {
      if (Date.now() - startedAt > timeBudgetMs) break;
      const end = Math.min(start + BATCH - 1, maxTokens);
      const promises = [];
      for (let tokenId = start; tokenId <= end; tokenId++) {
        promises.push(
          Promise.all([
            readWithRetry(
              () => nftContract.ownerOf(tokenId).then((o) => String(o || "").toLowerCase()),
              null
            ),
            readWithRetry(
              () => marketContract.listings(tokenId).then((l) => parseMarketplaceListingTuple(l)),
              { active: false, seller: "", price: null }
            ),
            readWithRetry(
              () => marketContract.saleCount(tokenId).then((c) => (c != null ? Number(c) : null)),
              null
            ),
            readWithRetry(() => nftContract.tokenURI(tokenId), ""),
          ]).then(([owner, listing, saleCount, tokenURI]) => {
            const inWallet = owner === wallet;
            const isListedByMe = listing.active && listing.seller === wallet;
            if (!inWallet && !isListedByMe) return null;
            const uri = ensureMetadataUri(tokenURI, tokenId);
            const listPriceUsdt = MARKETPLACE_LIST_PRICE_USDT;
            const listPriceWei = MARKETPLACE_LIST_PRICE_WEI;
            return {
              tokenId: String(tokenId),
              saleCount: saleCount == null ? undefined : saleCount,
              listPriceUsdt,
              listPriceWei,
              tokenURI: uri || "",
            };
          })
        );
      }
      const batch = await Promise.all(promises);
      batch.forEach((a) => { if (a) nfts.push(a); });
    }
    res.json({ nfts });
  } catch (e) {
    res.status(500).json({ error: e?.message || "Failed to load your NFTs" });
  }
});

// Record purchase in PostgreSQL (buyer + tokenId). Call after successful buy.
router.post("/record-purchase", async (req, res) => {
  try {
    const body = req.body || {};
    let wallet = await getWalletForRequest(req);
    if (!wallet && isBotActivityAuthorized(req)) {
      const explicitBuyer = (body.buyer || body.wallet || "").toString().trim().toLowerCase();
      if (explicitBuyer.startsWith("0x") && explicitBuyer.length === 42) {
        wallet = explicitBuyer;
      }
    }
    if (!wallet || !wallet.startsWith("0x")) return res.status(400).json({ error: "Wallet required" });
    const { tokenId, seller, price, txHash, eventId, blockNumber } = body;
    if (!tokenId) return res.status(400).json({ error: "tokenId required" });
    await User.recordPurchase(wallet, seller || null, tokenId, price, {
      txHash: txHash || null,
      eventId: eventId || null,
      blockNumber: blockNumber ?? null,
    });
    res.json({ ok: true });
  } catch (e) {
    console.error("record-purchase error:", e?.message || e);
    res.status(500).json({ error: e?.message || "Failed to record purchase" });
  }
});

router.get("/config", (_, res) => {
  const multi = (process.env.NFT_METADATA_BASE_URIS || "").trim().split(",").map((s) => s.trim()).filter(Boolean);
  const base = multi.length > 0 ? multi[0] : (process.env.NFT_METADATA_BASE_URI || "").trim().replace(/^ipfs:\/\//, "");
  const mp4Cid = (process.env.NFT_MP4_CID || "").trim();
  const localAnim = (process.env.NFT_LOCAL_ANIMATION_URL || "").trim();
  res.json({
    marketplaceAddress: getMarketplaceAndReservePoolAddress() || "",
    nftAddress: process.env.NFT_CONTRACT_ADDRESS || "",
    metadataBasePath: base || undefined,
    nftMp4Cid: mp4Cid || undefined,
    nftLocalAnimationUrl: localAnim || undefined,
  });
});

// Dynamic metadata for tokens 1–10000: local MP4 (NFT_LOCAL_ANIMATION_URL) or IPFS (NFT_MP4_CID). No auth.
router.get("/nft-metadata/:tokenId", (req, res) => {
  const tokenId = parseInt(req.params.tokenId, 10);
  if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > 10000) {
    return res.status(404).json({ error: "Invalid tokenId (1–10000)" });
  }
  const localAnim = (process.env.NFT_LOCAL_ANIMATION_URL || "").trim();
  if (localAnim) {
    return res.json({
      name: `GLFA #${tokenId}`,
      description: `Golden Labs Finance Asset #${tokenId}`,
      image: localAnim,
      animation_url: localAnim,
    });
  }
  const mp4Cid = (process.env.NFT_MP4_CID || "").trim();
  if (!mp4Cid) {
    return res.status(404).json({
      error: "Set NFT_LOCAL_ANIMATION_URL (e.g. https://api.example.com/uploads/nft-asset.mp4) or NFT_MP4_CID in backend .env",
    });
  }
  const ipfsUrl = `ipfs://${mp4Cid}`;
  res.json({
    name: `GLFA #${tokenId}`,
    description: `Golden Labs Finance Asset #${tokenId}`,
    image: ipfsUrl,
    animation_url: ipfsUrl,
  });
});

// Proxy IPFS requests to avoid CORS; public (no auth). Exported so index.js can mount it without auth.
const PINATA_GATEWAY = process.env.IPFS_GATEWAY || "https://green-cautious-whippet-586.mypinata.cloud/ipfs";
const IPFS_GATEWAY_KEY = (process.env.IPFS_GATEWAY_KEY || "").trim();
const PUBLIC_GATEWAY = "https://ipfs.io/ipfs";

export async function ipfsProxyHandler(req, res) {
  try {
    let uri = (req.query.uri || "").trim();
    if (!uri || !uri.startsWith("ipfs://")) {
      return res.status(400).json({ error: "Missing or invalid uri (e.g. uri=ipfs://CID/path)" });
    }
    uri = uri.replace(/^(ipfs:\/\/)+/i, "ipfs://");
    const path = uri.replace(/^ipfs:\/\//, "").replace(/^\/+/, "");
    const tryFetch = async (gatewayBase, headers = {}) => {
      const url = `${gatewayBase.replace(/\/+$/, "")}/${path}`;
      const r = await fetch(url, { headers });
      return { ok: r.ok, status: r.status, statusText: r.statusText, contentType: r.headers.get("content-type"), body: r };
    };
    // Prefer Pinata with key if set
    if (IPFS_GATEWAY_KEY.length > 0) {
      const pinataBase = PINATA_GATEWAY.replace(/\/+$/, "");
      const out = await tryFetch(pinataBase, { "x-pinata-gateway-token": IPFS_GATEWAY_KEY });
      if (out.ok) {
        res.setHeader("content-type", out.contentType || "application/octet-stream");
        return res.send(Buffer.from(await out.body.arrayBuffer()));
      }
      // 401/404 from Pinata: fallback to public gateway so public IPFS content can load
      if (out.status === 401 || out.status === 404) {
        const pub = await tryFetch(PUBLIC_GATEWAY);
        if (pub.ok) {
          res.setHeader("content-type", pub.contentType || "application/octet-stream");
          return res.send(Buffer.from(await pub.body.arrayBuffer()));
        }
      }
      return res.status(out.status).send(out.statusText);
    }
    const out = await tryFetch(PUBLIC_GATEWAY);
    res.setHeader("content-type", out.contentType || "application/octet-stream");
    if (!out.ok) return res.status(out.status).send(out.statusText);
    res.send(Buffer.from(await out.body.arrayBuffer()));
  } catch (e) {
    res.status(502).json({ error: e?.message || "Proxy failed" });
  }
}

router.get("/ipfs-proxy", ipfsProxyHandler);

export default router;
