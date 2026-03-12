/**
 * Bot config and state for admin panel.
 * Bots are identified by env BOT_1_ADDRESS, BOT_2_ADDRESS, ... BOT_5_ADDRESS.
 * Running state is stored in Firestore bot_control/bots.
 * Admin wallets: Firestore collection "admins" (one doc per wallet, doc id = wallet address lowercase).
 * Default admin is seeded on first read if collection is empty.
 */
import { ethers } from "ethers";
import { getFirestore } from "../config/firebase.js";
import * as User from "./userFirestore.js";

const BOT_CONTROL_COLLECTION = "bot_control";
const BOT_STATE_DOC = "bots";
const ADMINS_COLLECTION = "admins";
const BOT_STATS_CACHE_TTL_MS = Number(process.env.BOT_STATS_CACHE_TTL_MS || 20000);
const BOT_BALANCE_READ_TIMEOUT_MS = Number(process.env.BOT_BALANCE_READ_TIMEOUT_MS || 12000);
const BOT_TRADES_READ_TIMEOUT_MS = Number(process.env.BOT_TRADES_READ_TIMEOUT_MS || 8000);
const BOT_BUFFER_READ_TIMEOUT_MS = Number(process.env.BOT_BUFFER_READ_TIMEOUT_MS || 18000);
const BOT_BUFFER_SCAN_BATCH = Number(process.env.BOT_BUFFER_SCAN_BATCH || 40);
const SELLER_PROFIT_BPS = 120n;
const SELLER_BASE_DIVISOR = 2n;
const providerByRpc = new Map();
const botStatsCache = new Map();

/** Default admin wallet – seeded into Firestore admins collection if empty. */
const DEFAULT_ADMIN_WALLET = "0xbdf976981242e8078b525e78784bf87c3b9da4ca";

function getAdminWalletsFromEnv() {
  const raw = process.env.ADMIN_WALLETS || "";
  const fromList = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s && s.startsWith("0x"));
  if (fromList.length > 0) return fromList;
  const creator = (process.env.CREATOR_WALLET || "").trim().toLowerCase();
  if (creator && (creator.startsWith("0x") || creator.length === 42)) {
    return [creator.startsWith("0x") ? creator : `0x${creator}`];
  }
  return [];
}

/** Ensure default admin doc exists in admins collection. */
async function ensureDefaultAdmin(db) {
  const ref = db.collection(ADMINS_COLLECTION).doc(DEFAULT_ADMIN_WALLET);
  const doc = await ref.get();
  if (!doc.exists) {
    await ref.set({ wallet: DEFAULT_ADMIN_WALLET, createdAt: new Date() });
  }
}

/** Get admin wallet addresses from Firestore collection "admins". Doc id = wallet (lowercase). */
async function getAdminWalletsFromFirestore() {
  const db = getFirestore();
  if (!db) return [];
  try {
    await ensureDefaultAdmin(db);
    const snapshot = await db.collection(ADMINS_COLLECTION).get();
    const wallets = [];
    snapshot.forEach((doc) => {
      const id = doc.id;
      if (id && id.startsWith("0x") && id.length === 42) wallets.push(id.toLowerCase());
    });
    return wallets;
  } catch (e) {
    console.warn("botService getAdminWalletsFromFirestore:", e?.message);
    return [];
  }
}

/** All admin wallets: Firestore first, then env fallback. Used for admin panel login and /api/admin. */
export async function getAdminWallets() {
  const fromFirestore = await getAdminWalletsFromFirestore();
  if (fromFirestore.length > 0) return fromFirestore;
  return getAdminWalletsFromEnv();
}

export async function isAdminWallet(wallet) {
  if (!wallet || typeof wallet !== "string") return false;
  const admins = await getAdminWallets();
  return admins.includes(wallet.toLowerCase());
}

/** List bot ids and addresses from env (BOT_1_ADDRESS, BOT_2_ADDRESS, ... BOT_5_ADDRESS). */
export function getBotConfig() {
  const list = [];
  for (let i = 1; i <= 5; i++) {
    const addr = (process.env[`BOT_${i}_ADDRESS`] || "").trim();
    if (addr) list.push({ id: String(i), address: addr.startsWith("0x") ? addr : `0x${addr}` });
  }
  return list;
}

