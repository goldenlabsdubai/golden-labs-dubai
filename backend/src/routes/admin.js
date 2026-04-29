import { Router } from "express";
import { ethers } from "ethers";
import * as AdminPg from "../services/adminPostgres.js";
import { authMiddleware } from "../middleware/auth.js";
import * as BotService from "../services/botService.js";
import { getMarketplaceAndReservePoolAddress } from "../config/contractsEnv.js";

const router = Router();
/** Require wallet to be in PostgreSQL `admins` or env admin list. Must be used after authMiddleware. */
async function requireAdmin(req, res, next) {
  const wallet = (req.wallet || "").toLowerCase();
  const isAdmin = await BotService.isAdminWallet(wallet);
  if (!isAdmin) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

router.use(authMiddleware);
router.use(requireAdmin);

function withTimeout(promise, timeoutMs = 12000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Request timeout")), timeoutMs)),
  ]);
}

function emptyBotStats() {
  return {
    totalTrades: 0,
    buyTrades: 0,
    sellTrades: 0,
    usdtBalance: "0",
    bnbBalance: "0",
    totalProfit: "0",
    nftBalance: 0,
  };
}

function normalizeAddress(value) {
  if (typeof value !== "string") return "";
  const v = value.trim().toLowerCase();
  return v.startsWith("0x") && v.length === 42 ? v : "";
}

function isStateOnlyBotControlMode() {
  return String(process.env.BOT_PROCESS_MODE || "").trim().toLowerCase() === "state_only";
}

function getEnvContracts() {
  const marketplace = normalizeAddress(getMarketplaceAndReservePoolAddress());
  return {
    usdt: normalizeAddress(process.env.USDT_ADDRESS),
    subscription: normalizeAddress(process.env.SUBSCRIPTION_CONTRACT_ADDRESS),
    nft: normalizeAddress(process.env.NFT_CONTRACT_ADDRESS),
    marketplace,
    referral: normalizeAddress(process.env.REFERRAL_CONTRACT_ADDRESS),
    // Legacy API field: same address as marketplace (MarketplaceAndReservePool).
    reservePool: marketplace,
    creator: normalizeAddress(process.env.CREATOR_WALLET),
  };
}

async function getStoredContracts() {
  try {
    const fromPg = await AdminPg.getAdminSettingsContractsPg();
    if (fromPg !== null) return fromPg;
  } catch (_) {}
  return {};
}

