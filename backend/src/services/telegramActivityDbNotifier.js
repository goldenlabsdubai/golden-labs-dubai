/**
 * Telegram alerts driven from PostgreSQL (same data as the app): user_activities, users, marketplace_processed_sales.
 * Also polls GET /api/marketplace/listings (same on-chain source as the app) so "listed" alerts still fire if the chain indexer lags or misses events.
 *
 * Polls on an interval; cursors in meta.telegramDbNotifier avoid backfilling history on first boot.
 */
import { query, getPool } from "../config/postgres.js";
import { getMetaPg, setMetaPg } from "./metaPostgres.js";
import { isTelegramSendConfigured, notifyActivity } from "./telegramNotify.js";
import { isConfiguredBotWallet } from "./botService.js";

const META_KEY = "telegramDbNotifier";
/** Snapshot of active listing tokenIds to diff new listings (aligned with /api/marketplace/listings). */
const META_LISTINGS_API = "telegramListingsApiPoller";

/** Default 24h — poller skips subscription/mint/buy/sell/user_joined/listed when activity time is older (stale after cursor/meta bugs). Set TELEGRAM_POLLER_MAX_EVENT_AGE_MS=0 to disable. */
const DEFAULT_POLLER_MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;

function pollerMaxEventAgeMs() {
  const raw = (process.env.TELEGRAM_POLLER_MAX_EVENT_AGE_MS ?? "").trim();
  if (raw === "") return DEFAULT_POLLER_MAX_EVENT_AGE_MS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_POLLER_MAX_EVENT_AGE_MS;
  if (n <= 0) return Infinity;
  return n;
}

/**
 * @param {Date|string|number|null|undefined} v
 * @returns {number|null} epoch ms
 */
function eventTimeMs(v) {
  if (v == null) return null;
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return v > 1e12 ? v : v * 1000;
  }
  const d = new Date(String(v));
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

/** @param {Date|string|number|null|undefined} timeSource */
function isPollerEventFresh(timeSource) {
  const maxAge = pollerMaxEventAgeMs();
  if (maxAge === Infinity) return true;
  const t = eventTimeMs(timeSource);
  if (t == null) return true;
  return Date.now() - t <= maxAge;
}

