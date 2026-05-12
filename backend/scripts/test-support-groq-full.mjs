/**
 * Calls Groq **directly** (https://api.groq.com) using SUPPORT_AI_API_KEY from this folder's `.env`.
 *
 * - HTTP **401 invalid_api_key** = that key is wrong, revoked, or not a Groq key → create a new one at
 *   https://console.groq.com/keys and update SUPPORT_AI_API_KEY, then restart the backend.
 * - This does **not** test https://api.goldenlabs.finance — for that run `npm run test-support-chat-url`.
 *
 * Usage (from backend/): npm run test-support-ai
 */
import dotenv from "dotenv";
dotenv.config({ override: true });

import { ethers } from "ethers";
import { getDeployedContractsSnapshot } from "../src/config/contractsEnv.js";
import { getSubscriptionPriceFromChain } from "../src/services/onChainUser.js";
import { USDT_DECIMALS } from "../src/constants/usdtDecimals.js";

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
      const nft = new ethers.Contract(contractAddress, ["function mintPrice() view returns (uint256)"], provider);
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
- If platformContext.community includes telegramUrl and/or supportEmail, you may share those for the official Telegram community and email support. Do not invent other emails, links, or "official" accounts.
- Gas is paid in BNB; in-app USDT payments use BEP20 USDT on BSC unless context says otherwise.`;

async function main() {
  const apiKey = (process.env.SUPPORT_AI_API_KEY || "").trim();
  const baseUrl = (process.env.SUPPORT_AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const model = (process.env.SUPPORT_AI_MODEL || "llama-3.1-8b-instant").trim();
  if (!apiKey) {
    console.error("SUPPORT_AI_API_KEY is empty — set it in .env or the shell.");
    process.exit(1);
  }

  const platformContext = await buildPlatformContext();
  const userPayload = { platformContext, userQuestion: "hi" };
  const userContent = `Answer using only platformContext + general safe wallet hygiene.\n\n${JSON.stringify(userPayload)}`;

  const body = {
    model,
    temperature: 0.35,
    max_tokens: 600,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
  };

  console.log("POST", `${baseUrl}/chat/completions`, "bytes", JSON.stringify(body).length);

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const raw = await resp.text();
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    console.error("Non-JSON body:", raw.slice(0, 500));
    process.exit(1);
  }

  console.log("HTTP", resp.status);
  if (!resp.ok) {
    console.error("Error:", data?.error || data);
    process.exit(1);
  }
  const reply = data?.choices?.[0]?.message?.content?.trim();
  if (!reply) {
    console.error("Empty choices[0].message.content:", JSON.stringify(data).slice(0, 800));
    process.exit(1);
  }
  console.log("Reply preview:\n", reply.slice(0, 600));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