/** GET /api/admin/bots – list bots with config, running state (Postgres), and on-chain stats. */
router.get("/bots", async (req, res) => {
  try {
    const config = BotService.getBotConfig();
    const runningState = await BotService.getBotRunningState();
    const settings = await BotService.getBotSettings();
    /** Chainstack / free RPC: avoid parallel getBotStats (doubles RPS); small gap between bots. */
    const staggerMs = Math.max(0, Number(process.env.ADMIN_BOT_STATS_STAGGER_MS || 250));
    const settled = [];
    for (let i = 0; i < config.length; i++) {
      try {
        const stats = await BotService.getBotStats(config[i].address, { tradesFromChainOnly: false });
        settled.push({ status: "fulfilled", value: stats });
      } catch (reason) {
        settled.push({ status: "rejected", reason });
      }
      if (i < config.length - 1 && staggerMs > 0) {
        await new Promise((r) => setTimeout(r, staggerMs));
      }
    }
    const bots = config.map((bot, index) => {
      const runningFlag = Boolean(runningState[bot.id]);
      const resolved = settled[index];
      const stats = resolved.status === "fulfilled" ? resolved.value : emptyBotStats();
      return {
        id: bot.id,
        address: bot.address,
        isConfigured: Boolean(bot.address),
        running: runningFlag,
        totalTrades: stats.totalTrades,
        buyTrades: stats.buyTrades,
        sellTrades: stats.sellTrades,
        usdtBalance: stats.usdtBalance,
        bnbBalance: stats.bnbBalance,
        totalProfit: stats.totalProfit,
        nftHoldings: stats.nftBalance,
        statsError: resolved.status === "rejected" ? (resolved.reason?.message || "Stats unavailable") : "",
      };
    });
    res.json({ bots, settings, serverTime: Date.now() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** PATCH /api/admin/bots/:id/start – set bot running = true in Firestore. Bots project applies this (e.g. PM2 start) on the server. */
router.patch("/bots/:id/start", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const config = BotService.getBotConfig();
    if (!config.some((b) => b.id === id)) {
      return res.status(404).json({ error: "Bot not found" });
    }
    await BotService.setBotRunning(id, true);
    res.json({ ok: true, running: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** PATCH /api/admin/bots/:id/stop – set bot running = false in Postgres. */
router.patch("/bots/:id/stop", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const config = BotService.getBotConfig();
    if (!config.some((b) => b.id === id)) {
      return res.status(404).json({ error: "Bot not found" });
    }
    await BotService.setBotRunning(id, false);
    res.json({ ok: true, running: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/bots/settings", async (_req, res) => {
  try {
    const settings = await BotService.getBotSettings();
    res.json({ settings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch("/bots/settings", async (req, res) => {
  try {
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const next = await BotService.setBotSettings(
      { buybackDelayMs: payload.buybackDelayMs },
      (req.wallet || "").toLowerCase()
    );
    res.json({ ok: true, settings: next });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/admin/contracts – merged contracts config (env + Postgres overrides). */
router.get("/contracts", async (req, res) => {
  try {
    const envContracts = getEnvContracts();
    const storedContracts = await getStoredContracts();
    const contracts = { ...envContracts, ...storedContracts };
    res.json({
      contracts,
      source: {
        env: envContracts,
        database: storedContracts,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** PATCH /api/admin/contracts – save contract addresses in Postgres admin_settings. */
router.patch("/contracts", async (req, res) => {
  try {
    const payload = req.body?.contracts && typeof req.body.contracts === "object" ? req.body.contracts : req.body;
    const allowedKeys = ["usdt", "subscription", "nft", "marketplace", "referral", "reservePool", "creator"];
    const updates = {};
    for (const key of allowedKeys) {
      if (payload[key] == null) continue;
      const value = normalizeAddress(String(payload[key]));
      if (!value) return res.status(400).json({ error: `Invalid address for ${key}` });
      if (key === "reservePool") {
        // Keep old key supported but map it to merged marketplace contract.
        updates.marketplace = value;
        updates.reservePool = value;
      } else {
        updates[key] = value;
      }
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid contract fields provided" });
    }
    const existing = await getStoredContracts();
    const merged = { ...existing, ...updates };
    await AdminPg.setAdminSettingsContractsPg(merged, (req.wallet || "").toLowerCase());
    const contracts = { ...getEnvContracts(), ...(await getStoredContracts()) };
    res.json({ ok: true, contracts });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/admin/contracts/status – check whether each address has bytecode on configured RPC. */
router.get("/contracts/status", async (req, res) => {
  try {
    const contracts = { ...getEnvContracts(), ...(await getStoredContracts()) };
    const rpcUrl = process.env.RPC_URL;
    if (!rpcUrl) {
      return res.json({
        rpcConfigured: false,
        checks: Object.entries(contracts).map(([key, address]) => ({
          key,
          address: address || "",
          isSet: Boolean(address),
          isContract: null,
          note: "RPC_URL missing in backend .env",
        })),
      });
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const entries = Object.entries(contracts);
    const checks = await Promise.all(
      entries.map(async ([key, address]) => {
        if (!address) return { key, address: "", isSet: false, isContract: null };
        if (key === "creator") {
          const balance = await provider.getBalance(address);
          return { key, address, isSet: true, isContract: false, balanceWei: balance.toString() };
        }
        try {
          const code = await provider.getCode(address);
          return {
            key,
            address,
            isSet: true,
            isContract: code && code !== "0x",
            bytecodeSize: code && code !== "0x" ? Math.max((code.length - 2) / 2, 0) : 0,
          };
        } catch (e) {
          return { key, address, isSet: true, isContract: null, error: e?.message || "RPC error" };
        }
      })
    );
    res.json({ rpcConfigured: true, checks });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
