/**
 * Public support chat — POST /api/public/support/chat
 * Optional Groq (OpenAI-compatible): grounded in live platformContext. Falls back to template reply if Groq fails or key missing.
 */
import { Router } from "express";
import { ethers } from "ethers";
import { getSupportAiApiKey } from "../utils/supportAiKey.js";
import { postHttpsJson } from "../utils/postHttpsJson.js";
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
    safety:
      "Only use the facts in platformContext. Do not invent numbers. Never ask for seed phrases or private keys.",
  };
}

const SYSTEM_PROMPT = `You are the Golden Labs in-app support assistant.

Rules:
- Base every factual claim ONLY on the JSON labeled "platformContext" inside the user message. If something is missing, say you do not have it and point to the Subscribe / Mint / Marketplace pages or platformContext.community.
- Tone: friendly, concise, clear.
- No investment advice or profit guarantees.
- Never ask for seed phrases, private keys, or wallet exports.
- Never reveal API keys, JWT secrets, admin paths, or private RPC URLs.
- Contract addresses in platformContext are public on-chain; you may name them when useful.
- If platformContext.community has telegramUrl or supportEmail, you may share those for official community / email support.
- Gas is paid in BNB; USDT payments are BEP20 on BSC unless context says otherwise.`;

/** Template reply when Groq is off or errors (still uses real subscription/mint when known). */
function buildSupportReply(platformContext, userQuestion, closingLine) {
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

  parts.push(
    closingLine ||
      "Live summary from this API (assistant model unavailable). Contact Telegram or email above if needed."
  );
  return parts.join("\n\n");
}

async function tryGroqCompletion({ apiKey, baseUrl, model, userPayload }) {
  const TIMEOUT_MS = Math.min(
    Math.max(Number(process.env.SUPPORT_AI_TIMEOUT_MS) || 28000, 5000),
    120000
  );
  const url = `${baseUrl}/chat/completions`;
  const bodyObj = {
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
  };

  let statusCode = 0;
  let raw = "";
  try {
    const out = await postHttpsJson(url, { Authorization: `Bearer ${apiKey}` }, bodyObj, TIMEOUT_MS);
    statusCode = out.statusCode;
    raw = out.text;
  } catch (e) {
    const msg = e?.message || String(e);
    console.warn(`[support-chat] Groq POST failed model=${model}:`, msg);
    return { reply: null, statusCode: 0, data: { error: { message: msg } } };
  }

  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    data = { error: { message: `non-JSON (${statusCode}): ${raw.slice(0, 180)}` } };
  }
  const reply = data?.choices?.[0]?.message?.content?.trim() || null;
  if (statusCode >= 200 && statusCode < 300 && !reply) {
    console.warn(`[support-chat] empty Groq content model=${model} snippet=${raw.slice(0, 400)}`);
  }
  return { reply, statusCode, data };
}

router.post("/chat", supportRateLimit, async (req, res) => {
  const rawMsg = req.body?.message;
  if (rawMsg == null || typeof rawMsg !== "string") {
    return res.status(400).json({ error: "message is required" });
  }
  const message = rawMsg.trim().slice(0, 4000);
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

  const userPayload = { platformContext, userQuestion: message };

  const apiKey = getSupportAiApiKey();
  const baseUrl = (process.env.SUPPORT_AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const primaryModel = (process.env.SUPPORT_AI_MODEL || "llama-3.1-8b-instant").trim();
  const fallbackModel = (process.env.SUPPORT_AI_MODEL_FALLBACK || "llama-3.3-70b-versatile").trim();

  if (!apiKey) {
    return res.json({
      configured: false,
      reply: buildSupportReply(
        platformContext,
        message,
        "Add SUPPORT_AI_API_KEY to this server for Groq AI replies (see backend/.env.example)."
      ),
      fallback: true,
    });
  }

  const models = [primaryModel, fallbackModel].filter(Boolean);
  const tried = new Set();
  for (const model of models) {
    if (tried.has(model)) continue;
    tried.add(model);
    const { reply, statusCode, data } = await tryGroqCompletion({
      apiKey,
      baseUrl,
      model,
      userPayload,
    });
    if (reply) {
      return res.json({ configured: true, reply, model });
    }
    const errMsg = data?.error?.message || "unknown";
    console.warn(`[support-chat] Groq model=${model} http=${statusCode}:`, errMsg);
  }

  const reply = buildSupportReply(platformContext, message);
  return res.json({ configured: true, reply, fallback: true });
});

export default router;
