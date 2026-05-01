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

/** Skip duplicate "listed" when both indexer DB row and listings API poller fire for the same listing. */
const listedAlertDedup = new Map();
const LISTED_DEDUP_MS = 300_000;

function shouldSendListedAlert(fields) {
  const tid = fields?.tokenId != null ? String(fields.tokenId) : "";
  const seller = fields?.seller ? String(fields.seller).trim().toLowerCase() : "";
  const priceWei = fields?.priceWei != null ? String(fields.priceWei) : "";
  const key = `listed:${tid}:${seller}:${priceWei}`;
  if (!tid || !seller) return true;
  const now = Date.now();
  const prev = listedAlertDedup.get(key);
  if (prev && now - prev < LISTED_DEDUP_MS) return false;
  listedAlertDedup.set(key, now);
  if (listedAlertDedup.size > 800) {
    for (const [k, t] of listedAlertDedup) {
      if (now - t > LISTED_DEDUP_MS) listedAlertDedup.delete(k);
    }
  }
  return true;
}

const maintenanceAlertDedup = new Map();
const MAINTENANCE_DEDUP_MS = 600_000;

function shouldSendMaintenanceAlert(fields) {
  const s = fields?.startsAt != null ? String(fields.startsAt) : "";
  const e = fields?.endsAt != null ? String(fields.endsAt) : "";
  const m = fields?.message != null ? String(fields.message) : "";
  const key = `maint:${s}|${e}|${m.slice(0, 200)}`;
  const now = Date.now();
  const prev = maintenanceAlertDedup.get(key);
  if (prev && now - prev < MAINTENANCE_DEDUP_MS) return false;
  maintenanceAlertDedup.set(key, now);
  if (maintenanceAlertDedup.size > 120) {
    for (const [k, t] of maintenanceAlertDedup) {
      if (now - t > MAINTENANCE_DEDUP_MS) maintenanceAlertDedup.delete(k);
    }
  }
  return true;
}

const maintenanceResumedDedup = new Map();
const MAINTENANCE_RESUMED_DEDUP_MS = 120_000;

function shouldSendMaintenanceResumedAlert() {
  const key = "maintenance_resumed";
  const now = Date.now();
  const prev = maintenanceResumedDedup.get(key);
  if (prev && now - prev < MAINTENANCE_RESUMED_DEDUP_MS) return false;
  maintenanceResumedDedup.set(key, now);
  if (maintenanceResumedDedup.size > 20) {
    for (const [k, t] of maintenanceResumedDedup) {
      if (now - t > MAINTENANCE_RESUMED_DEDUP_MS) maintenanceResumedDedup.delete(k);
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
 * @param {"user_joined"|"subscription"|"mint"|"listed"|"bought"|"maintenance"|"maintenance_resumed"} kind
 */
export async function notifyActivity(kind, fields) {
  const base = bridgeUrl();
  if (!base) return;
  if (kind === "bought" && !shouldSendBoughtAlert(fields)) return;
  if (kind === "listed" && !shouldSendListedAlert(fields)) return;
  if (kind === "maintenance" && !shouldSendMaintenanceAlert(fields)) return;
  if (kind === "maintenance_resumed" && !shouldSendMaintenanceResumedAlert()) return;
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
    console.log(
      `[telegram] Alerts forwarded to telegram-bot (${b}); sources: admin maintenance, DB poller, listings API poller, /api/telegram/alert`
    );
  } else {
    console.warn("[telegram] TELEGRAM_BRIDGE_URL not set — alerts off. Run `telegram-bot` and set e.g. http://127.0.0.1:3847");
  }
}
