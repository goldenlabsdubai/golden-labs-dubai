import { ethers } from "ethers";
import { getMarketplaceAndReservePoolAddress } from "../config/contractsEnv.js";
import { getSharedMainRpcProvider } from "../config/ethersRpc.js";

/**
 * Default matches MarketplaceAndReservePoolContract.tradingIncomeAmount (0.75 USDT at USDT_DECIMALS).
 * Override with MARKETPLACE_TRADING_INCOME_WEI if chain config differs and RPC is unused.
 */
export function getTradingIncomePerSellWeiFromEnv() {
  const raw = String(process.env.MARKETPLACE_TRADING_INCOME_WEI || "750000000000000000").trim();
  try {
    const v = BigInt(raw);
    return v > 0n ? v : 750000000000000000n;
  } catch {
    return 750000000000000000n;
  }
}

const MARKETPLACE_INCOME_ABI = ["function tradingIncomeAmount() view returns (uint256)"];

let cached = { wei: null, at: 0 };
const CACHE_MS = 120_000;

/**
 * Per-successful-sell trading income in USDT smallest units, from on-chain
 * `MarketplaceAndReservePool.tradingIncomeAmount()` when RPC + address are configured.
 * Cached briefly to avoid hammering RPC on frequent GET /user/me. Falls back to env.
 */
export async function resolveTradingIncomePerSellWeiFromChain() {
  const now = Date.now();
  if (cached.wei != null && now - cached.at < CACHE_MS) {
    return cached.wei;
  }
  const fallback = getTradingIncomePerSellWeiFromEnv();
  const addr = (getMarketplaceAndReservePoolAddress() || "").trim();
  const rpc = (process.env.RPC_URL || "").trim();
  if (!addr || !rpc) {
    cached = { wei: fallback, at: now };
    return fallback;
  }
  try {
    const provider = getSharedMainRpcProvider();
    const c = new ethers.Contract(addr, MARKETPLACE_INCOME_ABI, provider);
    const raw = await c.tradingIncomeAmount();
    const w = BigInt(raw.toString());
    if (w > 0n) {
      cached = { wei: w, at: now };
      return w;
    }
  } catch {
    /* use fallback */
  }
  cached = { wei: fallback, at: now };
  return fallback;
}
