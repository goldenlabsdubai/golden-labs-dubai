/**
 * Telegram alerts driven from PostgreSQL (same data as the app): user_activities, users, marketplace_processed_sales.
 * Polls on an interval; cursors in meta.telegramDbNotifier avoid backfilling history on first boot.
 */
import { query, getPool } from "../config/postgres.js";
import { getMetaPg, setMetaPg } from "./metaPostgres.js";
import { isTelegramSendConfigured, notifyActivity } from "./telegramNotify.js";
import { isConfiguredBotWallet } from "./botService.js";

const META_KEY = "telegramDbNotifier";

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
  if (!getPool()) return;
  if (!isTelegramSendConfigured()) return;
  if ((process.env.TELEGRAM_DB_NOTIFIER || "1").trim() === "0") return;

  const state = await loadOrBootstrapState();
  let lastUaId = Number(state.lastUserActivityId) || 0;
  let lastUserCreatedAt = state.lastUserCreatedAt;
  let lastListedAt = state.lastListedNotifiedAt;

  const { rows: uaRows } = await query(
    `SELECT id, wallet, type, token_id, price, tx_hash FROM user_activities WHERE id > $1 ORDER BY id ASC LIMIT 100`,
    [lastUaId]
  );

  for (const r of uaRows) {
    lastUaId = r.id;
    const wallet = String(r.wallet || "").toLowerCase();
    const type = String(r.type || "").toLowerCase();
    if (!wallet) continue;

    if (isConfiguredBotWallet(wallet) && (type === "subscription" || type === "mint")) continue;

    if (type === "subscription") {
      await notifyActivity("subscription", { address: wallet, ...(r.tx_hash ? { txHash: r.tx_hash } : {}) });
    } else if (type === "mint") {
      await notifyActivity("mint", {
        address: wallet,
        ...(r.token_id != null && r.token_id !== "" ? { tokenId: String(r.token_id) } : {}),
        ...(r.tx_hash ? { txHash: r.tx_hash } : {}),
      });
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
        await notifyActivity("bought", {
          buyer: wallet,
          seller: seller || "",
          tokenId: String(r.token_id ?? ""),
          priceWei,
          ...(tx ? { txHash: tx } : {}),
        });
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
    await notifyActivity("user_joined", { address: w });
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
      await notifyActivity("listed", { seller, tokenId, priceWei });
    }
  }

  await setMetaPg(META_KEY, {
    lastUserActivityId: lastUaId,
    lastUserCreatedAt,
    lastListedNotifiedAt: lastListedAt,
  });
}

export function startTelegramActivityFromDbNotifier() {
  if ((process.env.TELEGRAM_DB_NOTIFIER || "1").trim() === "0") {
    console.log("[telegram] DB notifier disabled (TELEGRAM_DB_NOTIFIER=0)");
    return;
  }
  if (!isTelegramSendConfigured()) return;
  if (!getPool()) return;

  const ms = Math.max(5000, Math.min(Number(process.env.TELEGRAM_DB_NOTIFIER_MS) || 15000, 120000));

  runTelegramActivityFromDbNotifierOnce().catch((e) => console.warn("[telegram] db notifier:", e?.message || e));
  setInterval(() => {
    runTelegramActivityFromDbNotifierOnce().catch((e) => console.warn("[telegram] db notifier:", e?.message || e));
  }, ms);

  console.log(`[telegram] DB activity notifier polling every ${ms}ms`);
}
