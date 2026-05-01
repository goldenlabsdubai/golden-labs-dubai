/**
 * Bot config and state for admin panel.
 * Bots: BOT_1_ADDRESS … BOT_5_ADDRESS. State + admin list: PostgreSQL (admins, bot_control, admin_settings).
 */
import { ethers } from "ethers";
import * as User from "./user.js";
import * as AdminPg from "./adminPostgres.js";
import { getTradingIncomePerSellWeiFromEnv } from "../utils/tradingIncomeWei.js";
import { getMarketplaceAndReservePoolAddress } from "../config/contractsEnv.js";

const BOT_SETTINGS_DOC = "bot_rules";
const BOT_STATS_CACHE_TTL_MS = Number(process.env.BOT_STATS_CACHE_TTL_MS || 30000);
const BOT_BALANCE_READ_TIMEOUT_MS = Number(process.env.BOT_BALANCE_READ_TIMEOUT_MS || 12000);
/** USDT/BNB reads: default 25s (public RPCs often slow when competing with heavy work). */
const BOT_BALANCE_FETCH_MS = Math.max(25000, BOT_BALANCE_READ_TIMEOUT_MS);
/** NFT listing scan can be many RPC calls — separate budget so it does not race USDT balanceOf. */
const BOT_NFT_HOLDINGS_TIMEOUT_MS = Math.max(20000, Number(process.env.BOT_NFT_HOLDINGS_TIMEOUT_MS || 45000));
const BOT_TRADES_READ_TIMEOUT_MS = Number(process.env.BOT_TRADES_READ_TIMEOUT_MS || 8000);
/** Batch size when scanning listings(tokenId) for NFT holdings (was undefined → NaN → broken loop). */
const BOT_NFT_LISTING_SCAN_BATCH = Math.max(5, Math.min(Number(process.env.BOT_NFT_LISTING_SCAN_BATCH || 25), 100));

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const providerByRpc = new Map();
const botStatsCache = new Map();

const DEFAULT_ADMIN_WALLET = "0xbdf976981242e8078b525e78784bf87c3b9da4ca";
const DEFAULT_BUYBACK_DELAY_MS = 60 * 60 * 1000;

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

