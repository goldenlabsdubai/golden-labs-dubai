/**
 * User data in PostgreSQL (AWS RDS) — requires PGHOST, PGDATABASE, PGUSER in .env.
 */
import { query, getPool, getClient } from "../config/postgres.js";
import { resolveTradingIncomePerSellWeiFromChain } from "../utils/tradingIncomeWei.js";
import { enrichActivitiesWithReceiptStatus, getTxReceiptStatusMap } from "./txReceiptStatus.js";

function docIdWallet(wallet) {
  return (wallet || "").toLowerCase();
}
function docIdFirebase(uid) {
  return uid ? `firebase_${uid}` : null;
}

/**
 * Primary key of the profile row for this wallet: `id` may equal the address, or
 * `users.wallet` may match while `id` is `firebase_*` (Firebase-first signups).
 * Prefer the Firebase-linked row when both exist (indexer used to credit `id = wallet` shells only).
 */
async function resolveCanonicalUserIdForWallet(wallet) {
  const w = docIdWallet(wallet);
  if (!w) return null;
  const { rows } = await query(
    `SELECT id FROM users
     WHERE id = $1 OR (wallet IS NOT NULL AND LOWER(TRIM(wallet)) = $1)
     ORDER BY (CASE WHEN firebase_uid IS NOT NULL AND BTRIM(firebase_uid) <> '' THEN 0 ELSE 1 END), id
     LIMIT 1`,
    [w]
  );
  return rows[0]?.id ?? null;
}

/**
 * Sum referral_earnings_l1..l10 across every `users` row for this wallet (e.g. id = 0x… shell vs firebase_* profile).
 * Indexer credits the canonical row, but legacy rows may still hold amounts; without this, /me and /referral/stats show 0 while on-chain claimable > 0.
 */
async function aggregateReferralEarningsByWallet(wallet) {
  const w = docIdWallet(wallet);
  if (!w) return null;
  const sumCols = Array.from(
    { length: 10 },
    (_, i) => `COALESCE(SUM(referral_earnings_l${i + 1}::numeric), 0)::text AS s${i + 1}`
  ).join(", ");
  const { rows } = await query(
    `SELECT ${sumCols} FROM users WHERE id = $1 OR (wallet IS NOT NULL AND LOWER(TRIM(wallet)) = $1)`,
    [w]
  );
  const r = rows[0];
  if (!r) return null;
  let total = 0n;
  const out = {};
  for (let i = 1; i <= 10; i++) {
    const raw = String(r[`s${i}`] ?? "0").split(".")[0].replace(/^0+/, "") || "0";
    let bi = 0n;
    try {
      bi = BigInt(raw);
    } catch {
      bi = 0n;
    }
    out[`referralEarningsL${i}`] = bi.toString();
    total += bi;
  }
  out.referralEarningsTotal = total.toString();
  return out;
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
    referralCountL6: r.referral_count_l6 ?? 0,
    referralCountL7: r.referral_count_l7 ?? 0,
    referralCountL8: r.referral_count_l8 ?? 0,
    referralCountL9: r.referral_count_l9 ?? 0,
    referralCountL10: r.referral_count_l10 ?? 0,
    totalReferrals:
      (r.total_referrals ?? 0) ||
      (r.referral_count_l1 ?? 0) +
        (r.referral_count_l2 ?? 0) +
        (r.referral_count_l3 ?? 0) +
        (r.referral_count_l4 ?? 0) +
        (r.referral_count_l5 ?? 0) +
        (r.referral_count_l6 ?? 0) +
        (r.referral_count_l7 ?? 0) +
        (r.referral_count_l8 ?? 0) +
        (r.referral_count_l9 ?? 0) +
        (r.referral_count_l10 ?? 0),
    referralEarningsL1: String(r.referral_earnings_l1 ?? "0"),
    referralEarningsL2: String(r.referral_earnings_l2 ?? "0"),
    referralEarningsL3: String(r.referral_earnings_l3 ?? "0"),
    referralEarningsL4: String(r.referral_earnings_l4 ?? "0"),
    referralEarningsL5: String(r.referral_earnings_l5 ?? "0"),
    referralEarningsL6: String(r.referral_earnings_l6 ?? "0"),
    referralEarningsL7: String(r.referral_earnings_l7 ?? "0"),
    referralEarningsL8: String(r.referral_earnings_l8 ?? "0"),
    referralEarningsL9: String(r.referral_earnings_l9 ?? "0"),
    referralEarningsL10: String(r.referral_earnings_l10 ?? "0"),
    referralEarningsTotal: String(r.referral_earnings_total ?? "0"),
    lastActivity: r.last_activity,
    createdAt: r.created_at,
    ownedTokenIds: arr.map((x) => String(x)),
  };
}