function debugPollerSkip(label, detail) {
  if ((process.env.TELEGRAM_DEBUG || "").trim() === "1") {
    console.log(`[telegram] poller skip (stale or no time): ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function toIso(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

async function loadOrBootstrapState() {
  let state = await getMetaPg(META_KEY);
  if (!state || typeof state !== "object") state = {};

  const needUa = state.lastUserActivityId == null;
  const needUsers = state.lastUserCreatedAt == null;
  const needListed = state.lastListedNotifiedAt == null;
  if (!needUa && !needUsers && !needListed) return state;

  if (needUa) {
    const { rows } = await query("SELECT COALESCE(MAX(id), 0)::bigint AS m FROM user_activities");
    state.lastUserActivityId = Number(rows[0]?.m || 0);
  }
  if (needUsers) {
    const { rows } = await query("SELECT MAX(created_at) AS m FROM users");
    state.lastUserCreatedAt = toIso(rows[0]?.m) || new Date().toISOString();
  }
  if (needListed) {
    const { rows } = await query(
      "SELECT MAX(created_at) AS m FROM marketplace_processed_sales WHERE COALESCE(payload->>'type','') = 'listed'"
    );
    state.lastListedNotifiedAt = toIso(rows[0]?.m) || new Date().toISOString();
  }

  await setMetaPg(META_KEY, state);
  return state;
}

export async function runTelegramActivityFromDbNotifierOnce() {
  if (!isTelegramSendConfigured()) return;

  const dbNotifierOn = (process.env.TELEGRAM_DB_NOTIFIER || "1").trim() !== "0";

  if (getPool() && dbNotifierOn) {
    const state = await loadOrBootstrapState();
    let lastUaId = Number(state.lastUserActivityId) || 0;
    let lastUserCreatedAt = state.lastUserCreatedAt;
    let lastListedAt = state.lastListedNotifiedAt;

    const { rows: uaRows } = await query(
      `SELECT id, wallet, type, token_id, price, tx_hash, created_at FROM user_activities WHERE id > $1 ORDER BY id ASC LIMIT 100`,
      [lastUaId]
    );

    for (const r of uaRows) {
      lastUaId = r.id;
      const wallet = String(r.wallet || "").toLowerCase();
      const type = String(r.type || "").toLowerCase();
      if (!wallet) continue;

      if (isConfiguredBotWallet(wallet) && (type === "subscription" || type === "mint")) continue;

      const freshUa = isPollerEventFresh(r.created_at);
      if (!freshUa) {
        debugPollerSkip(`user_activities id=${r.id} type=${type}`, String(r.created_at ?? ""));
      }

      if (type === "subscription") {
        if (freshUa) {
          await notifyActivity("subscription", { address: wallet, ...(r.tx_hash ? { txHash: r.tx_hash } : {}) });
        }
      } else if (type === "mint") {
        if (freshUa) {
          await notifyActivity("mint", {
            address: wallet,
            ...(r.token_id != null && r.token_id !== "" ? { tokenId: String(r.token_id) } : {}),
            ...(r.tx_hash ? { txHash: r.tx_hash } : {}),
          });
        }
      } else if (type === "buy") {
        const tx = r.tx_hash ? String(r.tx_hash).trim() : "";
        let seller = "";
        let priceWei = r.price != null ? String(r.price) : "0";
        if (tx) {
          const pr = await query(`SELECT seller, price FROM nft_purchases WHERE tx_hash = $1 LIMIT 1`, [tx]);
          if (pr.rows[0]) {
            seller = String(pr.rows[0].seller || "").toLowerCase();
            if (pr.rows[0].price != null) priceWei = String(pr.rows[0].price);
          }
        }
        const buyerBot = isConfiguredBotWallet(wallet);
        const sellerBot = Boolean(seller) && isConfiguredBotWallet(seller);
        if (!(buyerBot && sellerBot)) {
          if (freshUa) {
            await notifyActivity("bought", {
              buyer: wallet,
              seller: seller || "",
              tokenId: String(r.token_id ?? ""),
              priceWei,
              ...(tx ? { txHash: tx } : {}),
            });
          }
        }
      } else if (type === "sell") {
        const tx = r.tx_hash ? String(r.tx_hash).trim() : "";
        let buyer = "";
        let priceWei = r.price != null ? String(r.price) : "0";
        if (tx) {
          const pr = await query(`SELECT buyer, price FROM nft_purchases WHERE tx_hash = $1 LIMIT 1`, [tx]);
          if (pr.rows[0]) {
            buyer = String(pr.rows[0].buyer || "").toLowerCase();
            if (pr.rows[0].price != null) priceWei = String(pr.rows[0].price);
          }
        }
        const seller = wallet;
        const buyerBot = Boolean(buyer) && isConfiguredBotWallet(buyer);
        const sellerBot = isConfiguredBotWallet(seller);
        if (!(buyerBot && sellerBot)) {
          if (freshUa) {
            await notifyActivity("sold", {
              seller,
              buyer: buyer || "",
              tokenId: String(r.token_id ?? ""),
              priceWei,
              ...(tx ? { txHash: tx } : {}),
            });
          }
        }
      }
    }

    const { rows: newUsers } = await query(
      `SELECT wallet, created_at FROM users WHERE created_at > $1::timestamptz ORDER BY created_at ASC LIMIT 50`,
      [lastUserCreatedAt]
    );
    for (const u of newUsers) {
      const w = String(u.wallet || "").toLowerCase();
      const ca = toIso(u.created_at);
      if (ca) lastUserCreatedAt = ca;
      if (!w.startsWith("0x")) continue;
      if (isConfiguredBotWallet(w)) continue;
      if (isPollerEventFresh(u.created_at)) {
        await notifyActivity("user_joined", { address: w });
      } else {
        debugPollerSkip("user_joined", ca || "");
      }
    }

    const { rows: listedRows } = await query(
      `SELECT payload, created_at FROM marketplace_processed_sales
       WHERE COALESCE(payload->>'type','') = 'listed' AND created_at > $1::timestamptz
       ORDER BY created_at ASC LIMIT 50`,
      [lastListedAt]
    );
    for (const row of listedRows) {
      const ca = toIso(row.created_at);
      if (ca) lastListedAt = ca;
      const p = row.payload;
      const seller = p?.seller ? String(p.seller).toLowerCase() : "";
      const tokenId = p?.tokenId != null ? String(p.tokenId) : "";
      const priceWei = p?.price != null ? String(p.price) : "";
      if (seller && tokenId) {
        if (isPollerEventFresh(row.created_at)) {
          await notifyActivity("listed", { seller, tokenId, priceWei });
        } else {
          debugPollerSkip("listed (marketplace_processed_sales)", ca || "");
        }
      }
    }

    await setMetaPg(META_KEY, {
      lastUserActivityId: lastUaId,
      lastUserCreatedAt,
      lastListedNotifiedAt: lastListedAt,
    });
  }

  if (getPool()) {
    await runListingsFromMarketplaceApiOnce().catch((e) =>
      console.warn("[telegram] listings API poller:", e?.message || e)
    );
  }
}

function listingsApiPollerEnabled() {
  return (process.env.TELEGRAM_LISTINGS_FROM_API || "1").trim() !== "0";
}

/**
 * Diff current active marketplace listings against last snapshot; notify for newly appeared tokenIds.
 * First successful poll only seeds the snapshot (no spam). TELEGRAM_LISTINGS_FROM_API=0 disables.
 */
async function runListingsFromMarketplaceApiOnce() {
  if (!listingsApiPollerEnabled()) return;

  const port = Number(process.env.PORT) || 3001;
  const url = `http://127.0.0.1:${port}/api/marketplace/listings`;
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 45_000);
  let json;
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) {
      console.warn(`[telegram] listings API poller: ${res.status} ${res.statusText}`);
      return;
    }
    json = await res.json();
  } finally {
    clearTimeout(to);
  }

  const listings = Array.isArray(json?.listings) ? json.listings : [];
  const knownRaw = (await getMetaPg(META_LISTINGS_API)) || {};
  const knownObj =
    knownRaw.knownTokenIds && typeof knownRaw.knownTokenIds === "object" ? knownRaw.knownTokenIds : {};
  const prev = new Set(Object.keys(knownObj));

  if (!knownRaw.bootstrapped) {
    const nextKnown = Object.fromEntries(listings.map((l) => [String(l.tokenId), true]));
    await setMetaPg(META_LISTINGS_API, { v: 1, bootstrapped: true, knownTokenIds: nextKnown });
    console.log(
      `[telegram] listings API poller: bootstrapped (${listings.length} active); no past alerts sent`
    );
    return;
  }

  if (prev.size === 0 && listings.length > 0) {
    const nextKnown = Object.fromEntries(listings.map((l) => [String(l.tokenId), true]));
    await setMetaPg(META_LISTINGS_API, { v: 1, bootstrapped: true, knownTokenIds: nextKnown });
    console.warn(
      "[telegram] listings API poller: repaired empty knownTokenIds (would have alerted every listing); snapshot re-seeded, no Telegram spam"
    );
    return;
  }

  const nextKnown = {};
  for (const l of listings) {
    const tid = l?.tokenId != null ? String(l.tokenId) : "";
    if (tid) nextKnown[tid] = true;
  }

  for (const l of listings) {
    const tid = l?.tokenId != null ? String(l.tokenId) : "";
    if (!tid || prev.has(tid)) continue;
    const seller = String(l.seller || "").trim().toLowerCase();
    if (!seller.startsWith("0x")) continue;
    const priceWei = l.price != null ? String(l.price) : "0";
    const listedAtMs = Number(l.listedAt);
    if (!Number.isFinite(listedAtMs) || listedAtMs <= 0) {
      debugPollerSkip(`listed API token ${tid}`, "no listedAt from API");
      continue;
    }
    if (!isPollerEventFresh(listedAtMs)) {
      debugPollerSkip(`listed API token ${tid}`, `listedAt=${listedAtMs}`);
      continue;
    }
    await notifyActivity("listed", { seller, tokenId: tid, priceWei });
  }

  await setMetaPg(META_LISTINGS_API, { v: 1, bootstrapped: true, knownTokenIds: nextKnown });
}