/** True when wallet matches configured bot address (BOT_1_ADDRESS ... BOT_5_ADDRESS). */
export function isConfiguredBotWallet(wallet) {
  if (!wallet || typeof wallet !== "string") return false;
  const w = wallet.toLowerCase();
  return getBotConfig().some((b) => (b.address || "").toLowerCase() === w);
}

/** Get running state for all bots from Firestore. Returns { "1": true, "2": false, ... }. */
export async function getBotRunningState() {
  const db = getFirestore();
  if (!db) return {};
  try {
    const doc = await db.collection(BOT_CONTROL_COLLECTION).doc(BOT_STATE_DOC).get();
    const data = doc.exists ? doc.data() : {};
    return data.runningByBotId && typeof data.runningByBotId === "object" ? data.runningByBotId : {};
  } catch (e) {
    console.warn("botService getBotRunningState:", e?.message);
    return {};
  }
}

/** Set running state for one bot. */
export async function setBotRunning(botId, running) {
  const db = getFirestore();
  if (!db) throw new Error("Firestore not configured");
  const state = await getBotRunningState();
  state[String(botId)] = Boolean(running);
  await db.collection(BOT_CONTROL_COLLECTION).doc(BOT_STATE_DOC).set(
    { runningByBotId: state, updatedAt: new Date() },
    { merge: true }
  );
  return state;
}

/** Get on-chain stats for one address: balances, buy/sell counts, total trades, total profit (USDT 6 decimals).
 * Options:
 *   - skipBuffer: true – skip Firestore buffer read (e.g. admin panel).
 *   - tradesFromChainOnly: true – skip Firestore trades; use only on-chain Sold events (e.g. admin panel to avoid quota). */