/** All admin wallets: PostgreSQL `admins` (seeded with default if empty), then env ADMIN_WALLETS / CREATOR_WALLET. */
export async function getAdminWallets() {
  try {
    const fromPg = await AdminPg.getAdminWalletsFromPg();
    if (fromPg !== null && fromPg.length > 0) return fromPg;
  } catch (e) {
    console.warn("botService getAdminWallets PG:", e?.message);
  }
  const env = getAdminWalletsFromEnv();
  if (env.length > 0) return env;
  return [DEFAULT_ADMIN_WALLET];
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

/** Get running state for all bots (PostgreSQL `bot_control`). */
export async function getBotRunningState() {
  try {
    const fromPg = await AdminPg.getBotRunningStatePg();
    if (fromPg !== null) return fromPg;
  } catch (e) {
    console.warn("botService getBotRunningState PG:", e?.message);
  }
  return {};
}

/** Set running state for one bot. */
export async function setBotRunning(botId, running) {
  const state = await getBotRunningState();
  state[String(botId)] = Boolean(running);
  await AdminPg.setBotRunningStatePg(state);
  return state;
}

function normalizeBotSettings(input) {
  const rawDelay = Number(input?.buybackDelayMs);
  const buybackDelayMs = Number.isFinite(rawDelay) && rawDelay >= 60_000 ? Math.floor(rawDelay) : DEFAULT_BUYBACK_DELAY_MS;
  return {
    buybackDelayMs,
    // Hard rule per client requirement.
    disableBotToBotBuys: true,
  };
}

export async function getBotSettings() {
  try {
    const fromPg = await AdminPg.getAdminSettingsByIdPg(BOT_SETTINGS_DOC);
    if (fromPg !== null && Object.keys(fromPg).length > 0) return normalizeBotSettings(fromPg);
  } catch (e) {
    console.warn("botService getBotSettings PG:", e?.message);
  }
  return normalizeBotSettings({});
}

export async function setBotSettings(settings, updatedBy) {
  const normalized = normalizeBotSettings(settings);
  await AdminPg.setAdminSettingsByIdPg(BOT_SETTINGS_DOC, normalized, updatedBy || null);
  return normalized;
}

function hasPgTradeActivity(pg) {
  if (!pg || typeof pg !== "object") return false;
  const tt = Number(pg.totalTrades ?? 0);
  const bt = Number(pg.buyTrades ?? 0);
  const st = Number(pg.sellTrades ?? 0);
  return tt > 0 || bt > 0 || st > 0;
}

function pgTradesToShape(pg) {
  return {
    totalTrades: Number(pg.totalTrades ?? 0),
    buyTrades: Number(pg.buyTrades ?? 0),
    sellTrades: Number(pg.sellTrades ?? 0),
    totalProfit: String(pg.totalProfit ?? "0"),
  };
}

/** Get on-chain stats for one address: balances, buy/sell counts, total trades, total profit (USDT 6 decimals).
 * Options:
 *   - tradesFromChainOnly: true – skip Postgres `user_activities`; use only on-chain Sold events (slow; can time out).
 *   - default / false – use Postgres activity stats when present; otherwise fall back to chain (admin panel uses false).
 *   - skipMarketplaceListedNft: true – NFT count = wallet balanceOf only (fast; undercounts tokens listed on marketplace). */
export async function getBotStats(address, options = {}) {
  const tradesFromChainOnly = Boolean(options?.tradesFromChainOnly);
  const skipMarketplaceListedNft = Boolean(options?.skipMarketplaceListedNft);
  const rpcUrl = (process.env.BOT_STATS_RPC_URL || process.env.RPC_URL || "").trim();
  const usdtAddress = process.env.USDT_ADDRESS;
  const nftAddress = process.env.NFT_CONTRACT_ADDRESS;
  const marketplaceAddress = getMarketplaceAndReservePoolAddress();
  if (!rpcUrl || !address) {
    return {
      usdtBalance: "0",
      bnbBalance: "0",
      nftBalance: 0,
      totalTrades: 0,
      buyTrades: 0,
      sellTrades: 0,
      totalProfit: "0",
    };
  }
  const addr = address.startsWith("0x") ? address : `0x${address}`;
  const provider = getProvider(rpcUrl);
  const cacheKey = `${addr.toLowerCase()}${tradesFromChainOnly ? ":chain" : ":pg"}${skipMarketplaceListedNft ? ":nftw" : ":nftf"}:v2`;
  const now = Date.now();
  const cached = botStatsCache.get(cacheKey);
  if (cached && now - cached.ts < Math.max(2000, BOT_STATS_CACHE_TTL_MS)) {
    return cached.data;
  }

  const dbTradesPromise =
    tradesFromChainOnly
      ? Promise.resolve(null)
      : withTimeoutFallback(
          User.getWalletTradeStatsFromActivity(addr),
          Math.max(2000, BOT_TRADES_READ_TIMEOUT_MS),
          null
        );

  /**
   * USDT/BNB must not run in the same Promise.all as getNftHoldings — listing scans flood the RPC
   * and balanceOf often times out → "0" cached. Fetch balances + PG trades first, NFT after.
   */
  const staleUsdt = cached?.data?.usdtBalance != null ? String(cached.data.usdtBalance) : "0";
  const staleBnb = cached?.data?.bnbBalance != null ? String(cached.data.bnbBalance) : "0";

  /** USDT then BNB (not parallel) — halves RPC burst and reduces Chainstack -32005 flakes between calls. */
  const balanceGap = Math.max(0, Number(process.env.BOT_BALANCE_RPC_GAP_MS ?? 350));

  const usdtBalanceRaw = await Promise.race([
    usdtAddress ? getUsdtBalance(provider, usdtAddress, addr) : Promise.resolve("0"),
    delay(BOT_BALANCE_FETCH_MS).then(() => ({ __timeout: true })),
  ]).then((r) => (r && r.__timeout ? staleUsdt : r));

  if (balanceGap) await delay(balanceGap);

  let bnbBalanceRaw = staleBnb;
  try {
    bnbBalanceRaw = await Promise.race([
      withRpcRetry(() => provider.getBalance(addr)).then((b) => b.toString()),
      delay(BOT_BALANCE_FETCH_MS).then(() => ({ __timeout: true })),
    ]).then((r) => (r && r.__timeout ? staleBnb : r));
  } catch (e) {
    console.warn("getBalance (bnb) failed:", (addr || "").slice(0, 12) + "...", e?.message || e);
    bnbBalanceRaw = staleBnb;
  }

  const dbTrades = await dbTradesPromise;

  const usdtBalance = usdtBalanceRaw;
  const bnbBalance = bnbBalanceRaw;

  const nftBalance = await withTimeoutFallback(
    !nftAddress
      ? Promise.resolve(0)
      : skipMarketplaceListedNft
        ? getNftWalletBalanceOnly(provider, nftAddress, addr)
        : marketplaceAddress
          ? getNftHoldings(provider, marketplaceAddress, nftAddress, addr)
          : getNftWalletBalanceOnly(provider, nftAddress, addr),
    skipMarketplaceListedNft ? Math.min(BOT_NFT_HOLDINGS_TIMEOUT_MS, 12000) : BOT_NFT_HOLDINGS_TIMEOUT_MS,
    cached?.data?.nftBalance ?? 0
  );

  const chainTimeoutMs = Math.max(8000, BOT_TRADES_READ_TIMEOUT_MS, Number(process.env.BOT_STATS_CHAIN_FALLBACK_MS || 25000));
  const emptyTrades = {
    totalTrades: cached?.data?.totalTrades ?? 0,
    buyTrades: cached?.data?.buyTrades ?? 0,
    sellTrades: cached?.data?.sellTrades ?? 0,
    totalProfit: cached?.data?.totalProfit ?? "0",
  };

  let tradesAndProfit;
  if (hasPgTradeActivity(dbTrades)) {
    tradesAndProfit = pgTradesToShape(dbTrades);
  } else if (marketplaceAddress) {
    tradesAndProfit = await withTimeoutFallback(
      getTradesAndProfit(provider, marketplaceAddress, addr),
      chainTimeoutMs,
      emptyTrades
    );
  } else {
    tradesAndProfit = emptyTrades;
  }

  const data = {
    usdtBalance,
    bnbBalance,
    nftBalance,
    totalTrades: tradesAndProfit.totalTrades,
    buyTrades: tradesAndProfit.buyTrades,
    sellTrades: tradesAndProfit.sellTrades,
    totalProfit: tradesAndProfit.totalProfit,
  };
  botStatsCache.set(cacheKey, { ts: now, data });
  return data;
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

/** Wallet NFT count only (no marketplace listings scan). */
async function getNftWalletBalanceOnly(provider, nftAddress, account) {
  try {
    const nft = new ethers.Contract(nftAddress, ["function balanceOf(address) view returns (uint256)"], provider);
    const bal = await withRpcRetry(() => nft.balanceOf(account));
    return Number(bal ?? 0);
  } catch (_) {
    return 0;
  }
}

/**
 * Listed tokens escrow in marketplace — wallet balanceOf misses them. NFT is not ERC721Enumerable,
 * so token IDs in-wallet cannot be enumerated on-chain without indexing. We avoid scanning 1..totalMinted
 * by querying `Listed` logs for this seller, then verifying each candidate with `listings(tokenId)`.
 */
function getListedEventsFromBlock(latestBlock) {
  const configured = parseOptionalNonNegativeInt(process.env.BOT_NFT_LISTED_EVENTS_FROM_BLOCK);
  if (configured != null) return Math.min(configured, latestBlock);
  const lookback = Number(process.env.BOT_NFT_LISTED_EVENTS_LOOKBACK_BLOCKS || 2_000_000);
  const safe = Number.isFinite(lookback) && lookback > 0 ? Math.floor(lookback) : 2_000_000;
  return Math.max(0, latestBlock - safe);
}

/** Returns active listing count for seller via events + verify; `null` = use full-range fallback. */
async function countListedForSellerViaEvents(provider, marketplaceAddress, sellerAddress) {
  const target = (sellerAddress || "").toLowerCase();
  if (!target.startsWith("0x")) return 0;

  const marketplace = new ethers.Contract(
    marketplaceAddress,
    [
      "function listings(uint256) view returns (address seller, uint256, uint256, bool active)",
      "event Listed(uint256 indexed tokenId, address indexed seller, uint256 price)",
    ],
    provider
  );

  let latest;
  try {
    latest = await withRpcRetry(() => provider.getBlockNumber());
  } catch {
    return null;
  }

  const fromBlock = getListedEventsFromBlock(Number(latest));
  let logs;
  try {
    let sellerTopic;
    try {
      sellerTopic = ethers.getAddress(sellerAddress);
    } catch {
      return null;
    }
    const filter = marketplace.filters.Listed(null, sellerTopic);
    logs = await withRpcRetry(() => marketplace.queryFilter(filter, fromBlock, latest));
  } catch (e) {
    console.warn("getNftHoldings Listed logs:", e?.message || e);
    return null;
  }

  const uniqueTokenIds = [];
  const seen = new Set();
  for (const log of logs) {
    const tid = log.args?.tokenId ?? log.args?.[0];
    if (tid == null) continue;
    const key = BigInt(tid.toString()).toString();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueTokenIds.push(BigInt(tid.toString()));
  }

  const cap = Math.max(50, Math.min(Number(process.env.BOT_NFT_LISTED_VERIFY_CAP || 600), 15_000));
  if (uniqueTokenIds.length > cap) {
    console.warn(
      `getNftHoldings: unique Listed tokenIds (${uniqueTokenIds.length}) > cap ${cap}, falling back to 1..totalMinted scan`
    );
    return null;
  }

  const listingStaggerMs = Math.max(0, Number(process.env.BOT_NFT_LISTING_RPC_STAGGER_MS || 0));
  let listed = 0;
  for (const tokenId of uniqueTokenIds) {
    try {
      const l = await withRpcRetry(() => marketplace.listings(tokenId));
      const active = Boolean(l?.[3]);
      const seller = String(l?.[0] ?? "").toLowerCase();
      if (active && seller === target) listed++;
    } catch (_) {}
    if (listingStaggerMs > 0) await delay(listingStaggerMs);
  }
  return listed;
}

/** Legacy: scan every tokenId 1..max (slow; RPC-heavy). */
async function countListedForSellerFullScan(provider, marketplaceAddress, nftAddress, account) {
  const target = (account || "").toLowerCase();
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

  let listed = 0;
  const batch = BOT_NFT_LISTING_SCAN_BATCH;
  const listingStaggerMs = Math.max(0, Number(process.env.BOT_NFT_LISTING_RPC_STAGGER_MS || 35));
  for (let start = 1; start <= maxTokenId; start += batch) {
    const end = Math.min(start + batch - 1, maxTokenId);
    const rows = [];
    for (let tokenId = start; tokenId <= end; tokenId++) {
      try {
        const l = await withRpcRetry(() => marketplace.listings(tokenId));
        rows.push({ active: !!l?.[3], seller: String(l?.[0] ?? "").toLowerCase() });
      } catch {
        rows.push({ active: false, seller: "" });
      }
      if (listingStaggerMs > 0 && tokenId < end) await delay(listingStaggerMs);
    }
    for (const r of rows) {
      if (r.active && r.seller === target) listed++;
    }
  }
  return listed;
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
    const viaEvents = await countListedForSellerViaEvents(provider, marketplaceAddress, account);
    if (viaEvents !== null) {
      listed = viaEvents;
    } else {
      listed = await countListedForSellerFullScan(provider, marketplaceAddress, nftAddress, account);
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

/** Query Sold events and compute buy/sell counts + profit-only (trading income per bot sell) in USDT 6 decimals. */
async function getTradesAndProfit(provider, marketplaceAddress, botAddress) {
  try {
    let incomePerSell = getTradingIncomePerSellWeiFromEnv();
    try {
      const view = new ethers.Contract(
        marketplaceAddress,
        ["function tradingIncomeAmount() view returns (uint256)"],
        provider
      );
      const onChain = await withRpcRetry(() => view.tradingIncomeAmount());
      if (onChain != null) {
        const v = BigInt(onChain.toString());
        if (v > 0n) incomePerSell = v;
      }
    } catch (_) {
      // fallback env/default
    }
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

    const interChunkDelayMsRaw = Number(process.env.BOT_STATS_CHUNK_DELAY_MS || 0);
    const interChunkDelayMs =
      Number.isFinite(interChunkDelayMsRaw) && interChunkDelayMsRaw > 0
        ? Math.floor(interChunkDelayMsRaw)
        : 0;

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
        // Exponential backoff / burst pause: consecutive chunks after RPS errors hammer public RPCs.
        if (isRateLimitedError(e)) {
          const pause = rateLimitBackoffMs(e) || 400;
          await sleep(Math.min(5000, Math.max(200, pause)));
        }
      }
      if (interChunkDelayMs > 0 && end < latestBlock) {
        await sleep(interChunkDelayMs);
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
        profitOnly += incomePerSell;
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

/** Parse Chainstack-style try_again_in (e.g. "192.250535ms") to milliseconds. */
function rateLimitBackoffMs(error) {
  try {
    const candidates = [
      error?.info?.error?.data,
      error?.info?.data,
      error?.error?.data,
      error?.data,
    ];
    for (const data of candidates) {
      const raw = data?.try_again_in ?? data?.tryAgainIn;
      if (raw != null) {
        const ms = parseTryAgainMs(raw);
        if (ms > 0) return Math.min(10_000, ms + 75);
      }
    }
    const msg = String(error?.message || error?.shortMessage || "");
    const m = msg.match(/try_again_in["']?\s*:\s*["']?([\d.]+)\s*ms/i);
    if (m) return Math.min(10_000, Math.ceil(parseFloat(m[1])) + 75);
    return 0;
  } catch {
    return 0;
  }
}

function parseTryAgainMs(raw) {
  const s = String(raw).trim();
  const m = s.match(/^([\d.]+)\s*ms$/i);
  if (m) return Math.ceil(parseFloat(m[1]));
  const n = Number(s);
  return Number.isFinite(n) ? Math.ceil(n) : 0;
}

function isRateLimitedError(error) {
  if (!error) return false;
  if (error.name === "AggregateError" && Array.isArray(error.errors)) {
    return error.errors.some((e) => isRateLimitedError(e));
  }
  const msg = String(error?.message || error?.shortMessage || "").toLowerCase();
  const blob = (() => {
    try {
      return JSON.stringify(error?.info ?? error?.value ?? error?.error ?? "").toLowerCase();
    } catch {
      return "";
    }
  })();
  const code = Number(error?.code);
  if (code === 429 || code === -32005) return true;
  if (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("compute units per second") ||
    msg.includes("exceeded the rps") ||
    msg.includes("rps limit") ||
    msg.includes("try_again_in") ||
    blob.includes("-32005") ||
    blob.includes("rate limit")
  ) {
    return true;
  }
  return false;
}

async function withRpcRetry(fn, retries = 5, baseDelayMs = 500) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (!isRateLimitedError(e) || attempt === retries) break;
      const fromRpc = rateLimitBackoffMs(e);
      const exp = fromRpc > 0 ? fromRpc : Math.min(4000, baseDelayMs * 2 ** attempt);
      await sleep(exp);
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
