/**
 * Public support chat — replies from live on-chain + env context on this server (no third-party LLM).
 */
import { Router } from "express";
import { ethers } from "ethers";
import { getDeployedContractsSnapshot } from "../config/contractsEnv.js";
import { getSubscriptionPriceFromChain } from "../services/onChainUser.js";
import { USDT_DECIMALS } from "../constants/usdtDecimals.js";

const router = Router();

/** Defaults match frontend `config/supportChannels.js` / Landing CTAs. */
const DEFAULT_COMMUNITY_TELEGRAM = "https://t.me/goldenlabschannel";
const DEFAULT_SUPPORT_EMAIL = "goldenlabssupport@gmail.com";

function communityFromEnv() {
  const telegramUrl = (process.env.SUPPORT_COMMUNITY_TELEGRAM_URL || DEFAULT_COMMUNITY_TELEGRAM).trim();
  const supportEmail = (process.env.SUPPORT_CONTACT_EMAIL || DEFAULT_SUPPORT_EMAIL).trim();
  return {
    telegramUrl: telegramUrl || undefined,
    supportEmail: supportEmail || undefined,
    mailtoHref: supportEmail ? `mailto:${supportEmail}` : undefined,
  };
}

const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 30;
const rateByIp = new Map();

function supportRateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  let row = rateByIp.get(ip);
  if (!row || now > row.resetAt) {
    row = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateByIp.set(ip, row);
  }
  row.count += 1;
  if (row.count > RATE_MAX) {
    return res.status(429).json({ error: "Too many messages. Please wait a bit and try again." });
  }
  next();
}

async function buildPlatformContext() {
  const contracts = getDeployedContractsSnapshot();
  const chainId = String((process.env.CHAIN_ID || "56").trim() || "56");
  const frontendUrl = (process.env.FRONTEND_URL || process.env.PLATFORM_URL || "").trim().replace(/\/$/, "");
  const backendPublic = (process.env.BACKEND_URL || "").trim().replace(/\/$/, "");

  let subscription = { subscriptionKnown: false };
  try {
    const s = await getSubscriptionPriceFromChain();
    subscription = {
      subscriptionKnown: true,
      priceUsdt: s.price,
      priceFormatted: s.priceFormatted,
      priceWei: s.priceWei,
    };
  } catch (e) {
    subscription.error = e?.message || String(e);
  }

  let mint = { mintPriceKnown: false };
  try {
    const contractAddress = (process.env.NFT_CONTRACT_ADDRESS || "").trim();
    const rpcUrl = (process.env.RPC_URL || "").trim();
    if (contractAddress && rpcUrl) {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const nft = new ethers.Contract(
        contractAddress,
        ["function mintPrice() view returns (uint256)"],
        provider
      );
      const wei = await nft.mintPrice();
      const mintPriceWei = wei.toString();
      if (mintPriceWei !== "0") {
        const raw = ethers.formatUnits(wei, USDT_DECIMALS);
        const mintPriceUsdt = raw.includes(".") ? raw.replace(/0+$/, "").replace(/\.$/, "") || "0" : raw;
        mint = { mintPriceKnown: true, mintPriceUsdt, mintPriceWei, rule: "1 wallet = 1 NFT (lifetime)" };
      }
    }
  } catch (e) {
    mint.error = e?.message || String(e);
  }

  return {
    product: "Golden Labs — BNB Smart Chain (mainnet) NFT subscription + marketplace",
    chainId,
    usdtDecimals: USDT_DECIMALS,
    frontendUrl: frontendUrl || undefined,
    apiPublicBase: backendPublic || undefined,
    contracts: {
      usdt: contracts.usdtAddress || undefined,
      subscription: contracts.subscriptionContractAddress || undefined,
      nft: contracts.nftContractAddress || undefined,
      marketplaceAndReservePool: contracts.marketplaceAndReservePoolAddress || undefined,
      referral: contracts.referralContractAddress || undefined,
    },
    subscription,
    mint,
    community: communityFromEnv(),
  };
}

function buildSupportReply(platformContext, userQuestion) {
  const c = platformContext?.community || {};
  const parts = [];
  const q = (userQuestion || "").toLowerCase();

  const isGreetingOrAbout =
    /\b(hi|hello|hey)\b/.test(q) ||
    /what.*(platform|golden|this|about)/.test(q) ||
    /^what\s+is(\s+this)?\s*(\?)?$/i.test(q.trim());
  if (isGreetingOrAbout) {
    parts.push(
      "Golden Labs is a BNB Smart Chain (mainnet) app: connect your wallet, subscribe with USDT, mint one NFT per wallet, then use the marketplace to list and buy assets. Referrals and earnings features are in the dashboard."
    );
  } else {
    parts.push(
      "Golden Labs runs on BNB Smart Chain: subscribe (USDT), mint (USDT + gas in BNB), then trade on the marketplace. Use the in-app pages for step-by-step flows."
    );
  }

  if (platformContext?.subscription?.subscriptionKnown && platformContext.subscription.priceFormatted) {
    parts.push(`Subscription price on-chain right now: ${platformContext.subscription.priceFormatted}.`);
  }
  if (platformContext?.mint?.mintPriceKnown) {
    parts.push(`Mint price: ${platformContext.mint.mintPriceUsdt} USDT (${platformContext.mint.rule || "1 wallet = 1 NFT"}).`);
  }

  const contact = [];
  if (c.telegramUrl) contact.push(`Telegram: ${c.telegramUrl}`);
  if (c.supportEmail) contact.push(`Email: ${c.supportEmail}`);
  if (contact.length) {
    parts.push(`More help: ${contact.join(" | ")}.`);
  }

  parts.push("Replies use live data from this API. For anything else, use Telegram or email above.");
  return parts.join("\n\n");
}

router.post("/chat", supportRateLimit, async (req, res) => {
  const raw = req.body?.message;
  if (raw == null || typeof raw !== "string") {
    return res.status(400).json({ error: "message is required" });
  }
  const message = raw.trim().slice(0, 4000);
  if (!message) {
    return res.status(400).json({ error: "message is required" });
  }

  let platformContext;
  try {
    platformContext = await buildPlatformContext();
  } catch (e) {
    console.warn("[support-chat] context build:", e?.message || e);
    return res.status(503).json({ error: "Could not load platform context. Try again later." });
  }

  const reply = buildSupportReply(platformContext, message);
  return res.json({ configured: true, reply });
});

export default router;