export async function getBotStats(address, options = {}) {
  const skipBuffer = Boolean(options?.skipBuffer);
  const tradesFromChainOnly = Boolean(options?.tradesFromChainOnly);
  const rpcUrl = (process.env.BOT_STATS_RPC_URL || process.env.RPC_URL || "").trim();
  const usdtAddress = process.env.USDT_ADDRESS;
  const nftAddress = process.env.NFT_CONTRACT_ADDRESS;
  const marketplaceAddress = process.env.MARKETPLACE_CONTRACT_ADDRESS;
  if (!rpcUrl || !address) {
    return {
      usdtBalance: "0",
      bnbBalance: "0",
      nftBalance: 0,
      totalTrades: 0,
      buyTrades: 0,
      sellTrades: 0,
      totalProfit: "0",
      bufferPending: "0",
      bufferReceived: "0",
      bufferStatus: "none",
    };
  }
  const addr = address.startsWith("0x") ? address : `0x${address}`;
  const provider = getProvider(rpcUrl);
  const cacheKey = addr.toLowerCase() + (skipBuffer ? ":nobuf" : "") + (tradesFromChainOnly ? ":chain" : "");
  const now = Date.now();
  const cached = botStatsCache.get(cacheKey);
  if (cached && now - cached.ts < Math.max(2000, BOT_STATS_CACHE_TTL_MS)) {
    return cached.data;
  }

  const bufferPromise = skipBuffer
    ? Promise.resolve({ bufferPending: "0", bufferReceived: "0", bufferStatus: "none" })
    : withTimeoutFallback(
        (async () => {
          if (!marketplaceAddress) return { bufferPending: "0", bufferReceived: "0", bufferStatus: "none" };
          const onChain = await getBufferStatsOnChain(provider, marketplaceAddress, nftAddress, addr).catch(() => ({
            bufferPending: "0",
            bufferReceived: "0",
            bufferStatus: "none",
            bufferAmount: null,
          }));
          const bufferAmount = onChain.bufferAmount ?? (await fetchBufferAmount(provider, marketplaceAddress).catch(() => null));
          const bufferReceived = bufferAmount ? (await User.getBufferReceivedFromFirestore(addr, bufferAmount)) ?? "0" : "0";
          const status = BigInt(onChain.bufferPending) > 0n ? "pending" : BigInt(bufferReceived) > 0n ? "received" : "none";
          return { bufferPending: onChain.bufferPending, bufferReceived, bufferStatus: status };
        })(),
        Math.max(5000, BOT_BUFFER_READ_TIMEOUT_MS),
        {
          bufferPending: cached?.data?.bufferPending ?? "0",
          bufferReceived: cached?.data?.bufferReceived ?? "0",
          bufferStatus: cached?.data?.bufferStatus ?? "none",
        }
      );

  const firestoreTradesPromise =
    tradesFromChainOnly
      ? Promise.resolve(null)
      : withTimeoutFallback(
          User.getWalletTradeStatsFromActivity(addr),
          Math.max(2000, BOT_TRADES_READ_TIMEOUT_MS),
          null
        );

  const [usdtBalance, bnbBalance, nftBalance, firestoreTrades, bufferStats] = await Promise.all([
    withTimeoutFallback(
      usdtAddress ? getUsdtBalance(provider, usdtAddress, addr) : Promise.resolve("0"),
      Math.max(1500, BOT_BALANCE_READ_TIMEOUT_MS),
      cached?.data?.usdtBalance ?? "0"
    ),
    withTimeoutFallback(
      withRpcRetry(() => provider.getBalance(addr)).then((b) => b.toString()),
      Math.max(1500, BOT_BALANCE_READ_TIMEOUT_MS),
      cached?.data?.bnbBalance ?? "0"
    ),
    withTimeoutFallback(
      nftAddress && marketplaceAddress ? getNftHoldings(provider, marketplaceAddress, nftAddress, addr) : Promise.resolve(0),
      Math.max(5000, BOT_BALANCE_READ_TIMEOUT_MS),
      cached?.data?.nftBalance ?? 0
    ),
    firestoreTradesPromise,
    bufferPromise,
  ]);

  const tradesAndProfit =
    firestoreTrades ||
    (marketplaceAddress
      ? await withTimeoutFallback(
          getTradesAndProfit(provider, marketplaceAddress, addr),
          Math.max(2000, BOT_TRADES_READ_TIMEOUT_MS),
          {
            totalTrades: cached?.data?.totalTrades ?? 0,
            buyTrades: cached?.data?.buyTrades ?? 0,
            sellTrades: cached?.data?.sellTrades ?? 0,
            totalProfit: cached?.data?.totalProfit ?? "0",
          }
        )
      : {
          totalTrades: cached?.data?.totalTrades ?? 0,
          buyTrades: cached?.data?.buyTrades ?? 0,
          sellTrades: cached?.data?.sellTrades ?? 0,
          totalProfit: cached?.data?.totalProfit ?? "0",
        });

  const data = {
    usdtBalance,
    bnbBalance,
    nftBalance,
    totalTrades: tradesAndProfit.totalTrades,
    buyTrades: tradesAndProfit.buyTrades,
    sellTrades: tradesAndProfit.sellTrades,
    totalProfit: tradesAndProfit.totalProfit,
    bufferPending: bufferStats?.bufferPending ?? "0",
    bufferReceived: bufferStats?.bufferReceived ?? "0",
    bufferStatus: bufferStats?.bufferStatus ?? "none",
  };
  botStatsCache.set(cacheKey, { ts: now, data });
  return data;
}

async function fetchBufferAmount(provider, marketplaceAddress) {
  try {
    const m = new ethers.Contract(marketplaceAddress, ["function BUFFER_AMOUNT() view returns (uint256)"], provider);
    const v = await withRpcRetry(() => m.BUFFER_AMOUNT());
    return v != null ? v.toString() : null;
  } catch (_) {
    return null;
  }
}

