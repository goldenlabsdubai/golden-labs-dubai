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
const BOT_STATS_CACHE_TTL_MS = Number(process.env.BOT_STATS_CACHE_TTL_MS || 20000);
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
 *   - default / false – use Postgres activity stats when present; otherwise fall back to chain (admin panel uses false). */
export async function getBotStats(address, options = {}) {
  const tradesFromChainOnly = Boolean(options?.tradesFromChainOnly);
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
  const cacheKey = `${addr.toLowerCase()}${tradesFromChainOnly ? ":chain" : ":pg"}:v2`;
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

  const [usdtBalanceRaw, bnbBalanceRaw, dbTrades] = await Promise.all([
    Promise.race([
      usdtAddress ? getUsdtBalance(provider, usdtAddress, addr) : Promise.resolve("0"),
      delay(BOT_BALANCE_FETCH_MS).then(() => ({ __timeout: true })),
    ]).then((r) => (r && r.__timeout ? staleUsdt : r)),
    Promise.race([
      withRpcRetry(() => provider.getBalance(addr)).then((b) => b.toString()),
      delay(BOT_BALANCE_FETCH_MS).then(() => ({ __timeout: true })),
    ]).then((r) => (r && r.__timeout ? staleBnb : r)),
    dbTradesPromise,
  ]);

  const usdtBalance = usdtBalanceRaw;
  const bnbBalance = bnbBalanceRaw;

  const nftBalance = await withTimeoutFallback(
    nftAddress && marketplaceAddress ? getNftHoldings(provider, marketplaceAddress, nftAddress, addr) : Promise.resolve(0),
    BOT_NFT_HOLDINGS_TIMEOUT_MS,
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
    const batch = BOT_NFT_LISTING_SCAN_BATCH;
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