export function startTelegramActivityFromDbNotifier() {
  if (!isTelegramSendConfigured()) return;
  if (!getPool()) {
    console.warn("[telegram] PostgreSQL required for activity notifier + listings snapshot meta");
    return;
  }

  const dbOff = (process.env.TELEGRAM_DB_NOTIFIER || "1").trim() === "0";
  if (dbOff && !listingsApiPollerEnabled()) {
    console.log("[telegram] TELEGRAM_DB_NOTIFIER=0 and TELEGRAM_LISTINGS_FROM_API=0 — telegram polling off");
    return;
  }
  if (dbOff) {
    console.log("[telegram] DB notifier disabled (TELEGRAM_DB_NOTIFIER=0); listings API poller still runs");
  }

  const ms = Math.max(5000, Math.min(Number(process.env.TELEGRAM_DB_NOTIFIER_MS) || 15000, 120000));

  const maxAge = pollerMaxEventAgeMs();
  if (maxAge === Infinity) {
    console.log("[telegram] Poller stale guard off (TELEGRAM_POLLER_MAX_EVENT_AGE_MS=0)");
  } else {
    console.log(
      `[telegram] Poller stale guard: events older than ${Math.round(maxAge / 1000)}s skipped (TELEGRAM_POLLER_MAX_EVENT_AGE_MS)`
    );
  }

  runTelegramActivityFromDbNotifierOnce().catch((e) => console.warn("[telegram] db notifier:", e?.message || e));
  setInterval(() => {
    runTelegramActivityFromDbNotifierOnce().catch((e) => console.warn("[telegram] db notifier:", e?.message || e));
  }, ms);

  console.log(`[telegram] Telegram activity polling every ${ms}ms (DB + listings API)`);
}
