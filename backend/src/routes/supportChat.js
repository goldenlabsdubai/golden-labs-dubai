/**
 * Public support chat — answers from an LLM grounded in server-side platform facts (no secrets).
 * Configure SUPPORT_AI_API_KEY (e.g. Groq free tier — OpenAI-compatible HTTP).
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
    /** For the model / copy — safe mailto without validation beyond trim */
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
    safety:
      "Only use the facts above. Do not invent numbers. Never ask for seed phrases or private keys. Never output RPC URLs that contain API keys, JWTs, or server environment values.",
  };
}

const SYSTEM_PROMPT = `You are the Golden Labs in-app support assistant.

Rules:
- Base every factual claim ONLY on the JSON object the user message labels as "platformContext". If a detail is missing there, say you don't have it and suggest using the app (Subscribe / Mint / Marketplace pages) or official community channels.
- Tone: friendly, concise, clear; you may paraphrase but must not contradict the JSON.
- Never give investment advice. No guarantees about profit.
- Never ask for or accept seed phrases, private keys, or full wallet exports.
- Never reveal or guess API keys, JWT secrets, admin paths, or private RPC URLs.
- Contract addresses in platformContext are public on-chain; you may mention them when relevant.
- If platformContext.community includes telegramUrl and/or supportEmail, you may share those for the official Telegram community and email support. Do not invent other emails, links, or “official” accounts.
- Gas is paid in BNB; in-app USDT payments use BEP20 USDT on BSC unless context says otherwise.`;

router.post("/chat", supportRateLimit, async (req, res) => {
  const raw = req.body?.message;
  if (raw == null || typeof raw !== "string") {
    return res.status(400).json({ error: "message is required" });
  }
  const message = raw.trim().slice(0, 4000);
  if (!message) {
    return res.status(400).json({ error: "message is required" });
  }

  const apiKey = (process.env.SUPPORT_AI_API_KEY || "").trim();
  const baseUrl = (process.env.SUPPORT_AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const model = (process.env.SUPPORT_AI_MODEL || "llama-3.1-8b-instant").trim();

  let platformContext;
  try {
    platformContext = await buildPlatformContext();
  } catch (e) {
    console.warn("[support-chat] context build:", e?.message || e);
    return res.status(503).json({ error: "Could not load platform context. Try again later." });
  }

  const userPayload = {
    platformContext,
    userQuestion: message,
  };

  if (!apiKey) {
    const { telegramUrl, supportEmail } = communityFromEnv();
    const tg = telegramUrl ? ` Telegram: ${telegramUrl}` : "";
    const em = supportEmail ? ` Email: ${supportEmail}` : "";
    return res.json({
      configured: false,
      reply: `Live AI isn’t enabled on this server yet (missing SUPPORT_AI_API_KEY). Use the Subscribe, Mint, and Marketplace pages for live on-chain prices. For the community or human support:${tg}${em}`,
    });
  }

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.35,
        max_tokens: 600,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Answer using only platformContext + general safe wallet hygiene.\n\n${JSON.stringify(userPayload)}`,
          },
        ],
      }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = data?.error?.message || data?.message || resp.statusText || "AI provider error";
      console.warn("[support-chat] provider:", msg);
      return res.status(502).json({ error: "The assistant is temporarily unavailable. Please try again shortly." });
    }

    const reply = data?.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      return res.status(502).json({ error: "Empty assistant response." });
    }

    return res.json({ configured: true, reply });
  } catch (e) {
    console.warn("[support-chat]", e?.message || e);
    return res.status(502).json({ error: "Support chat request failed." });
  }
});

export default router;
