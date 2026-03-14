/**
 * User data in PostgreSQL (RDS). Same API as userFirestore for drop-in replacement.
 * Requires PGHOST, PGDATABASE, PGUSER in .env.
 */
import { query, getPool, getClient } from "../config/postgres.js";

function docIdWallet(wallet) {
  return (wallet || "").toLowerCase();
}
function docIdFirebase(uid) {
  return uid ? `firebase_${uid}` : null;
}

function rowToUser(r) {
  if (!r) return null;
  const ids = r.owned_token_ids;
  const arr = Array.isArray(ids) ? ids : typeof ids === "string" ? (() => { try { return JSON.parse(ids); } catch { return []; } })() : [];
  return {
    id: r.id,
    wallet: r.wallet ?? null,
    firebaseUid: r.firebase_uid ?? null,
    email: r.email ?? null,
    username: r.username ?? null,
    name: r.name ?? null,
    bio: r.bio ?? null,
    avatar: r.avatar ?? null,
    websiteUrl: r.website_url ?? null,
    xUrl: r.x_url ?? null,
    telegramUrl: r.telegram_url ?? null,
    totalTrades: typeof r.total_trades === "number" ? r.total_trades : 0,
    nonce: r.nonce ?? null,
    state: r.state ?? "CONNECTED",
    referrer: r.referrer ?? null,
    referralCountL1: r.referral_count_l1 ?? 0,
    referralCountL2: r.referral_count_l2 ?? 0,
    referralCountL3: r.referral_count_l3 ?? 0,
    referralCountL4: r.referral_count_l4 ?? 0,
    referralCountL5: r.referral_count_l5 ?? 0,
    totalReferrals: (r.total_referrals ?? 0) || ((r.referral_count_l1 ?? 0) + (r.referral_count_l2 ?? 0) + (r.referral_count_l3 ?? 0) + (r.referral_count_l4 ?? 0) + (r.referral_count_l5 ?? 0)),
    referralEarningsL1: String(r.referral_earnings_l1 ?? "0"),
    referralEarningsL2: String(r.referral_earnings_l2 ?? "0"),
    referralEarningsL3: String(r.referral_earnings_l3 ?? "0"),
    referralEarningsL4: String(r.referral_earnings_l4 ?? "0"),
    referralEarningsL5: String(r.referral_earnings_l5 ?? "0"),
    referralEarningsTotal: String(r.referral_earnings_total ?? "0"),
    lastActivity: r.last_activity,
    createdAt: r.created_at,
    ownedTokenIds: arr.map((x) => String(x)),
  };
}

export async function getUserByWallet(wallet) {
  const id = docIdWallet(wallet);
  if (!id) return null;
  const { rows } = await query("SELECT * FROM users WHERE id = $1", [id]);
  return rows[0] ? rowToUser(rows[0]) : null;
}

export async function getUserByFirebaseUid(uid) {
  if (!uid) return null;
  const { rows } = await query("SELECT * FROM users WHERE firebase_uid = $1", [uid]);
  return rows[0] ? rowToUser(rows[0]) : null;
}