export async function getUserByWallet(wallet) {
  const w = docIdWallet(wallet);
  if (!w) return null;
  const { rows } = await query(
    `SELECT * FROM users
     WHERE id = $1 OR (wallet IS NOT NULL AND LOWER(TRIM(wallet)) = $1)
     ORDER BY (CASE WHEN firebase_uid IS NOT NULL AND BTRIM(firebase_uid) <> '' THEN 0 ELSE 1 END), id
     LIMIT 1`,
    [w]
  );
  if (!rows[0]) return null;
  const base = rowToUser(rows[0]);
  const agg = await aggregateReferralEarningsByWallet(wallet);
  if (!agg) return base;
  return { ...base, ...agg };
}

const REF_NETWORK_MAX_L1 = 80;
/** Max direct children stored per node per level (extra count exposed as moreChildren). */
const REF_NETWORK_MAX_CHILDREN_PER_NODE = 60;

/**
 * Downline tree for referral UI: L1 array, each node has nested `children` through L10 (by referrer).
 * Wallets normalized to lowercase. One query per depth wave; caps + optional moreChildren on each node.
 */
export async function getReferralDownlineGraph(viewerWallet) {
  const root = docIdWallet(viewerWallet);
  if (!root) return { l1: [] };

  const { rows: l1rows } = await query(
    `SELECT wallet, username, avatar FROM users
     WHERE referrer IS NOT NULL AND LOWER(TRIM(referrer)) = $1
     ORDER BY created_at ASC NULLS LAST
     LIMIT $2`,
    [root, REF_NETWORK_MAX_L1]
  );

  const l1 = l1rows.map((r) => ({
    wallet: (r.wallet || "").toLowerCase(),
    username: r.username ?? null,
    avatar: r.avatar ?? null,
    children: [],
  }));

  if (l1.length === 0) {
    return { l1: [] };
  }

  let frontier = l1;

  for (let nextLevel = 2; nextLevel <= 10; nextLevel++) {
    const parents = frontier.map((n) => n.wallet);
    if (parents.length === 0) break;

    const { rows: childRows } = await query(
      `SELECT wallet, username, avatar, referrer FROM users
       WHERE referrer IS NOT NULL AND LOWER(TRIM(referrer)) = ANY($1::text[])
       ORDER BY LOWER(TRIM(referrer)) ASC, created_at ASC NULLS LAST`,
      [parents]
    );

    const byParent = Object.create(null);
    const countByParent = Object.create(null);
    for (const w of parents) {
      byParent[w] = [];
      countByParent[w] = 0;
    }

    for (const r of childRows) {
      const p = docIdWallet(r.referrer);
      if (!p || !byParent[p]) continue;
      countByParent[p]++;
      if (byParent[p].length >= REF_NETWORK_MAX_CHILDREN_PER_NODE) continue;
      byParent[p].push({
        wallet: (r.wallet || "").toLowerCase(),
        username: r.username ?? null,
        avatar: r.avatar ?? null,
        children: [],
      });
    }

    const nextFrontier = [];
    for (const node of frontier) {
      const kids = byParent[node.wallet];
      const total = countByParent[node.wallet] || 0;
      node.children = kids;
      if (total > kids.length) node.moreChildren = total - kids.length;
      nextFrontier.push(...kids);
    }
    frontier = nextFrontier;
  }

  return { l1 };
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
      referral_count_l6, referral_count_l7, referral_count_l8, referral_count_l9, referral_count_l10,
      total_referrals, referral_earnings_l1, referral_earnings_l2, referral_earnings_l3, referral_earnings_l4, referral_earnings_l5,
      referral_earnings_l6, referral_earnings_l7, referral_earnings_l8, referral_earnings_l9, referral_earnings_l10, referral_earnings_total,
      last_activity, created_at, owned_token_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38::timestamptz, $39::timestamptz, '[]'::jsonb)
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
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0,
      "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0",
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
    referralCountL4: "referral_count_l4", referralCountL5: "referral_count_l5", referralCountL6: "referral_count_l6",
    referralCountL7: "referral_count_l7", referralCountL8: "referral_count_l8", referralCountL9: "referral_count_l9", referralCountL10: "referral_count_l10", totalReferrals: "total_referrals",
    referralEarningsL1: "referral_earnings_l1", referralEarningsL2: "referral_earnings_l2", referralEarningsL3: "referral_earnings_l3",
    referralEarningsL4: "referral_earnings_l4", referralEarningsL5: "referral_earnings_l5", referralEarningsL6: "referral_earnings_l6",
    referralEarningsL7: "referral_earnings_l7", referralEarningsL8: "referral_earnings_l8", referralEarningsL9: "referral_earnings_l9", referralEarningsL10: "referral_earnings_l10", referralEarningsTotal: "referral_earnings_total",
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

