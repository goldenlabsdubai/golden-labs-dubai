/**
 * Forwards alert payloads to the standalone `telegram-bot` process (HTTP bridge only).
 * No Telegram token, no message formatting here — see `telegram-bot/alertFormat.js`.
 */
function bridgeUrl() {
  let raw = (process.env.TELEGRAM_BRIDGE_URL || "").trim().replace(/\/$/, "");
  if (!raw) return "";
  try {
    const u = new URL(raw.includes("://") ? raw : `http://${raw}`);
    // Bridge listens on IPv4 loopback only; `localhost` often resolves to ::1 and fetch fails.
    if (u.hostname === "localhost") u.hostname = "127.0.0.1";
    return `${u.protocol}//${u.host}`.replace(/\/$/, "");
  } catch {
    return raw;
  }
}

/** Skip duplicate "bought" when both record-purchase and chain indexer fire (same tx). */
const boughtAlertDedup = new Map();
const Bought_DEDUP_MS = 120_000;

function shouldSendBoughtAlert(fields) {
  const txHash = fields?.txHash ? String(fields.txHash).trim().toLowerCase() : "";
  if (!txHash.startsWith("0x")) return true;
  const key = `bought:${txHash}`;
  const now = Date.now();
  const prev = boughtAlertDedup.get(key);
  if (prev && now - prev < Bought_DEDUP_MS) return false;
  boughtAlertDedup.set(key, now);
  if (boughtAlertDedup.size > 400) {
    for (const [k, t] of boughtAlertDedup) {
      if (now - t > Bought_DEDUP_MS) boughtAlertDedup.delete(k);
    }
  }
  return true;
}

export function isTelegramSendConfigured() {
  return Boolean(bridgeUrl());
}

async function postToTelegramBotBridge(payload) {
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
      body: JSON.stringify(payload),
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

/**
 * Raw text (e.g. POST /api/telegram/alert). Telegram-bot sends as-is.
 * @param {{ throwOnError?: boolean }} [options]
 */
export async function sendTelegramText(text, options = {}) {
  if (!bridgeUrl()) {
    if (options.throwOnError) throw new Error("Set TELEGRAM_BRIDGE_URL (run telegram-bot PM2 app)");
    return;
  }
  try {
    await postToTelegramBotBridge({ message: text });
  } catch (e) {
    console.warn("Telegram bridge:", e?.message || e);
    if (options.throwOnError) throw e;
  }
}

/**
 * Structured alert — formatted in telegram-bot from `kind` + fields.
 * @param {"user_joined"|"subscription"|"mint"|"listed"|"bought"} kind
 */
export async function notifyActivity(kind, fields) {
  const base = bridgeUrl();
  if (!base) return;
  if (kind === "bought" && !shouldSendBoughtAlert(fields)) return;
  try {
    await postToTelegramBotBridge({ kind, ...(fields && typeof fields === "object" ? fields : {}) });
    if ((process.env.TELEGRAM_DEBUG || "").trim() === "1") {
      console.log(`[telegram] forwarded ${kind} → ${base}/alert`);
    }
  } catch (e) {
    console.warn(`[telegram] bridge failed (${kind}):`, e?.message || e);
  }
}

export function logTelegramAlertsStatus() {
  const b = bridgeUrl();
  if (b) {
    console.log(`[telegram] Alerts forwarded to telegram-bot (${b}); sources: DB poller + /api/telegram/alert`);
  } else {
    console.warn("[telegram] TELEGRAM_BRIDGE_URL not set — alerts off. Run `telegram-bot` and set e.g. http://127.0.0.1:3847");
  }
}