/** On-chain pending buffer from bufferOwedFor (authoritative, no eth_getLogs). */
async function getBufferStatsOnChain(provider, marketplaceAddress, nftAddress, account) {
  const fallback = { bufferPending: "0", bufferReceived: "0", bufferStatus: "none", bufferAmount: null };
  try {
    const marketplace = new ethers.Contract(
      marketplaceAddress,
      ["function bufferOwedFor(uint256) view returns (address)", "function BUFFER_AMOUNT() view returns (uint256)"],
      provider
    );
    const target = (account || "").toLowerCase();
    if (!target || !target.startsWith("0x")) return fallback;
    const bufferAmount = BigInt((await withRpcRetry(() => marketplace.BUFFER_AMOUNT())).toString());
    let maxTokenId = Number(process.env.MARKETPLACE_MAX_TOKEN_ID || 500);
    if (nftAddress) {
      try {
        const nft = new ethers.Contract(nftAddress, ["function totalMinted() view returns (uint256)"], provider);
        const minted = await withRpcRetry(() => nft.totalMinted());
        const n = Number(minted ?? 0);
        if (Number.isFinite(n) && n > 0) maxTokenId = Math.min(n + 10, 10000);
      } catch (_) {}
    }
    maxTokenId = Math.max(1, Math.min(maxTokenId, 10000));
    const safeBatch = Math.max(10, Math.min(BOT_BUFFER_SCAN_BATCH, 100));
    let pendingCount = 0n;
    for (let start = 1; start <= maxTokenId; start += safeBatch) {
      const end = Math.min(start + safeBatch - 1, maxTokenId);
      const rows = await Promise.all(
        Array.from({ length: end - start + 1 }, (_, i) => start + i).map((tokenId) =>
          withRpcRetry(() => marketplace.bufferOwedFor(tokenId))
            .then((x) => String(x || "").toLowerCase())
            .catch(() => "")
        )
      );
      for (const addr of rows) {
        if (addr === target) pendingCount += 1n;
      }
    }
    const bufferPending = (pendingCount * bufferAmount).toString();
    const status = BigInt(bufferPending) > 0n ? "pending" : "none";
    return { bufferPending, bufferReceived: "0", bufferStatus: status, bufferAmount: bufferAmount.toString() };
  } catch (err) {
    console.warn("getBufferStatsOnChain error:", err?.message);
    return fallback;
  }
}

async function getUsdtBalance(provider, usdtAddress, account) {
  try {
    const contract = new ethers.Contract(
      usdtAddress,
      ["function balanceOf(address) view returns (uint256)"],
      provider
    );
    const bal = await withRpcRetry(() => contract.balanceOf(account));
    return bal.toString();
  } catch (e) {
    console.warn("getUsdtBalance failed:", account?.slice(0, 10) + "...", e?.message || e);
    return "0";
  }
}

/** NFT holdings = in wallet + listed on marketplace (listed NFTs are still "held" by the bot). */
async function getNftHoldings(provider, marketplaceAddress, nftAddress, account) {
  let inWallet = 0;
  try {
    const nft = new ethers.Contract(nftAddress, ["function balanceOf(address) view returns (uint256)"], provider);
    const bal = await withRpcRetry(() => nft.balanceOf(account));
    inWallet = Number(bal ?? 0);
  } catch (_) {}
  const target = (account || "").toLowerCase();
  if (!target.startsWith("0x") || !marketplaceAddress) return inWallet;
  let listed = 0;
  try {
    const marketplace = new ethers.Contract(
      marketplaceAddress,
      ["function listings(uint256) view returns (address seller, uint256, uint256, bool active)"],
      provider
    );
    let maxTokenId = Number(process.env.MARKETPLACE_MAX_TOKEN_ID || 500);
    try {
      const nft = new ethers.Contract(nftAddress, ["function totalMinted() view returns (uint256)"], provider);
      const minted = await withRpcRetry(() => nft.totalMinted());
      const n = Number(minted ?? 0);
      if (Number.isFinite(n) && n > 0) maxTokenId = Math.min(n + 10, 10000);
    } catch (_) {}
    maxTokenId = Math.max(1, Math.min(maxTokenId, 10000));
    const batch = Math.max(10, Math.min(BOT_BUFFER_SCAN_BATCH, 100));
    for (let start = 1; start <= maxTokenId; start += batch) {
      const end = Math.min(start + batch - 1, maxTokenId);
      const rows = await Promise.all(
        Array.from({ length: end - start + 1 }, (_, i) => start + i).map((tokenId) =>
          withRpcRetry(() => marketplace.listings(tokenId))
            .then((l) => ({ active: !!l?.[3], seller: String(l?.[0] ?? "").toLowerCase() }))
            .catch(() => ({ active: false, seller: "" }))
        )
      );
      for (const r of rows) {
        if (r.active && r.seller === target) listed++;
      }
    }
  } catch (e) {
    console.warn("getNftHoldings listed count failed:", e?.message);
  }
  return inWallet + listed;
}