export async function createUser(data) {
  const id = data.wallet ? docIdWallet(data.wallet) : docIdFirebase(data.firebaseUid);
  if (!id) throw new Error("wallet or firebaseUid required");
  const now = new Date().toISOString();
  await query(
    `INSERT INTO users (id, wallet, firebase_uid, email, username, name, bio, avatar, website_url, x_url, telegram_url,
      total_trades, nonce, state, referrer, referral_count_l1, referral_count_l2, referral_count_l3, referral_count_l4, referral_count_l5,
      total_referrals, referral_earnings_l1, referral_earnings_l2, referral_earnings_l3, referral_earnings_l4, referral_earnings_l5, referral_earnings_total,
      last_activity, created_at, owned_token_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28::timestamptz, $29::timestamptz, '[]'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      data.wallet ?? null,
      data.firebaseUid ?? null,
      data.email ?? null,
      data.username ?? null,
      data.name ?? null,
      data.bio ?? null,
      data.avatar ?? null,
      data.websiteUrl ?? null,
      data.xUrl ?? null,
      data.telegramUrl ?? null,
      typeof data.totalTrades === "number" ? data.totalTrades : 0,
      data.nonce ?? null,
      data.state ?? "CONNECTED",
      data.referrer ?? null,
      0, 0, 0, 0, 0, 0,
      "0", "0", "0", "0", "0", "0",
      now, now,
    ]
  );
  const user = (data.wallet ? await getUserByWallet(data.wallet) : null) || (data.firebaseUid ? await getUserByFirebaseUid(data.firebaseUid) : null);
  return user ? { id: user.id, ...user } : { id };
}

export async function updateUser(docId, data) {
  const updates = [];
  const vals = [];
  let i = 1;
  const map = {
    wallet: "wallet", firebaseUid: "firebase_uid", email: "email", username: "username", name: "name", bio: "bio",
    avatar: "avatar", websiteUrl: "website_url", xUrl: "x_url", telegramUrl: "telegram_url",
    totalTrades: "total_trades", nonce: "nonce", state: "state", referrer: "referrer",
    referralCountL1: "referral_count_l1", referralCountL2: "referral_count_l2", referralCountL3: "referral_count_l3",
    referralCountL4: "referral_count_l4", referralCountL5: "referral_count_l5", totalReferrals: "total_referrals",
    referralEarningsL1: "referral_earnings_l1", referralEarningsL2: "referral_earnings_l2", referralEarningsL3: "referral_earnings_l3",
    referralEarningsL4: "referral_earnings_l4", referralEarningsL5: "referral_earnings_l5", referralEarningsTotal: "referral_earnings_total",
    lastActivity: "last_activity", ownedTokenIds: "owned_token_ids",
  };
  const now = new Date().toISOString();
  if (data.lastActivity === undefined) data = { ...data, lastActivity: now };
  for (const [k, col] of Object.entries(map)) {
    if (data[k] === undefined) continue;
    if (col === "last_activity" || col === "created_at") {
      updates.push(`${col} = $${i}::timestamptz`);
      vals.push(data[k] instanceof Date ? data[k].toISOString() : data[k]);
    } else if (col === "owned_token_ids") {
      updates.push(`${col} = $${i}::jsonb`);
      vals.push(JSON.stringify(Array.isArray(data[k]) ? data[k] : []));
    } else {
      updates.push(`${col} = $${i}`);
      vals.push(data[k]);
    }
    i++;
  }
  if (updates.length === 0) {
    const u = await getUserByWallet(docId) || await getUserByFirebaseUid(null);
    if (!u) { const r = await query("SELECT * FROM users WHERE id = $1", [docId]); return r.rows[0] ? rowToUser(r.rows[0]) : null; }
    return u;
  }
  vals.push(docId);
  await query(`UPDATE users SET ${updates.join(", ")} WHERE id = $${i}`, vals);
  const r = await query("SELECT * FROM users WHERE id = $1", [docId]);
  return r.rows[0] ? rowToUser(r.rows[0]) : null;
}

export async function findUserByUsername(username) {
  const n = (username || "").trim().toLowerCase();
  if (!n) return null;
  const { rows } = await query("SELECT * FROM users WHERE LOWER(username) = $1 LIMIT 1", [n]);
  return rows[0] ? rowToUser(rows[0]) : null;
}

export async function getUser(req) {
  if (req.wallet) return getUserByWallet(req.wallet);
  if (req.firebaseUid) return getUserByFirebaseUid(req.firebaseUid);
  return null;
}

export function getDocId(req) {
  if (req.wallet) return docIdWallet(req.wallet);
  if (req.firebaseUid) return docIdFirebase(req.firebaseUid);
  return null;
}

export async function getTopSellers(limit = 10) {
  const { rows } = await query(
    "SELECT * FROM users ORDER BY total_trades DESC NULLS LAST LIMIT $1",
    [Math.max(1, Math.min(Number(limit) || 10, 100))]
  );
  return rows.map((r, index) => {
    const u = rowToUser(r);
    return {
      rank: index + 1,
      username: u.username || (u.wallet ? u.wallet.slice(0, 8) + "…" : "Anonymous"),
      trades: u.totalTrades,
      referrals: u.totalReferrals ?? 0,
      earnings: u.referralEarningsTotal ?? "0",
      avatar: u.avatar || null,
      wallet: u.wallet || null,
    };
  });
}

export async function incrementUserTrades(wallet) {
  const id = docIdWallet(wallet);
  if (!id) throw new Error("wallet required");
  await query(
    `INSERT INTO users (id, wallet, total_trades, last_activity, created_at) VALUES ($1, $2, 1, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET total_trades = users.total_trades + 1, last_activity = NOW()`,
    [id, wallet]
  );
  const u = await getUserByWallet(wallet);
  return u?.totalTrades ?? 1;
}

export async function incrementReferralChain(referrerWallet) {
  if (!referrerWallet || typeof referrerWallet !== "string") return;
  const wallet = referrerWallet.toLowerCase().replace(/^0x/, "") ? referrerWallet.toLowerCase() : null;
  if (!wallet) return;
  const levels = ["referral_count_l1", "referral_count_l2", "referral_count_l3", "referral_count_l4", "referral_count_l5"];
  let currentWallet = wallet;
  for (let level = 0; level < levels.length; level++) {
    const id = docIdWallet(currentWallet);
    if (!id) break;
    const { rows } = await query("SELECT * FROM users WHERE id = $1", [id]);
    if (rows.length === 0) break;
    const r = rows[0];
    const key = levels[level];
    const current = r[key] ?? 0;
    const totalRef = (r.total_referrals ?? 0) || ((r.referral_count_l1 ?? 0) + (r.referral_count_l2 ?? 0) + (r.referral_count_l3 ?? 0) + (r.referral_count_l4 ?? 0) + (r.referral_count_l5 ?? 0));
    await query(
      `UPDATE users SET ${key} = $1, total_referrals = $2, last_activity = NOW() WHERE id = $3`,
      [current + 1, totalRef + 1, id]
    );
    const next = r.referrer;
    if (!next || typeof next !== "string") break;
    currentWallet = next.toLowerCase();
  }
}

function addBigIntStrings(a, b) {
  return (BigInt(a || "0") + BigInt(b || "0")).toString();
}

export async function addReferralEarning(referrerWallet, level, amount) {
  if (!referrerWallet || level < 1 || level > 5) return;
  const docId = docIdWallet(referrerWallet);
  if (!docId) return;
  const delta = typeof amount === "bigint" ? amount.toString() : String(amount || "0");
  const col = `referral_earnings_l${level}`;
  const { rows } = await query("SELECT referral_earnings_l1, referral_earnings_l2, referral_earnings_l3, referral_earnings_l4, referral_earnings_l5, referral_earnings_total FROM users WHERE id = $1", [docId]);
  if (rows.length > 0) {
    const r = rows[0];
    await query(
      `UPDATE users SET ${col} = $1, referral_earnings_total = $2, last_activity = NOW() WHERE id = $3`,
      [addBigIntStrings(r[col] ?? "0", delta), addBigIntStrings(r.referral_earnings_total ?? "0", delta), docId]
    );
  } else {
    await query(
      `INSERT INTO users (id, wallet, ${col}, referral_earnings_total, last_activity, created_at)
       VALUES ($1, $2, $3, $3, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET ${col} = (COALESCE(users.${col}, '0')::numeric + $3::numeric)::text, referral_earnings_total = (COALESCE(users.referral_earnings_total, '0')::numeric + $3::numeric)::text, last_activity = NOW()`,
      [docId, referrerWallet, delta]
    );
  }
}

export async function setReferralEarningsTotalAtLeast(wallet, amount) {
  if (!wallet || amount == null) return;
  const id = docIdWallet(wallet);
  if (!id) return;
  const { rows } = await query("SELECT referral_earnings_total FROM users WHERE id = $1", [id]);
  const current = rows[0]?.referral_earnings_total ?? "0";
  const amountStr = typeof amount === "bigint" ? amount.toString() : String(amount);
  if (BigInt(amountStr) <= BigInt(current)) return;
  await query("UPDATE users SET referral_earnings_total = $1, last_activity = NOW() WHERE id = $2", [amountStr, id]);
}

export async function setReferralEarningsL1AtLeast(wallet, amount) {
  if (!wallet || amount == null) return;
  const id = docIdWallet(wallet);
  if (!id) return;
  const { rows } = await query("SELECT referral_earnings_l1 FROM users WHERE id = $1", [id]);
  const current = rows[0]?.referral_earnings_l1 ?? "0";
  const amountStr = typeof amount === "bigint" ? amount.toString() : String(amount);
  if (BigInt(amountStr) <= BigInt(current)) return;
  await query("UPDATE users SET referral_earnings_l1 = $1, last_activity = NOW() WHERE id = $2", [amountStr, id]);
}

const SELLER_PROFIT_BPS = 120n;
const SELLER_BASE_DIVISOR = 2n;

function normalizeTxHash(v) {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return s && s.startsWith("0x") ? s : "";
}

function buildPurchaseDocId({ buyer, tokenId, txHash, eventId }) {
  const tid = String(tokenId || "").trim();
  const b = String(buyer || "").trim().toLowerCase();
  const evt = typeof eventId === "string" ? eventId.trim().toLowerCase().replace(/[^a-z0-9_]/g, "") : "";
  if (evt) return `evt_${evt}`;
  if (txHash && b && tid) return `tx_${txHash.replace(/[^a-z0-9]/g, "")}_${tid}_${b.replace(/[^a-z0-9]/g, "")}`;
  return null;
}

export async function logActivity(wallet, type, data = {}) {
  const w = (wallet || "").toLowerCase();
  if (!w) return;
  try {
    await query(
      "INSERT INTO user_activities (wallet, type, token_id, price, tx_hash, created_at) VALUES ($1, $2, $3, $4, $5, NOW())",
      [w, String(type), data.tokenId ?? null, data.price != null ? String(data.price) : null, data.txHash ?? null]
    );
  } catch (e) {
    console.warn("logActivity failed:", type, w, e?.message || e);
  }
}

const ACTIVITY_TYPES_SUCCESS = ["subscription", "mint", "buy", "sell"];
function isSuccessActivityType(type) {
  const t = typeof type === "string" ? type.toLowerCase().trim() : "";
  if (!t) return false;
  if (ACTIVITY_TYPES_SUCCESS.includes(t)) return true;
  if (["failed", "failure", "error", "reverted", "reject"].some((bad) => t.includes(bad))) return false;
  return false;
}

export async function getTradeCountFromActivity(wallet) {
  const w = (wallet || "").toLowerCase();
  if (!w) return 0;
  const { rows } = await query("SELECT type FROM user_activities WHERE wallet = $1", [w]);
  return rows.filter((r) => { const t = (r.type || "").toLowerCase(); return t === "buy" || t === "sell"; }).length;
}

export async function getWalletTradeStatsFromActivity(wallet, maxRows = 5000) {
  const w = (wallet || "").toLowerCase();
  if (!w) return null;
  const limit = Math.max(100, Math.min(Number(maxRows) || 5000, 10000));
  const { rows } = await query("SELECT type, price FROM user_activities WHERE wallet = $1 ORDER BY created_at DESC LIMIT $2", [w, limit]);
  let buyTrades = 0, sellTrades = 0, profitOnly = 0n;
  for (const r of rows) {
    const type = String(r.type || "").toLowerCase();
    let price = 0n;
    try { price = BigInt(r.price || "0"); } catch (_) {}
    if (type === "buy") buyTrades++;
    else if (type === "sell") {
      sellTrades++;
      const sellerBase = price / SELLER_BASE_DIVISOR;
      profitOnly += (sellerBase * SELLER_PROFIT_BPS) / 10000n;
    }
  }
  return {
    buyTrades,
    sellTrades,
    totalTrades: buyTrades + sellTrades,
    totalProfit: profitOnly > 0n ? profitOnly.toString() : "0",
    source: "postgres",
  };
}

export async function getActivities(wallet, limit = 10, offset = 0) {
  const w = (wallet || "").toLowerCase();
  if (!w) return { activities: [], total: 0 };
  const safeLimit = Math.min(Math.max(1, Number(limit) || 10), 20);
  const { rows } = await query(
    "SELECT id, type, token_id, price, tx_hash, created_at FROM user_activities WHERE wallet = $1 ORDER BY created_at DESC LIMIT $2",
    [w, safeLimit]
  );
  const docs = rows.filter((r) => isSuccessActivityType(r.type)).map((r) => ({
    id: r.id,
    type: r.type,
    tokenId: r.token_id ?? null,
    price: r.price ?? null,
    txHash: r.tx_hash ?? null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  }));
  const total = docs.length;
  const activities = docs.slice(Number(offset) || 0, (Number(offset) || 0) + safeLimit);
  return { activities, total };
}

export async function getActivitiesSince(wallet, since, limit = 10) {
  const w = (wallet || "").toLowerCase();
  if (!w || since == null) return { activities: [] };
  const sinceDate = typeof since === "number" ? new Date(since) : new Date(since);
  if (Number.isNaN(sinceDate.getTime())) return { activities: [] };
  const safeLimit = Math.min(Math.max(1, Number(limit) || 10), 20);
  const { rows } = await query(
    "SELECT id, type, token_id, price, tx_hash, created_at FROM user_activities WHERE wallet = $1 AND created_at < $2 ORDER BY created_at DESC LIMIT $3",
    [w, sinceDate.toISOString(), safeLimit]
  );
  const activities = rows.filter((r) => isSuccessActivityType(r.type)).map((r) => ({
    id: r.id,
    type: r.type,
    tokenId: r.token_id ?? null,
    price: r.price ?? null,
    txHash: r.tx_hash ?? null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  }));
  return { activities };
}

export async function recordPurchase(buyerWallet, sellerWallet, tokenId, price, options = {}) {
  const buyer = (buyerWallet || "").toLowerCase();
  const seller = (sellerWallet || "").toLowerCase();
  const tid = String(tokenId || "");
  if (!buyer || !tid) return;
  const priceStr = typeof price === "bigint" ? price.toString() : String(price || "0");
  const txHash = normalizeTxHash(options.txHash);
  const eventId = typeof options.eventId === "string" ? options.eventId : "";
  const purchaseId = buildPurchaseDocId({ buyer, tokenId: tid, txHash, eventId }) || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO nft_purchases (id, buyer, seller, token_id, price, tx_hash, event_id, block_number, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [purchaseId, buyer, seller || null, tid, priceStr, txHash || null, eventId || null, Number.isFinite(Number(options.blockNumber)) ? Number(options.blockNumber) : null]
    );
    await client.query(
      "INSERT INTO user_activities (wallet, type, token_id, price, tx_hash, created_at) VALUES ($1, 'buy', $2, $3, $4, NOW())",
      [buyer, tid, priceStr, txHash || null]
    );
    if (seller) {
      await client.query(
        "INSERT INTO user_activities (wallet, type, token_id, price, tx_hash, created_at) VALUES ($1, 'sell', $2, $3, $4, NOW())",
        [seller, tid, priceStr, txHash || null]
      );
    }
    await client.query(
      "UPDATE users SET total_trades = total_trades + 1, last_activity = NOW() WHERE id = $1",
      [docIdWallet(buyer)]
    );
    if (seller) {
      await client.query(
        "UPDATE users SET total_trades = total_trades + 1, last_activity = NOW() WHERE id = $1",
        [docIdWallet(seller)]
      );
    }
    const buyerArr = await client.query("SELECT owned_token_ids FROM users WHERE id = $1", [docIdWallet(buyer)]);
    let ids = (buyerArr.rows[0]?.owned_token_ids || []);
    if (!Array.isArray(ids)) ids = typeof ids === "string" ? (() => { try { return JSON.parse(ids); } catch { return []; } })() : [];
    if (!ids.includes(tid)) ids.push(tid);
    await client.query("UPDATE users SET owned_token_ids = $1::jsonb, last_activity = NOW() WHERE id = $2", [JSON.stringify(ids), docIdWallet(buyer)]);
    if (seller) {
      const sellerArr = await client.query("SELECT owned_token_ids FROM users WHERE id = $1", [docIdWallet(seller)]);
      let sIds = (sellerArr.rows[0]?.owned_token_ids || []);
      if (!Array.isArray(sIds)) sIds = typeof sIds === "string" ? (() => { try { return JSON.parse(sIds); } catch { return []; } })() : [];
      sIds = sIds.filter((x) => x !== tid);
      await client.query("UPDATE users SET owned_token_ids = $1::jsonb, last_activity = NOW() WHERE id = $2", [JSON.stringify(sIds), docIdWallet(seller)]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    if (e?.code === "23505") return;
    throw e;
  } finally {
    client.release();
  }
}

export async function addOwnedTokenId(wallet, tokenId) {
  const id = docIdWallet(wallet);
  if (!id || tokenId == null) return;
  const tid = String(tokenId);
  const { rows } = await query("SELECT owned_token_ids FROM users WHERE id = $1", [id]);
  let arr = rows[0]?.owned_token_ids ?? [];
  if (!Array.isArray(arr)) arr = typeof arr === "string" ? (() => { try { return JSON.parse(arr); } catch { return []; } })() : [];
  if (!arr.includes(tid)) arr.push(tid);
  await query("UPDATE users SET owned_token_ids = $1::jsonb, last_activity = NOW() WHERE id = $2", [JSON.stringify(arr), id]);
}

export async function getOwnedTokenIds(wallet) {
  const id = docIdWallet(wallet);
  if (!id) return [];
  const { rows } = await query("SELECT owned_token_ids FROM users WHERE id = $1", [id]);
  const arr = rows[0]?.owned_token_ids ?? [];
  return (Array.isArray(arr) ? arr : []).map((x) => String(x));
}
