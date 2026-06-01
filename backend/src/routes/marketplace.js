import { Router } from "express";
import { ethers } from "ethers";
import * as User from "../services/user.js";
import {
  getMarketplaceListingsResponse,
  removeListingFromCache,
} from "../services/marketplaceListingsCache.js";
import { getSharedMainRpcProvider } from "../config/ethersRpc.js";
import {
  getMarketplaceAndReservePoolAddress,
  getMarketplaceMyAssetsMaxTokensCeiling,
  getNftMaxSupplyCap,
} from "../config/contractsEnv.js";
import { assertCanTradeOnConfiguredContracts } from "../services/marketplaceTradeEligibility.js";
import { USDT_DECIMALS } from "../constants/usdtDecimals.js";

const router = Router();

function formatListPriceUsdtFromWei(weiStr) {
  try {
    let s = String(ethers.formatUnits(String(weiStr ?? "0").trim(), USDT_DECIMALS));
    if (s.includes(".")) s = s.replace(/\.?0+$/, "");
    return s || "0";
  } catch {
    return "0";
  }
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

let cachedMarketplaceListPrice = null;
let cachedMarketplaceListPriceAt = 0;
const LIST_PRICE_CACHE_MS = 2000;

async function getConfiguredMarketplaceListPrice(marketContract) {
  const now = Date.now();
  if (cachedMarketplaceListPrice && now - cachedMarketplaceListPriceAt < LIST_PRICE_CACHE_MS) {
    return cachedMarketplaceListPrice;
  }
  const wei = await marketContract.listPrice();
  if (wei == null) throw new Error("marketplace listPrice returned null");
  const weiStr = String(wei);
  if (weiStr === "0") throw new Error("marketplace listPrice is zero");
  cachedMarketplaceListPrice = {
    listPriceWei: weiStr,
    listPriceUsdt: formatListPriceUsdtFromWei(weiStr),
  };
  cachedMarketplaceListPriceAt = now;
  return cachedMarketplaceListPrice;
}

const getProvider = () => getSharedMainRpcProvider();

const MARKETPLACE_ABI = [
  "event Listed(uint256 indexed tokenId, address seller, uint256 price)",
  "event Sold(uint256 indexed tokenId, address seller, address buyer, uint256 price)",
  "event ListingCancelled(uint256 indexed tokenId)",
  "function listPrice() view returns (uint256)",
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

const NFT_DISCOVERY_ABI = [
  "event Minted(address indexed to, uint256 tokenId, uint256 amount)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];

function getTransferLookbackBlocks() {
  return Math.max(
    50_000,
    Math.min(Number(process.env.MY_ASSETS_TRANSFER_LOOKBACK_BLOCKS || 6_000_000), 30_000_000)
  );
}

function getLogChunkBlocks() {
  return Math.max(25_000, Math.min(Number(process.env.MY_ASSETS_TRANSFER_LOG_CHUNK_BLOCKS || 400_000), 2_000_000));
}

/** Chunked eth_getLogs — avoids rate limits / truncated responses on free BSC RPC. */
async function queryFilterChunked(contract, filter, fromBlock, latest, chunkBlocks) {
  const ids = new Set();
  const chunk = Math.max(10_000, chunkBlocks);
  for (let from = fromBlock; from <= latest; from += chunk) {
    const to = Math.min(from + chunk - 1, latest);
    try {
      const events = await contract.queryFilter(filter, from, to);
      for (const e of events) {
        const tid = e.args?.tokenId ?? e.args?.[1];
        if (tid == null) continue;
        ids.add(typeof tid === "bigint" ? tid.toString() : String(tid));
      }
    } catch (e) {
      console.warn(`my-assets getLogs [${from}-${to}]:`, e?.message || e);
    }
    await new Promise((r) => setTimeout(r, Math.max(0, Number(process.env.MY_ASSETS_LOG_CHUNK_DELAY_MS || 60))));
  }
  return ids;
}

/**
 * Token IDs minted or transferred TO `wallet` (Postgres + buy paths sometimes miss one id).
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
    const c = new ethers.Contract(nftAddress, NFT_DISCOVERY_ABI, provider);
    const latest = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latest - getTransferLookbackBlocks());
    const chunkBlocks = getLogChunkBlocks();
    const transferIds = await queryFilterChunked(
      c,
      c.filters.Transfer(null, checksummed, null),
      fromBlock,
      latest,
      chunkBlocks
    );
    const mintedIds = await queryFilterChunked(
      c,
      c.filters.Minted(checksummed, null),
      fromBlock,
      latest,
      chunkBlocks
    );
    return [...new Set([...transferIds, ...mintedIds])];
  } catch (e) {
    console.warn("discoverTokenIdsFromIncomingTransfers:", e?.message || e);
    return [];
  }
}

// Listings: cached on-chain scan (TTL + stale on marketplace events). See marketplaceListingsCache.js.
router.get("/listings", async (req, res) => {
  try {
    const forceRefresh =
      req.query.refresh === "1" ||
      String(req.query.refresh || "").toLowerCase() === "true";
    const result = await getMarketplaceListingsResponse({ forceRefresh });
    const body = { listings: result.listings };
    if (result.fromCache) {
      body.fromCache = true;
      body.cacheAgeMs = result.cacheAgeMs ?? null;
    }
    if (result.rpcScanFailed) body.rpcScanFailed = true;
    if (result.configMissing) body.configMissing = true;
    if (result.warming) body.warming = true;
    res.json(body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// My listings: loop 1..totalMinted, call marketplace.listings(tokenId), keep where active && seller === wallet. No events.
router.get("/my-listings", async (req, res) => {
  try {
    const wallet = await getWalletForRequest(req);
    if (!wallet || !wallet.startsWith("0x")) return res.json({ listings: [] });

    const trade = await assertCanTradeOnConfiguredContracts(wallet);
    if (!trade.ok) {
      return res.status(trade.status).json({ error: trade.error, listings: [] });
    }

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
      Math.min(getMarketplaceMyAssetsMaxTokensCeiling(), totalMinted)
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
              const active = listing?.[3];
              const seller = String(listing?.[0] ?? "").toLowerCase();
              const price = listing?.[2];
              if (active && seller === wallet && price != null) {
                return { tokenId: String(tokenId), seller: listing[0], price: String(price) };
              }
              return null;
            },
            () => null
          )
        );
      }
      const batch = await Promise.all(promises);
      batch.forEach((r) => {
        if (r) listings.push({ tokenId: r.tokenId, seller: String(r.seller), price: r.price, priceFormatted: formatListingPriceUsdtLabel(r.price) });
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

/**
 * Scan 1..maxMinted: token IDs where wallet holds NFT or has an active listing as seller.
 * Matches /my-nfts logic so dashboard works even when Postgres owned_token_ids is empty or stale.
 */
async function collectChainOwnedOrListedTokenIds(wallet, provider, nftAddr, marketAddr, totalMinted) {
  const maxTokens = Math.max(
    1,
    Math.min(getMarketplaceMyAssetsMaxTokensCeiling(), totalMinted)
  );
  const timeBudgetMs = Math.max(5000, Number(process.env.MARKETPLACE_MY_ASSETS_MAX_MS || 60000));
  const startedAt = Date.now();
  const BATCH = Math.max(10, Math.min(Number(process.env.MARKETPLACE_MY_ASSETS_BATCH || 25), 60));
  const nftContract = new ethers.Contract(nftAddr, NFT_VIEW_ABI, provider);
  const marketContract = new ethers.Contract(marketAddr, MARKETPLACE_ABI, provider);
  const found = new Set();
  for (let start = 1; start <= maxTokens; start += BATCH) {
    if (Date.now() - startedAt > timeBudgetMs) break;
    const end = Math.min(start + BATCH - 1, maxTokens);
    const promises = [];
    for (let tokenId = start; tokenId <= end; tokenId++) {
      promises.push(
        Promise.all([
          readWithRetry(() => nftContract.ownerOf(tokenId).then((o) => String(o || "").toLowerCase()), null, 2, 8000),
          readWithRetry(
            () =>
              marketContract
                .listings(tokenId)
                .then((l) => ({ active: !!l?.[3], seller: String(l?.[0] ?? "").toLowerCase() })),
            { active: false, seller: "" },
            2,
            8000
          ),
        ]).then(([owner, listing]) => {
          if (owner == null) return;
          const inWallet = owner === wallet;
          const isListedByMe = listing.active && listing.seller === wallet;
          if (inWallet || isListedByMe) found.add(String(tokenId));
        })
      );
    }
    await Promise.all(promises);
  }
  return found;
}

const NFT_BALANCE_ABI = ["function balanceOf(address owner) view returns (uint256)"];

async function readWalletNftBalance(provider, nftAddr, wallet) {
  try {
    const bal = await readWithRetry(
      () => new ethers.Contract(nftAddr, NFT_BALANCE_ABI, provider).balanceOf(wallet),
      null,
      2,
      8000
    );
    if (bal == null) return null;
    return Number(bal);
  } catch {
    return null;
  }
}

/**
 * Enrich one tokenId for /my-assets. Returns null if sold; keeps row on RPC failure (do not purge DB).
 */
async function enrichWalletTokenAsset({
  wallet,
  tokenId,
  nftContract,
  marketContract,
  listPriceWei,
  listPriceUsdt,
  ownerRetries,
  ownerTimeoutMs,
}) {
  const [owner, listing, saleCount, tokenURI] = await Promise.all([
    readWithRetry(
      () =>
        nftContract
          .ownerOf(tokenId)
          .then((o) => String(o || "").toLowerCase())
          .catch(() => null),
      null,
      ownerRetries,
      ownerTimeoutMs
    ),
    readWithRetry(
      () =>
        marketContract
          .listings(tokenId)
          .then((l) => ({
            active: !!l?.[3],
            seller: String(l?.[0] ?? "").toLowerCase(),
            price: l?.[2],
          })),
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
  ]);

  const ownerLower = owner == null ? "" : String(owner).toLowerCase();
  const inWallet = ownerLower && ownerLower === wallet;
  const isListedByMe = listing.active && listing.seller === wallet;

  if (!inWallet && !isListedByMe) {
    if (owner == null) {
      const uri = ensureMetadataUri(tokenURI, tokenId);
      return {
        tokenId: String(tokenId),
        saleCount: saleCount == null ? undefined : saleCount,
        listPriceUsdt,
        listPriceWei,
        isListed: false,
        price: listPriceWei,
        tokenURI: uri,
        ownerUnverified: true,
      };
    }
    if (ownerLower) User.removeOwnedTokenId(wallet, tokenId).catch(() => {});
    return null;
  }
  if (!inWallet && isListedByMe && owner == null) {
    return {
      tokenId: String(tokenId),
      saleCount: saleCount == null ? undefined : saleCount,
      listPriceUsdt,
      listPriceWei,
      isListed: true,
      price: listing.price != null ? String(listing.price) : listPriceWei,
      tokenURI: ensureMetadataUri(tokenURI, tokenId),
    };
  }

  const uri = ensureMetadataUri(tokenURI, tokenId);
  return {
    tokenId: String(tokenId),
    saleCount: saleCount == null ? undefined : saleCount,
    listPriceUsdt,
    listPriceWei,
    isListed: isListedByMe,
    price: listing.price != null ? String(listing.price) : listPriceWei,
    tokenURI: uri,
  };
}

// My assets: Postgres + Transfer logs + optional chain scan; enrich per token (RPC-safe).
router.get("/my-assets", async (req, res) => {
  try {
    const wallet = await getWalletForRequest(req);
    if (!wallet || !wallet.startsWith("0x")) return res.json({ assets: [], complete: true });

    const marketAddr = (getMarketplaceAndReservePoolAddress() || "").trim();
    const nftAddr = (process.env.NFT_CONTRACT_ADDRESS || "").trim();
    if (!marketAddr || !nftAddr) return res.json({ assets: [], complete: true });

    const provider = getProvider();
    let ownedTokenIds = await User.getOwnedTokenIds(wallet);
    if (!Array.isArray(ownedTokenIds)) ownedTokenIds = [];

    const walletNftBalance = await readWalletNftBalance(provider, nftAddr, wallet);
    const alwaysDiscover = String(process.env.MY_ASSETS_ALWAYS_DISCOVER || "true").toLowerCase() !== "false";
    const needsTransferDiscover =
      alwaysDiscover ||
      ownedTokenIds.length === 0 ||
      (walletNftBalance != null && ownedTokenIds.length < walletNftBalance);

    if (needsTransferDiscover && (walletNftBalance == null || walletNftBalance > 0)) {
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

    const tokenIdSet = new Set((ownedTokenIds || []).map((t) => String(t)));
    const fullChainScan = String(process.env.MY_ASSETS_FULL_CHAIN_SCAN || "").toLowerCase() === "true";
    const needChainScan =
      fullChainScan || (walletNftBalance != null && tokenIdSet.size < walletNftBalance);

    let totalMinted = 0;
    if (needChainScan) {
      try {
        const nftMini = new ethers.Contract(nftAddr, ["function totalMinted() view returns (uint256)"], provider);
        totalMinted = Number(await readWithRetry(() => nftMini.totalMinted(), 0, 2, 8000));
      } catch (_) {}
    }

    if (needChainScan && Number.isFinite(totalMinted) && totalMinted > 0) {
      try {
        const chainIdSet = await collectChainOwnedOrListedTokenIds(
          wallet,
          provider,
          nftAddr,
          marketAddr,
          totalMinted
        );
        for (const tid of chainIdSet) {
          tokenIdSet.add(String(tid));
          try {
            await User.addOwnedTokenId(wallet, tid);
          } catch (_) {}
        }
      } catch (e) {
        console.warn("my-assets chain scan:", e?.message || e);
      }
    }

    const tokens = [...tokenIdSet]
      .map((t) => Number(t))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);

    if (tokens.length === 0) {
      return res.json({
        assets: [],
        complete: walletNftBalance == null || walletNftBalance === 0,
        walletNftBalance: walletNftBalance ?? undefined,
      });
    }

    const nftContract = new ethers.Contract(nftAddr, NFT_VIEW_ABI, provider);
    const marketContract = new ethers.Contract(marketAddr, MARKETPLACE_ABI, provider);
    const { listPriceWei, listPriceUsdt } = await getConfiguredMarketplaceListPrice(marketContract);

    const assets = [];
    const ownerRetries = Math.max(2, Math.min(Number(process.env.MY_ASSETS_OWNER_RETRY || 5), 8));
    const ownerTimeoutMs = Math.max(5000, Math.min(Number(process.env.MY_ASSETS_OWNER_TIMEOUT_MS || 12000), 45000));
    const enrichConcurrency = Math.max(
      1,
      Math.min(Number(process.env.MY_ASSETS_ENRICH_CONCURRENCY || 1), 8)
    );
    const enrichGapMs = Math.max(0, Number(process.env.MY_ASSETS_ENRICH_GAP_MS || 40));

    const enrichOne = (tokenId, retries, timeoutMs) =>
      enrichWalletTokenAsset({
        wallet,
        tokenId,
        nftContract,
        marketContract,
        listPriceWei,
        listPriceUsdt,
        ownerRetries: retries,
        ownerTimeoutMs: timeoutMs,
      });

    const useSequential =
      String(process.env.MY_ASSETS_ENRICH_SEQUENTIAL || "").toLowerCase() === "true" ||
      tokens.length <= Math.max(4, Number(process.env.MY_ASSETS_SEQUENTIAL_MAX_TOKENS || 12));

    if (useSequential) {
      for (const tokenId of tokens) {
        const a = await enrichOne(tokenId, ownerRetries, ownerTimeoutMs);
        if (a) assets.push(a);
        if (enrichGapMs > 0) await new Promise((r) => setTimeout(r, enrichGapMs));
      }
    } else {
      for (let start = 0; start < tokens.length; start += enrichConcurrency) {
        const slice = tokens.slice(start, start + enrichConcurrency);
        const batch = await Promise.all(slice.map((tokenId) => enrichOne(tokenId, ownerRetries, ownerTimeoutMs)));
        batch.forEach((a) => {
          if (a) assets.push(a);
        });
        if (enrichGapMs > 0 && start + enrichConcurrency < tokens.length) {
          await new Promise((r) => setTimeout(r, enrichGapMs));
        }
      }
    }

    const missingRetry = Math.max(ownerRetries, Math.min(Number(process.env.MY_ASSETS_MISSING_OWNER_RETRY || 8), 12));
    const missingTimeout = Math.max(ownerTimeoutMs, Number(process.env.MY_ASSETS_MISSING_OWNER_TIMEOUT_MS || 20000));
    let assetIds = new Set(assets.map((a) => String(a.tokenId)));
    for (const tokenId of tokens) {
      if (assetIds.has(String(tokenId))) continue;
      const a = await enrichOne(tokenId, missingRetry, missingTimeout);
      if (a) {
        assets.push(a);
        assetIds.add(String(tokenId));
      }
      await new Promise((r) => setTimeout(r, enrichGapMs));
    }

    if (walletNftBalance != null && assetIds.size < walletNftBalance) {
      if (!Number.isFinite(totalMinted) || totalMinted <= 0) {
        try {
          const nftMini = new ethers.Contract(nftAddr, ["function totalMinted() view returns (uint256)"], provider);
          totalMinted = Number(await readWithRetry(() => nftMini.totalMinted(), 0, 2, 8000));
        } catch (_) {}
      }
    }
    if (walletNftBalance != null && assetIds.size < walletNftBalance && Number.isFinite(totalMinted) && totalMinted > 0) {
      try {
        const chainIdSet = await collectChainOwnedOrListedTokenIds(
          wallet,
          provider,
          nftAddr,
          marketAddr,
          totalMinted
        );
        for (const tid of chainIdSet) {
          const n = Number(tid);
          if (!Number.isFinite(n) || n <= 0 || assetIds.has(String(tid))) continue;
          tokenIdSet.add(String(tid));
          try {
            await User.addOwnedTokenId(wallet, tid);
          } catch (_) {}
          const a = await enrichOne(n, missingRetry, missingTimeout);
          if (a) {
            assets.push(a);
            assetIds.add(String(tid));
          }
          if (assetIds.size >= walletNftBalance) break;
          await new Promise((r) => setTimeout(r, enrichGapMs));
        }
      } catch (e) {
        console.warn("my-assets gap-fill chain scan:", e?.message || e);
      }
    }

    assets.sort((a, b) => Number(a.tokenId) - Number(b.tokenId));

    const complete =
      walletNftBalance == null
        ? assetIds.size >= tokens.length
        : assetIds.size >= walletNftBalance;

    res.json({
      assets,
      complete,
      walletNftBalance: walletNftBalance ?? undefined,
      tokenIdsChecked: tokens.length,
      tokenIdsFound: assetIds.size,
    });
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
    const { listPriceWei, listPriceUsdt } = await getConfiguredMarketplaceListPrice(marketContract);
    let totalMinted = 0;
    try { totalMinted = Number(await nftContract.totalMinted()); } catch (_) { return res.json({ nfts: [] }); }
    if (!Number.isFinite(totalMinted) || totalMinted === 0) return res.json({ nfts: [] });
    const maxTokens = Math.max(
      1,
      Math.min(getMarketplaceMyAssetsMaxTokensCeiling(), totalMinted)
    );
    const timeBudgetMs = Math.max(5000, Number(process.env.MARKETPLACE_MY_ASSETS_MAX_MS || 60000));
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
              () => marketContract.listings(tokenId).then((l) => ({ active: !!l?.[3], seller: String(l?.[0] ?? "").toLowerCase(), price: l?.[2] })),
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

// Browser GET shows this is a POST endpoint (otherwise GET returns 404 and looks "broken").
router.get("/record-purchase", (_req, res) => {
  res.json({
    ok: true,
    endpoint: "record-purchase",
    method: "POST",
    contentType: "application/json",
    body: { tokenId: "required", seller: "optional", price: "optional", txHash: "optional", buyer: "optional (bots)" },
    auth: "User session / Bearer token, or x-bot-control-key for bot callers",
  });
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
    removeListingFromCache(String(tokenId));
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
  const sub = (process.env.SUBSCRIPTION_CONTRACT_ADDRESS || "").trim();
  res.json({
    marketplaceAddress: getMarketplaceAndReservePoolAddress() || "",
    nftAddress: process.env.NFT_CONTRACT_ADDRESS || "",
    subscriptionContractAddress: sub,
    metadataBasePath: base || undefined,
    nftMp4Cid: mp4Cid || undefined,
    nftLocalAnimationUrl: localAnim || undefined,
  });
});

// Dynamic metadata for tokens 1..NFT_MAX_SUPPLY: local MP4 (NFT_LOCAL_ANIMATION_URL) or IPFS (NFT_MP4_CID). No auth.
router.get("/nft-metadata/:tokenId", (req, res) => {
  const tokenId = parseInt(req.params.tokenId, 10);
  const maxId = getNftMaxSupplyCap();
  if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > maxId) {
    return res.status(404).json({ error: `Invalid tokenId (must be 1–${maxId})` });
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
