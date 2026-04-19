/**
 * Telegram activity alerts — wallet addresses only (no usernames / display names).
 *
 * Sends text either:
 * 1) Preferred: HTTP POST to the standalone `telegram-bot` process (TELEGRAM_BRIDGE_URL),
 *    so only that PM2 app holds TELEGRAM_BOT_TOKEN and talks to Telegram API.
 * 2) Legacy: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID on this backend (direct send).
 */
import TelegramBot from "node-telegram-bot-api";

let directBot = null;

function getDirectBot() {
  const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) return null;
  if (!directBot) directBot = new TelegramBot(token, { polling: false });
  return directBot;
}

function bridgeUrl() {
  return (process.env.TELEGRAM_BRIDGE_URL || "").trim().replace(/\/$/, "");
}

function canSendViaBridge() {
  return Boolean(bridgeUrl());
}

function canSendDirect() {
  return Boolean(getDirectBot() && (process.env.TELEGRAM_CHAT_ID || "").trim());
}

function canSend() {
  return canSendViaBridge() || canSendDirect();
}

/** True if alerts can be sent (bridge URL and/or direct token+chat). */
export function isTelegramSendConfigured() {
  return canSend();
}

async function postToTelegramBotBridge(message) {
  const base = bridgeUrl();
  const url = `${base}/alert`;
  const secret = (process.env.TELEGRAM_BRIDGE_SECRET || "").trim();
  const headers = {
    "Content-Type": "application/json",
    ...(secret ? { "X-Telegram-Bridge-Secret": secret } : {}),
  };
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ message }),
      signal: ac.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Bridge ${res.status}: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(t);
  }
}

function addr(a) {
  if (a == null || a === "") return "";
  const s = String(a).trim().toLowerCase();
  return s.startsWith("0x") ? s : s;
}

function formatUsdtFromWei6(weiStr) {
  try {
    const n = BigInt(weiStr || 0);
    const whole = n / 1000000n;
    const frac = Number(n % 1000000n) / 1e6;
    const num = Number(whole) + frac;
    return `${num.toFixed(2)} USDT`;
  } catch {
    return String(weiStr || "0");
  }
}

/**
 * @param {"user_joined"|"subscription"|"mint"|"listed"|"bought"} kind
 * @param {Record<string, string|null|undefined>} fields
 */
export function formatActivityMessage(kind, fields) {
  const lines = [];
  switch (kind) {
    case "user_joined":
      lines.push("🔔 New user joined", `Address: ${addr(fields.address)}`);
      break;
    case "subscription":
      lines.push("🔔 Subscription", `Address: ${addr(fields.address)}`);
      if (fields.txHash) lines.push(`TX: ${fields.txHash}`);
      break;
    case "mint":
      lines.push("🔔 NFT minted", `Address: ${addr(fields.address)}`);
      if (fields.tokenId != null && fields.tokenId !== "") lines.push(`Token ID: ${fields.tokenId}`);
      if (fields.txHash) lines.push(`TX: ${fields.txHash}`);
      break;
    case "listed":
      lines.push(
        "🔔 NFT listed",
        `Seller: ${addr(fields.seller)}`,
        `Token ID: ${fields.tokenId != null ? String(fields.tokenId) : "—"}`,
        `Price: ${fields.priceWei != null ? formatUsdtFromWei6(String(fields.priceWei)) : "—"}`
      );
      break;
    case "bought":
      lines.push(
        "🔔 NFT bought",
        `Buyer: ${addr(fields.buyer)}`,
        `Seller: ${addr(fields.seller)}`,
        `Token ID: ${fields.tokenId != null ? String(fields.tokenId) : "—"}`,
        `Price: ${fields.priceWei != null ? formatUsdtFromWei6(String(fields.priceWei)) : "—"}`
      );
      if (fields.txHash) lines.push(`TX: ${fields.txHash}`);
      break;
    default:
      lines.push("🔔 Activity", JSON.stringify(fields));
  }
  return lines.filter(Boolean).join("\n");
}

/**
 * @param {{ throwOnError?: boolean }} [options] - use throwOnError for HTTP handlers that must surface failures
 */
export async function sendTelegramText(text, options = {}) {
  if (!canSend()) {
    if (options.throwOnError) throw new Error("Telegram not configured (set TELEGRAM_BRIDGE_URL or TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)");
    return;
  }
  try {
    if (canSendViaBridge()) {
      await postToTelegramBotBridge(text);
      return;
    }
    const chatId = (process.env.TELEGRAM_CHAT_ID || "").trim();
    await getDirectBot().sendMessage(chatId, text);
  } catch (e) {
    console.warn("Telegram notify:", e?.message || e);
    if (options.throwOnError) throw e;
  }
}

/**
 * @param {"user_joined"|"subscription"|"mint"|"listed"|"bought"} kind
 * @param {Record<string, string|null|undefined>} fields
 */
export async function notifyActivity(kind, fields) {
  const t = formatActivityMessage(kind, fields);
  await sendTelegramText(t);
}

/** Call once on server startup so logs show whether Telegram is wired for alerts. */
export function logTelegramAlertsStatus() {
  const bridge = bridgeUrl();
  const direct = canSendDirect();
  if (bridge) {
    console.log(`[telegram] Activity alerts: enabled via bridge (${bridge})`);
  } else if (direct) {
    console.log("[telegram] Activity alerts: enabled (direct API on backend — legacy)");
  } else {
    console.warn(
      "[telegram] Activity alerts: DISABLED — set TELEGRAM_BRIDGE_URL=http://127.0.0.1:3847 " +
        "to use the PM2 telegram-bot, or set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID on the backend."
    );
  }
}
