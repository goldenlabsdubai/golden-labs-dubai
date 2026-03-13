import { Router } from "express";
import { ethers } from "ethers";
import * as User from "../services/userFirestore.js";

const router = Router();
let listingsCache = [];
let listingsCacheAt = 0;

const getProvider = () => {
  const rpc = process.env.RPC_URL || "http://127.0.0.1:8545";
  return new ethers.JsonRpcProvider(rpc);
};

const MARKETPLACE_ABI = [
  "event Listed(uint256 indexed tokenId, address seller, uint256 price)",
  "event Sold(uint256 indexed tokenId, address seller, address buyer, uint256 price)",
  "event ListingCancelled(uint256 indexed tokenId)",
  "function listings(uint256) view returns (address, uint256, uint256, bool)",
  "function saleCount(uint256) view returns (uint256)",
];

// Resolve wallet from JWT (req.wallet) or from Firestore user
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

/** When NFT_MP4_CID is set, metadata is served from backend (one .mp4 for 10k supply). Otherwise use IPFS base. */
function ensureMetadataUri(uri, tokenId) {
  const mp4Cid = (process.env.NFT_MP4_CID || "").trim();
  if (mp4Cid) {
    const base = (process.env.BACKEND_URL || "").trim().replace(/\/$/, "");
    if (base) return `${base}/api/marketplace/nft-metadata/${tokenId}`;
  }
  uri = (uri && String(uri).trim()) || "";
  uri = uri.replace(/^(ipfs:\/\/)+/i, "ipfs://");
  if (!uri) {
    const base = (process.env.NFT_METADATA_BASE_URI || "").trim().replace(/^ipfs:\/\//, "");
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

// Listings: loop 1..totalMinted, call marketplace.listings(tokenId), keep where active. No events.
router.get("/listings", async (_, res) => {
  try {
    const marketAddr = (process.env.MARKETPLACE_CONTRACT_ADDRESS || "").trim();
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
          ]).then(([listing, tokenURI]) => {
            if (!listing) return null;
            const active = listing?.[3];
            const seller = listing?.[0];
            const price = listing?.[2];
            if (active && seller && price != null) {
              let uri = (tokenURI && String(tokenURI).trim()) || "";
              if (!uri) {
                const base = (process.env.NFT_METADATA_BASE_URI || "").trim().replace(/^ipfs:\/\//, "");
                if (base) uri = `ipfs://${base}/${tokenId}.json`;
              }
              uri = (uri || "").replace(/^(ipfs:\/\/)+/i, "ipfs://");
              return { tokenId: String(tokenId), seller, price: String(price), tokenURI: uri };
            }
            return null;
          }, () => null)
        );
      }
      const batch = await Promise.all(promises);
      batch.forEach((r) => {
        if (r) listings.push({ tokenId: r.tokenId, seller: String(r.seller), price: r.price, priceFormatted: (Number(r.price) / 1e6).toFixed(0) + " USDT", tokenURI: r.tokenURI || "" });
      });
    }
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

    const marketAddr = (process.env.MARKETPLACE_CONTRACT_ADDRESS || "").trim();
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

// My assets: tokenIds you "own" = tracked in Firestore ownedTokenIds, enriched from on-chain listing/metadata.
router.get("/my-assets", async (req, res) => {
  try {
    const wallet = await getWalletForRequest(req);
    if (!wallet || !wallet.startsWith("0x")) return res.json({ assets: [] });

    const marketAddr = (process.env.MARKETPLACE_CONTRACT_ADDRESS || "").trim();
    const nftAddr = (process.env.NFT_CONTRACT_ADDRESS || "").trim();
    if (!marketAddr || !nftAddr) return res.json({ assets: [] });

    // Read owned token ids from Firestore (single doc read, no 1..totalMinted scan)
    const ownedTokenIds = await User.getOwnedTokenIds(wallet);
    if (!Array.isArray(ownedTokenIds) || ownedTokenIds.length === 0) {
      return res.json({ assets: [] });
    }

    const provider = getProvider();
    const nftContract = new ethers.Contract(nftAddr, NFT_VIEW_ABI, provider);
    const marketContract = new ethers.Contract(marketAddr, MARKETPLACE_ABI, provider);

    const tokens = ownedTokenIds
      .map((t) => Number(t))
      .filter((n) => Number.isFinite(n) && n > 0);

    if (tokens.length === 0) return res.json({ assets: [] });

    const BATCH = 25;
    const assets = [];
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
            null
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
          const inferredFromListing =
            listing.price != null ? Number(listing.price) <= 20 * 10 ** 6 : false;
          const isFirstSale = saleCount == null ? inferredFromListing : Number(saleCount) === 0;
          const listPriceUsdt = isFirstSale ? 20 : 40;
          const listPriceWei = isFirstSale ? "20000000" : "40000000";
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
    const marketAddr = (process.env.MARKETPLACE_CONTRACT_ADDRESS || "").trim();
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
            const inferredFromListing = listing.price != null ? Number(listing.price) <= 20 * 10 ** 6 : false;
            const isFirstSale = saleCount == null ? inferredFromListing : Number(saleCount) === 0;
            const listPriceUsdt = isFirstSale ? 20 : 40;
            const listPriceWei = isFirstSale ? "20000000" : "40000000";
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

// Record purchase in Firestore (buyer + tokenId) so we know which wallet owns which asset. Call after successful buy.
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
  const base = (process.env.NFT_METADATA_BASE_URI || "").trim().replace(/^ipfs:\/\//, "");
  const mp4Cid = (process.env.NFT_MP4_CID || "").trim();
  res.json({
    marketplaceAddress: process.env.MARKETPLACE_CONTRACT_ADDRESS || "",
    nftAddress: process.env.NFT_CONTRACT_ADDRESS || "",
    metadataBasePath: base || undefined,
    nftMp4Cid: mp4Cid || undefined,
  });
});

// Dynamic metadata for tokens 1–10000 when using single .mp4 (NFT_MP4_CID). No auth.
router.get("/nft-metadata/:tokenId", (req, res) => {
  const mp4Cid = (process.env.NFT_MP4_CID || "").trim();
  if (!mp4Cid) return res.status(404).json({ error: "NFT_MP4_CID not set" });
  const tokenId = parseInt(req.params.tokenId, 10);
  if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > 10000) {
    return res.status(404).json({ error: "Invalid tokenId (1–10000)" });
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
    // Normalize double ipfs:// (e.g. ipfs://ipfs://cid/path -> cid/path)
    uri = uri.replace(/^(ipfs:\/\/)+/i, "ipfs://");
    const path = uri.replace(/^ipfs:\/\//, "").replace(/^\/+/, "");
    // If we have Pinata key, use Pinata gateway; otherwise use public ipfs.io (no auth)
    const usePinata = IPFS_GATEWAY_KEY.length > 0;
    const gatewayBase = usePinata ? PINATA_GATEWAY.replace(/\/+$/, "") : PUBLIC_GATEWAY;
    const gatewayUrl = `${gatewayBase}/${path}`;
    const headers = usePinata ? { "x-pinata-gateway-token": IPFS_GATEWAY_KEY } : {};
    const proxyRes = await fetch(gatewayUrl, { headers });
    const contentType = proxyRes.headers.get("content-type") || "application/octet-stream";
    res.setHeader("content-type", contentType);
    if (!proxyRes.ok) {
      return res.status(proxyRes.status).send(proxyRes.statusText);
    }
    const body = await proxyRes.arrayBuffer();
    res.send(Buffer.from(body));
  } catch (e) {
    res.status(502).json({ error: e?.message || "Proxy failed" });
  }
}

router.get("/ipfs-proxy", ipfsProxyHandler);

export default router;