/**
 * Leaderboard: rank by lifetime earnings = trade income from activity (same dedupe + receipt rules as dashboard /me) + referral_earnings_total.
 */
export async function getTopSellers(limit = 10) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 100));
  const incomePerSellWei = await resolveTradingIncomePerSellWeiFromChain();
  const maxRowsPerWallet = 10000;

  const { rows: activityRows } = await query(`
    SELECT LOWER(TRIM(a.wallet)) AS wlt, a.type, a.tx_hash, a.token_id
    FROM user_activities a
    INNER JOIN users u ON LOWER(TRIM(a.wallet)) = LOWER(TRIM(u.wallet))
    WHERE a.type IN ('buy', 'sell')
      AND u.wallet IS NOT NULL AND BTRIM(u.wallet) <> ''
    ORDER BY LOWER(TRIM(a.wallet)), a.created_at DESC
    LIMIT 500000
  `);

  const byWallet = new Map();
  for (const row of activityRows) {
    const w = String(row.wlt || "").toLowerCase();
    if (!w.startsWith("0x")) continue;
    if (!byWallet.has(w)) byWallet.set(w, []);
    const arr = byWallet.get(w);
    if (arr.length < maxRowsPerWallet) arr.push(row);
  }

  const allHashes = new Set();
  for (const arr of byWallet.values()) {
    for (const r of dedupeTradeActivityRows(arr)) {
      const th = String(r.tx_hash || "").trim().toLowerCase();
      if (th) allHashes.add(th);
    }
  }
  const statusMap = await getTxReceiptStatusMap([...allHashes]);

  const tradeProfitByWallet = new Map();
  for (const [w, arr] of byWallet) {
    const deduped = dedupeTradeActivityRows(arr);
    const { totalProfit } = tradeStatsFromDedupedRows(deduped, statusMap, incomePerSellWei);
    try {
      tradeProfitByWallet.set(w, BigInt(String(totalProfit || "0")));
    } catch {
      tradeProfitByWallet.set(w, 0n);
    }
  }

  const { rows } = await query("SELECT * FROM users WHERE wallet IS NOT NULL AND BTRIM(wallet) <> ''");
  const scored = [];
  for (const r of rows) {
    const u = rowToUser(r);
    const w = (u.wallet || "").toLowerCase();
    if (!w.startsWith("0x")) continue;
    const tradeWei = tradeProfitByWallet.get(w) ?? 0n;
    let refWei = 0n;
    try {
      refWei = BigInt(String(u.referralEarningsTotal ?? "0").replace(/\..*$/, "") || "0");
    } catch {
      refWei = 0n;
    }
    const lifetime = tradeWei + refWei;
    scored.push({ r, u, lifetime });
  }

  scored.sort((a, b) => {
    if (a.lifetime < b.lifetime) return 1;
    if (a.lifetime > b.lifetime) return -1;
    return (b.u.totalTrades ?? 0) - (a.u.totalTrades ?? 0);
  });

  return scored.slice(0, safeLimit).map((item, index) => {
    const u = item.u;
    return {
      rank: index + 1,
      username: u.username || (u.wallet ? u.wallet.slice(0, 8) + "…" : "Anonymous"),
      trades: u.totalTrades,
      referrals: u.totalReferrals ?? 0,
      earnings: item.lifetime.toString(),
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
  const levels = [
    "referral_count_l1",
    "referral_count_l2",
    "referral_count_l3",
    "referral_count_l4",
    "referral_count_l5",
    "referral_count_l6",
    "referral_count_l7",
    "referral_count_l8",
    "referral_count_l9",
    "referral_count_l10",
  ];
  let currentWallet = wallet;
  for (let level = 0; level < levels.length; level++) {
    const id = docIdWallet(currentWallet);
    if (!id) break;
    const { rows } = await query("SELECT * FROM users WHERE id = $1", [id]);
    if (rows.length === 0) break;
    const r = rows[0];
    const key = levels[level];
    const current = r[key] ?? 0;
    const totalRef =
      (r.total_referrals ?? 0) ||
      (r.referral_count_l1 ?? 0) +
        (r.referral_count_l2 ?? 0) +
        (r.referral_count_l3 ?? 0) +
        (r.referral_count_l4 ?? 0) +
        (r.referral_count_l5 ?? 0) +
        (r.referral_count_l6 ?? 0) +
        (r.referral_count_l7 ?? 0) +
        (r.referral_count_l8 ?? 0) +
        (r.referral_count_l9 ?? 0) +
        (r.referral_count_l10 ?? 0);
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
  if (!referrerWallet || level < 1 || level > 10) return;
  const shellId = docIdWallet(referrerWallet);
  if (!shellId) return;
  const canonicalId = (await resolveCanonicalUserIdForWallet(referrerWallet)) ?? shellId;
  const delta = typeof amount === "bigint" ? amount.toString() : String(amount || "0");
  const col = `referral_earnings_l${level}`;
  const { rows } = await query(`SELECT ${col}, referral_earnings_total FROM users WHERE id = $1`, [canonicalId]);
  if (rows.length > 0) {
    const r = rows[0];
    await query(
      `UPDATE users SET ${col} = $1, referral_earnings_total = $2, last_activity = NOW() WHERE id = $3`,
      [addBigIntStrings(r[col] ?? "0", delta), addBigIntStrings(r.referral_earnings_total ?? "0", delta), canonicalId]
    );
  } else {
    await query(
      `INSERT INTO users (id, wallet, ${col}, referral_earnings_total, last_activity, created_at)
       VALUES ($1, $2, $3, $3, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET ${col} = (COALESCE(users.${col}, '0')::numeric + $3::numeric)::text, referral_earnings_total = (COALESCE(users.referral_earnings_total, '0')::numeric + $3::numeric)::text, last_activity = NOW()`,
      [shellId, referrerWallet, delta]
    );
  }
}

export async function setReferralEarningsTotalAtLeast(wallet, amount) {
  if (!wallet || amount == null) return;
  const id = (await resolveCanonicalUserIdForWallet(wallet)) ?? docIdWallet(wallet);
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

/** Add to referral_earnings_l{level} only (does not change referral_earnings_total). Used to align per-level rows with lifetime total. */
export async function incrementReferralEarningsLevelOnly(referrerWallet, level, amount) {
  if (!referrerWallet || level < 1 || level > 10) return;
  const docId = (await resolveCanonicalUserIdForWallet(referrerWallet)) ?? docIdWallet(referrerWallet);
  if (!docId) return;
  const delta = typeof amount === "bigint" ? amount.toString() : String(amount || "0");
  if (BigInt(delta || "0") <= 0n) return;
  const col = `referral_earnings_l${level}`;
  await query(
    `UPDATE users SET ${col} = (COALESCE(users.${col}, '0')::numeric + $1::numeric)::text, last_activity = NOW() WHERE id = $2`,
    [delta, docId]
  );
}

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

/** Remove duplicate buy/sell rows (same indexer + frontend recordPurchase). Keep first row (newest first in input). */
function dedupeTradeActivityRows(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const t = String(r.type || "").toLowerCase();
    if (t === "buy" || t === "sell") {
      const th = String(r.tx_hash || "").trim().toLowerCase();
      if (th) {
        const key = `${t}|${th}|${String(r.token_id ?? "")}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }
    }
    out.push(r);
  }
  return out;
}

/** Same trade-income rules as dashboard /me: deduped rows, skip only confirmed failed receipts. */
function tradeStatsFromDedupedRows(deduped, statusMap, incomePerSellWei) {
  const wei = typeof incomePerSellWei === "bigint" ? incomePerSellWei : BigInt(String(incomePerSellWei));
  let buyTrades = 0;
  let sellTrades = 0;
  let profitOnly = 0n;
  for (const r of deduped) {
    const type = String(r.type || "").toLowerCase();
    const th = String(r.tx_hash || "").trim().toLowerCase();
    if (th) {
      const st = statusMap.get(th);
      if (st === "failed") continue;
      // Do not skip "pending": receipt often lags briefly. Only confirmed failures are excluded.
    }
    if (type === "buy") buyTrades++;
    else if (type === "sell") {
      sellTrades++;
      profitOnly += wei;
    }
  }
  return {
    buyTrades,
    sellTrades,
    totalTrades: buyTrades + sellTrades,
    totalProfit: profitOnly > 0n ? profitOnly.toString() : "0",
  };
}

export async function getTradeCountFromActivity(wallet) {
  const stats = await getWalletTradeStatsFromActivity(wallet, 5000);
  return stats ? stats.totalTrades : 0;
}

export async function getWalletTradeStatsFromActivity(wallet, maxRows = 5000) {
  const w = (wallet || "").toLowerCase();
  if (!w) return null;
  const limit = Math.max(100, Math.min(Number(maxRows) || 5000, 10000));
  const { rows } = await query(
    "SELECT type, price, tx_hash, token_id FROM user_activities WHERE wallet = $1 AND type IN ('buy', 'sell') ORDER BY created_at DESC LIMIT $2",
    [w, limit]
  );
  const deduped = dedupeTradeActivityRows(rows);
  const hashes = deduped.map((r) => r.tx_hash).filter(Boolean);
  const statusMap = await getTxReceiptStatusMap(hashes);
  /** Seller USDT wei per successful sale — from chain `tradingIncomeAmount()` with env fallback (not a magic number in stats). */
  const incomePerSellWei = await resolveTradingIncomePerSellWeiFromChain();
  const stats = tradeStatsFromDedupedRows(deduped, statusMap, incomePerSellWei);
  return { ...stats, source: "postgres" };
}

export async function getActivities(wallet, limit = 10, offset = 0) {
  const w = (wallet || "").toLowerCase();
  if (!w) return { activities: [], total: 0 };
  const safeLimit = Math.min(Math.max(1, Number(limit) || 10), 20);
  const safeOffset = Math.max(0, Number(offset) || 0);
  const fetchCap = Math.min(500, Math.max(safeLimit + safeOffset + 50, 80));
  const { rows } = await query(
    "SELECT id, type, token_id, price, tx_hash, created_at FROM user_activities WHERE wallet = $1 ORDER BY created_at DESC LIMIT $2",
    [w, fetchCap]
  );
  const filtered = rows.filter((r) => isSuccessActivityType(r.type));
  const deduped = dedupeTradeActivityRows(filtered);
  const total = deduped.length;
  const slice = deduped.slice(safeOffset, safeOffset + safeLimit);
  const docs = slice.map((r) => ({
    id: r.id,
    type: r.type,
    tokenId: r.token_id ?? null,
    price: r.price ?? null,
    txHash: r.tx_hash ?? null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  }));
  const activities = await enrichActivitiesWithReceiptStatus(docs);
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
    [w, sinceDate.toISOString(), 200]
  );
  const filtered = rows.filter((r) => isSuccessActivityType(r.type));
  const deduped = dedupeTradeActivityRows(filtered);
  const slice = deduped.slice(0, safeLimit);
  const docs = slice.map((r) => ({
    id: r.id,
    type: r.type,
    tokenId: r.token_id ?? null,
    price: r.price ?? null,
    txHash: r.tx_hash ?? null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  }));
  const activities = await enrichActivitiesWithReceiptStatus(docs);
  return { activities };
}

/** After a successful marketplace purchase commit; dynamic import avoids circular deps with botService. */
async function notifyTradeActivityTelegram(buyer, seller, tid, priceStr, txHash) {
  const th = typeof txHash === "string" ? txHash.trim().toLowerCase() : "";
  if (!th.startsWith("0x")) return;
  try {
    const [{ notifyActivity, isTelegramSendConfigured }, { isConfiguredBotWallet }] = await Promise.all([
      import("./telegramNotify.js"),
      import("./botService.js"),
    ]);
    if (!isTelegramSendConfigured()) return;
    const buyerBot = isConfiguredBotWallet(buyer);
    const sellerBot = seller ? isConfiguredBotWallet(seller) : false;
    if (buyerBot && sellerBot) return;
    await notifyActivity("bought", {
      buyer,
      seller: seller || "",
      tokenId: tid,
      priceWei: priceStr,
      txHash: th,
    });
    if (seller) {
      await notifyActivity("sold", {
        seller,
        buyer,
        tokenId: tid,
        priceWei: priceStr,
        txHash: th,
      });
    }
  } catch {
    /* non-fatal */
  }
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
    const insertPurchase = await client.query(
      `INSERT INTO nft_purchases (id, buyer, seller, token_id, price, tx_hash, event_id, block_number, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [purchaseId, buyer, seller || null, tid, priceStr, txHash || null, eventId || null, Number.isFinite(Number(options.blockNumber)) ? Number(options.blockNumber) : null]
    );
    if (insertPurchase.rowCount === 0) {
      await client.query("ROLLBACK");
      return;
    }
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
    notifyTradeActivityTelegram(buyer, seller, tid, priceStr, txHash).catch(() => {});
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

/** Remove token from user's owned_token_ids (e.g. after sale when DB was stale). */
export async function removeOwnedTokenId(wallet, tokenId) {
  const id = docIdWallet(wallet);
  if (!id || tokenId == null) return;
  const tid = String(tokenId);
  const { rows } = await query("SELECT owned_token_ids FROM users WHERE id = $1", [id]);
  let arr = rows[0]?.owned_token_ids ?? [];
  if (!Array.isArray(arr)) arr = typeof arr === "string" ? (() => { try { return JSON.parse(arr); } catch { return []; } })() : [];
  const next = arr.map(String).filter((x) => x !== tid);
  if (next.length === arr.length) return;
  await query("UPDATE users SET owned_token_ids = $1::jsonb, last_activity = NOW() WHERE id = $2", [JSON.stringify(next), id]);
}

export async function getOwnedTokenIds(wallet) {
  const id = docIdWallet(wallet);
  if (!id) return [];
  const { rows } = await query("SELECT owned_token_ids FROM users WHERE id = $1", [id]);
  const arr = rows[0]?.owned_token_ids ?? [];
  return (Array.isArray(arr) ? arr : []).map((x) => String(x));
}
