/**
 * Public support chat — answers from an LLM grounded in server-side platform facts (no secrets).
 * Configure SUPPORT_AI_API_KEY (e.g. Groq free tier — OpenAI-compatible HTTP).
 */
import { Router } from "express";
import { ethers } from "ethers";
import { getSupportAiApiKey } from "../utils/supportAiKey.js";
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

/** When Groq/network fails, still answer from the same facts we send to the model (no LLM). */
function buildFallbackReply(platformContext, userQuestion) {
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

  parts.push("Quick summary from live platform data (full AI could not answer). Try again soon or use Telegram / email above.");
  return parts.join("\n\n");
}

async function tryGroqCompletion({ apiKey, baseUrl, model, userPayload }) {
  const TIMEOUT_MS = Math.min(
    Math.max(Number(process.env.SUPPORT_AI_TIMEOUT_MS) || 28000, 5000),
    120000
  );
  let resp;
  let raw = "";
  try {
    resp = await fetch(`${baseUrl}/chat/completions`, {
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    raw = await resp.text();
  } catch (e) {
    const name = e?.name || "";
    const msg = e?.message || String(e);
    console.warn(`[support-chat] fetch failed model=${model}:`, name, msg);
    return {
      resp: { ok: false, status: 0, statusText: "fetch_failed" },
      data: { error: { message: name === "AbortError" ? `timeout after ${TIMEOUT_MS}ms` : msg } },
      reply: null,
    };
  }

  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    data = { error: { message: `non-JSON response (${resp.status}): ${raw.slice(0, 180)}` } };
  }
  const choice = data?.choices?.[0];
  const reply = choice?.message?.content?.trim();
  if (resp.ok && !reply) {
    console.warn(
      `[support-chat] empty content model=${model} finish=${choice?.finish_reason || "?"} snippet=${raw.slice(0, 400)}`
    );
  }
  return { resp, data, reply };
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

  const apiKey = getSupportAiApiKey();
  const baseUrl = (process.env.SUPPORT_AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const primaryModel = (process.env.SUPPORT_AI_MODEL || "llama-3.1-8b-instant").trim();
  const fallbackModel = (process.env.SUPPORT_AI_MODEL_FALLBACK || "llama-3.3-70b-versatile").trim();

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
    const models = [primaryModel, fallbackModel].filter(Boolean);
    const tried = new Set();
    const debugSupport = String(process.env.SUPPORT_AI_DEBUG || "").trim() === "1";
    const attempts = [];
    for (const model of models) {
      if (tried.has(model)) continue;
      tried.add(model);
      const { resp, data, reply } = await tryGroqCompletion({
        apiKey,
        baseUrl,
        model,
        userPayload,
      });
      if (debugSupport) {
        attempts.push({
          model,
          httpStatus: resp.status,
          error: data?.error?.message || null,
          finishReason: data?.choices?.[0]?.finish_reason ?? null,
        });
      }
      if (reply) {
        const out = { configured: true, reply, model };
        if (debugSupport) out.debug = { attempts };
        return res.json(out);
      }
      const errMsg = data?.error?.message || data?.message || resp.statusText || "unknown";
      console.warn(`[support-chat] provider model=${model} status=${resp.status}:`, errMsg);
    }

    const fallbackReply = buildFallbackReply(platformContext, message);
    const out = {
      configured: true,
      reply: fallbackReply,
      fallback: true,
    };
    if (debugSupport) out.debug = { attempts };
    return res.json(out);
  } catch (e) {
    console.warn("[support-chat]", e?.message || e);
    const fallbackReply = buildFallbackReply(platformContext, message);
    const out = {
      configured: true,
      reply: fallbackReply,
      fallback: true,
    };
    if (String(process.env.SUPPORT_AI_DEBUG || "").trim() === "1") {
      out.debug = { error: e?.message || String(e) };
    }
    return res.json(out);
  }
});

export default router;