function parseOptionalNonNegativeInt(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/** Query Sold events and compute buy/sell counts + profit-only (1.20% seller profit metric) in USDT 6 decimals. */
async function getTradesAndProfit(provider, marketplaceAddress, botAddress) {
  try {
    const contract = new ethers.Contract(
      marketplaceAddress,
      [
        "event Sold(uint256 indexed tokenId, address seller, address buyer, uint256 price)",
      ],
      provider
    );
    const botLower = botAddress.toLowerCase();
    const filter = contract.filters.Sold();
    const latestBlock = await withRpcRetry(() => provider.getBlockNumber());
    const configuredFrom = parseOptionalNonNegativeInt(
      process.env.BOT_STATS_FROM_BLOCK || process.env.MARKETPLACE_FROM_BLOCK
    );
    const lookback = Number(process.env.BOT_STATS_LOOKBACK_BLOCKS || 120000);
    const safeLookback = Number.isFinite(lookback) && lookback > 0 ? lookback : 120000;
    const fallbackFrom = Math.max(0, latestBlock - safeLookback);
    const fromBlock = configuredFrom != null
      ? Math.min(configuredFrom, latestBlock)
      : fallbackFrom;
    const stepRaw = Number(process.env.BOT_STATS_BLOCK_STEP || 9);
    const step = Number.isFinite(stepRaw) && stepRaw > 0 ? Math.floor(stepRaw) : 9;

    const events = [];
    for (let start = fromBlock; start <= latestBlock; start += step + 1) {
      const end = Math.min(start + step, latestBlock);
      // Query in chunks to avoid RPC provider range/response limits.
      try {
        const chunk = await withRpcRetry(() => contract.queryFilter(filter, start, end));
        if (chunk && chunk.length) events.push(...chunk);
      } catch (e) {
        // Continue remaining chunks so one RPC window error doesn't zero out full stats.
        console.warn(`getTradesAndProfit chunk failed [${start}-${end}]:`, e?.message || e);
      }
    }
    let buyTrades = 0;
    let sellTrades = 0;
    let profitOnly = 0n;
    for (const e of events) {
      const seller = (e.args?.seller || "").toString().toLowerCase();
      const buyer = (e.args?.buyer || "").toString().toLowerCase();
      const price = e.args?.price != null ? BigInt(e.args.price.toString()) : 0n;
      if (seller === botLower) {
        sellTrades++;
        const sellerBase = price / SELLER_BASE_DIVISOR;
        const perSaleProfit = (sellerBase * SELLER_PROFIT_BPS) / 10000n;
        profitOnly += perSaleProfit;
      }
      if (buyer === botLower) {
        buyTrades++;
      }
    }
    const totalTrades = buyTrades + sellTrades;
    return {
      totalTrades,
      buyTrades,
      sellTrades,
      totalProfit: profitOnly > 0n ? profitOnly.toString() : "0",
    };
  } catch (e) {
    console.warn("getTradesAndProfit:", e?.message);
    return { totalTrades: 0, buyTrades: 0, sellTrades: 0, totalProfit: "0" };
  }
}

function getProvider(rpcUrl) {
  const key = String(rpcUrl || "");
  if (!providerByRpc.has(key)) {
    providerByRpc.set(key, new ethers.JsonRpcProvider(key));
  }
  return providerByRpc.get(key);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitedError(error) {
  const msg = String(error?.message || error?.shortMessage || "").toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("compute units per second") ||
    Number(error?.code) === 429
  );
}

async function withRpcRetry(fn, retries = 2, baseDelayMs = 400) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (!isRateLimitedError(e) || attempt === retries) break;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}

async function withTimeoutFallback(promise, timeoutMs, fallback) {
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
    ]);
  } catch (_) {
    return fallback;
  }
}
