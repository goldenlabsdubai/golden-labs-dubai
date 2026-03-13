/**
 * User data in Firestore (replaces MongoDB). Collection: users.
 * Doc ID: wallet (lowercase) for wallet users, "firebase_" + uid for Firebase users.
 */
import { getFirestore } from "../config/firebase.js";

const COLLECTION = "users";

function docIdWallet(wallet) {
  return (wallet || "").toLowerCase();
}

function docIdFirebase(uid) {
  return uid ? `firebase_${uid}` : null;
}

function num(d, key) {
  const v = d?.[key];
  return typeof v === "number" && v >= 0 ? v : 0;
}

function toUser(doc) {
  if (!doc?.exists) return null;
  const d = doc.data();
  const l1 = num(d, "referralCountL1");
  const l2 = num(d, "referralCountL2");
  const l3 = num(d, "referralCountL3");
  const l4 = num(d, "referralCountL4");
  const l5 = num(d, "referralCountL5");
  const e1 = d.referralEarningsL1 ?? "0";
  const e2 = d.referralEarningsL2 ?? "0";
  const e3 = d.referralEarningsL3 ?? "0";
  const e4 = d.referralEarningsL4 ?? "0";
  const e5 = d.referralEarningsL5 ?? "0";
  const et = d.referralEarningsTotal ?? "0";
  return {
    id: doc.id,
    wallet: d.wallet ?? null,
    firebaseUid: d.firebaseUid ?? null,
    email: d.email ?? null,
    username: d.username ?? null,
    name: d.name ?? null,
    bio: d.bio ?? null,
    avatar: d.avatar ?? null,
    websiteUrl: d.websiteUrl ?? null,
    xUrl: d.xUrl ?? null,
    telegramUrl: d.telegramUrl ?? null,
    totalTrades: typeof d.totalTrades === "number" ? d.totalTrades : 0,
    nonce: d.nonce ?? null,
    state: d.state ?? "CONNECTED",
    referrer: d.referrer ?? null,
    referralCountL1: l1,
    referralCountL2: l2,
    referralCountL3: l3,
    referralCountL4: l4,
    referralCountL5: l5,
    totalReferrals: num(d, "totalReferrals") || l1 + l2 + l3 + l4 + l5,
    referralEarningsL1: String(e1),
    referralEarningsL2: String(e2),
    referralEarningsL3: String(e3),
    referralEarningsL4: String(e4),
    referralEarningsL5: String(e5),
    referralEarningsTotal: String(et),
    lastActivity: d.lastActivity?.toDate?.() ?? d.lastActivity ?? null,
    createdAt: d.createdAt?.toDate?.() ?? d.createdAt ?? null,
  };
}

export async function getUserByWallet(wallet) {
  const db = getFirestore();
  if (!db) return null;
  const doc = await db.collection(COLLECTION).doc(docIdWallet(wallet)).get();
  return toUser(doc);
}

export async function getUserByFirebaseUid(uid) {
  const db = getFirestore();
  if (!db || !uid) return null;
  const doc = await db.collection(COLLECTION).doc(docIdFirebase(uid)).get();
  return toUser(doc);
}

export async function createUser(data) {
  const db = getFirestore();
  if (!db) throw new Error("Firestore not configured");
  const id = data.wallet ? docIdWallet(data.wallet) : docIdFirebase(data.firebaseUid);
  if (!id) throw new Error("wallet or firebaseUid required");
  const now = new Date();
  const doc = {
    wallet: data.wallet ?? null,
    firebaseUid: data.firebaseUid ?? null,
    email: data.email ?? null,
    username: data.username ?? null,
    name: data.name ?? null,
    bio: data.bio ?? null,
    avatar: data.avatar ?? null,
    websiteUrl: data.websiteUrl ?? null,
    xUrl: data.xUrl ?? null,
    telegramUrl: data.telegramUrl ?? null,
    totalTrades: typeof data.totalTrades === "number" ? data.totalTrades : 0,
    nonce: data.nonce ?? Math.random().toString(36).slice(2),
    state: data.state ?? "CONNECTED",
    referrer: data.referrer ?? null,
    referralCountL1: 0,
    referralCountL2: 0,
    referralCountL3: 0,
    referralCountL4: 0,
    referralCountL5: 0,
    totalReferrals: 0,
    referralEarningsL1: "0",
    referralEarningsL2: "0",
    referralEarningsL3: "0",
    referralEarningsL4: "0",
    referralEarningsL5: "0",
    referralEarningsTotal: "0",
    lastActivity: now,
    createdAt: now,
  };
  await db.collection(COLLECTION).doc(id).set(doc);
  return { id, ...doc };
}

export async function updateUser(docId, data) {
  const db = getFirestore();
  if (!db) throw new Error("Firestore not configured");
  const { FieldValue } = await import("firebase-admin/firestore");
  const ref = db.collection(COLLECTION).doc(docId);
  const existing = await ref.get();
  const update = { ...data, lastActivity: data.lastActivity ?? new Date() };
  if (existing?.exists && (existing.data().totalTrades === undefined || existing.data().totalTrades === null)) {
    update.totalTrades = 0;
  }
  const clean = {};
  for (const [k, v] of Object.entries(update)) {
    if (v === undefined || v === null) {
      clean[k] = FieldValue.delete();
    } else {
      clean[k] = v instanceof Date ? v : v;
    }
  }
  await ref.update(clean);
  const doc = await ref.get();
  return toUser(doc);
}

export async function findUserByUsername(username) {
  const db = getFirestore();
  if (!db) return null;
  const snap = await db.collection(COLLECTION).where("username", "==", (username || "").trim().toLowerCase()).limit(1).get();
  if (snap.empty) return null;
  return toUser(snap.docs[0]);
}

/** Get user by wallet or firebaseUid (for middleware/routes). */
export async function getUser(req) {
  if (req.wallet) return getUserByWallet(req.wallet);
  if (req.firebaseUid) return getUserByFirebaseUid(req.firebaseUid);
  return null;
}

/** Doc ID for current user from req (wallet or firebase_uid). */
export function getDocId(req) {
  if (req.wallet) return docIdWallet(req.wallet);
  if (req.firebaseUid) return docIdFirebase(req.firebaseUid);
  return null;
}

/** Top sellers by totalTrades (desc). Returns array of { rank, username, trades, referrals, earnings, avatar, wallet }. Requires Firestore index on users.totalTrades (desc) – create via Firebase Console when prompted. */
export async function getTopSellers(limit = 10) {
  const db = getFirestore();
  if (!db) return [];
  const snap = await db
    .collection(COLLECTION)
    .orderBy("totalTrades", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((doc, index) => {
    const u = toUser(doc);
    return {
      rank: index + 1,
      username: u.username || u.wallet?.slice(0, 8) + "…" || "Anonymous",
      trades: u.totalTrades,
      referrals: u.totalReferrals ?? 0,
      earnings: u.referralEarningsTotal ?? "0",
      avatar: u.avatar || null,
      wallet: u.wallet || null,
    };
  });
}

/** Increment totalTrades for a user by wallet. Creates doc with totalTrades: 1 if missing. */
export async function incrementUserTrades(wallet) {
  const db = getFirestore();
  if (!db) throw new Error("Firestore not configured");
  const id = docIdWallet(wallet);
  if (!id) throw new Error("wallet required");
  const ref = db.collection(COLLECTION).doc(id);
  const doc = await ref.get();
  const current = doc.exists ? (doc.data().totalTrades ?? 0) : 0;
  if (doc.exists) {
    await ref.update({ totalTrades: current + 1, lastActivity: new Date() });
  } else {
    await ref.set({
      wallet: wallet,
      totalTrades: 1,
      lastActivity: new Date(),
      createdAt: new Date(),
    });
  }
  return current + 1;
}

/**
 * When a new user signs up with referrerWallet, increment L1 for direct referrer, L2 for referrer's referrer, ... up to L5.
 * Example: A refers B → B is L1 for A. B refers C → C is L1 for B, L2 for A. F refers G → G is L1 for F, L2 for E, L3 for D, L4 for C, L5 for B; A gets nothing (max 5 levels).
 * Call after creating/updating user with referrer. Only wallet users have referrer chain (doc id = wallet).
 */
export async function incrementReferralChain(referrerWallet) {
  if (!referrerWallet || typeof referrerWallet !== "string") return;
  const db = getFirestore();
  if (!db) return;
  const wallet = referrerWallet.toLowerCase().replace(/^0x/, "") ? referrerWallet.toLowerCase() : null;
  if (!wallet) return;

  let currentWallet = wallet;
  const levels = ["referralCountL1", "referralCountL2", "referralCountL3", "referralCountL4", "referralCountL5"];

  for (let level = 0; level < levels.length; level++) {
    const docId = docIdWallet(currentWallet);
    if (!docId) break;
    const ref = db.collection(COLLECTION).doc(docId);
    const doc = await ref.get();
    if (!doc.exists) break;

    const data = doc.data();
    const key = levels[level];
    const current = num(data, key);
    const totalReferrals = typeof data.totalReferrals === "number" ? data.totalReferrals : (num(data, "referralCountL1") + num(data, "referralCountL2") + num(data, "referralCountL3") + num(data, "referralCountL4") + num(data, "referralCountL5"));
    await ref.update({
      [key]: current + 1,
      totalReferrals: totalReferrals + 1,
      lastActivity: new Date(),
    });

    const nextReferrer = data?.referrer;
    if (!nextReferrer || typeof nextReferrer !== "string") break;
    currentWallet = nextReferrer.toLowerCase();
  }
}

function addBigIntStrings(a, b) {
  const x = BigInt(a || "0");
  const y = BigInt(b || "0");
  return (x + y).toString();
}

/**
 * Add referral earning for a referrer at a specific level (1-5).
 * amount is a string or bigint in smallest units (USDT 6 decimals).
 * If the referrer has no user doc yet (e.g. L2–L5 chain), creates a minimal doc so earnings are not lost.
 */
export async function addReferralEarning(referrerWallet, level, amount) {
  if (!referrerWallet || typeof referrerWallet !== "string") return;
  if (level < 1 || level > 5) return;
  const db = getFirestore();
  if (!db) return;
  const docId = docIdWallet(referrerWallet);
  if (!docId) return;
  const ref = db.collection(COLLECTION).doc(docId);
  const doc = await ref.get();
  const delta = typeof amount === "bigint" ? amount.toString() : String(amount || "0");

  if (doc.exists) {
    const data = doc.data();
    const key = `referralEarningsL${level}`;
    const currentLevel = data?.[key] ?? "0";
    const currentTotal = data?.referralEarningsTotal ?? "0";
    await ref.update({
      [key]: addBigIntStrings(currentLevel, delta),
      referralEarningsTotal: addBigIntStrings(currentTotal, delta),
      lastActivity: new Date(),
    });
  } else {
    // L2–L5 referrer may not have signed up yet; create minimal doc so we don't drop earnings
    const updates = {
      wallet: referrerWallet,
      referralEarningsL1: "0",
      referralEarningsL2: "0",
      referralEarningsL3: "0",
      referralEarningsL4: "0",
      referralEarningsL5: "0",
      referralEarningsTotal: delta,
      lastActivity: new Date(),
    };
    updates[`referralEarningsL${level}`] = delta;
    await ref.set(updates, { merge: true });
  }
}

/**
 * Set referralEarningsTotal to at least the given amount (never decrease).
 * Used when we display claimable as "total" so that after withdraw total earnings still show.
 */
export async function setReferralEarningsTotalAtLeast(wallet, amount) {
  if (!wallet || amount == null) return;
  const db = getFirestore();
  if (!db) return;
  const docId = docIdWallet(wallet);
  if (!docId) return;
  const ref = db.collection(COLLECTION).doc(docId);
  const doc = await ref.get();
  const current = doc.exists ? (doc.data()?.referralEarningsTotal ?? "0") : "0";
  const amountStr = typeof amount === "bigint" ? amount.toString() : String(amount);
  if (BigInt(amountStr) <= BigInt(current)) return;
  try {
    await ref.update({
      referralEarningsTotal: amountStr,
      lastActivity: new Date(),
    });
  } catch (_) {
    const data = (doc.exists && doc.data()) || {};
    await ref.set({ ...data, referralEarningsTotal: amountStr, lastActivity: new Date() }, { merge: true });
  }
}

/**
 * Set referralEarningsL1 to at least the given amount (never decrease).
 * Keeps L1 earnings visible after withdraw when we had attributed claimable to L1.
 */
export async function setReferralEarningsL1AtLeast(wallet, amount) {
  if (!wallet || amount == null) return;
  const db = getFirestore();
  if (!db) return;
  const docId = docIdWallet(wallet);
  if (!docId) return;
  const ref = db.collection(COLLECTION).doc(docId);
  const doc = await ref.get();
  const current = doc.exists ? (doc.data()?.referralEarningsL1 ?? "0") : "0";
  const amountStr = typeof amount === "bigint" ? amount.toString() : String(amount);
  if (BigInt(amountStr) <= BigInt(current)) return;
  try {
    await ref.update({
      referralEarningsL1: amountStr,
      lastActivity: new Date(),
    });
  } catch (_) {
    const data = (doc.exists && doc.data()) || {};
    await ref.set({ ...data, referralEarningsL1: amountStr, lastActivity: new Date() }, { merge: true });
  }
}

const PURCHASES_COLLECTION = "nft_purchases";
const ACTIVITIES_COLLECTION = "user_activities";
const SELLER_PROFIT_BPS = 120n;
const SELLER_BASE_DIVISOR = 2n;

function normalizeTxHash(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return v && v.startsWith("0x") ? v : "";
}

function buildPurchaseDocId({ buyer, tokenId, txHash, eventId }) {
  const tid = String(tokenId || "").trim();
  const b = String(buyer || "").trim().toLowerCase();
  const evt = typeof eventId === "string" ? eventId.trim().toLowerCase() : "";
  if (evt) return `evt_${evt.replace(/[^a-z0-9_]/g, "")}`;
  if (txHash && b && tid) {
    return `tx_${txHash.replace(/[^a-z0-9]/g, "")}_${tid}_${b.replace(/[^a-z0-9]/g, "")}`;
  }
  return null;
}

/** Log one activity for a wallet (subscription, mint, buy, sell). */
export async function logActivity(wallet, type, data = {}) {
  const db = getFirestore();
  if (!db || !wallet) return;
  const w = (wallet || "").toLowerCase();
  if (!w) return;
  try {
    await db.collection(ACTIVITIES_COLLECTION).add({
      wallet: w,
      type: String(type),
      ...data,
      createdAt: new Date(),
    });
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

/** Count activities that are buy or sell only (used for totalTrades fallback). Mint, subscription, referral do not count as trades. */
export async function getTradeCountFromActivity(wallet) {
  const db = getFirestore();
  if (!db || !wallet) return 0;
  const w = (wallet || "").toLowerCase();
  if (!w) return 0;
  try {
    const snap = await db.collection(ACTIVITIES_COLLECTION).where("wallet", "==", w).get();
    let count = 0;
    snap.docs.forEach((d) => {
      const type = (d.data().type || "").toLowerCase();
      if (type === "buy" || type === "sell") count++;
    });
    return count;
  } catch (_) {
    return 0;
  }
}

/**
 * Aggregate buy/sell/total trades (+ net profit in smallest USDT units) from Firestore user_activities.
 * Used by admin bot stats so bots are treated exactly like users in app analytics.
 */
export async function getWalletTradeStatsFromActivity(wallet, maxRows = 5000) {
  const db = getFirestore();
  if (!db || !wallet) return null;
  const w = (wallet || "").toLowerCase();
  if (!w) return null;
  const safeLimit = Math.max(100, Math.min(Number(maxRows) || 5000, 10000));
  try {
    const snap = await db.collection(ACTIVITIES_COLLECTION).where("wallet", "==", w).limit(safeLimit).get();
    let buyTrades = 0;
    let sellTrades = 0;
    let profitOnly = 0n;
    snap.docs.forEach((d) => {
      const row = d.data() || {};
      const type = String(row.type || "").toLowerCase();
      const priceRaw = row.price != null ? String(row.price) : "0";
      let price = 0n;
      try {
        price = BigInt(priceRaw);
      } catch (_) {
        price = 0n;
      }
      if (type === "buy") {
        buyTrades += 1;
      } else if (type === "sell") {
        sellTrades += 1;
        // Contract profit metric: 1.20% of seller base (price / 2), excluding principal/buffer.
        const sellerBase = price / SELLER_BASE_DIVISOR;
        const perSaleProfit = (sellerBase * SELLER_PROFIT_BPS) / 10000n;
        profitOnly += perSaleProfit;
      }
    });
    const totalTrades = buyTrades + sellTrades;
    return {
      buyTrades,
      sellTrades,
      totalTrades,
      totalProfit: profitOnly > 0n ? profitOnly.toString() : "0",
      source: "firestore",
    };
  } catch (e) {
    console.warn("getWalletTradeStatsFromActivity error:", e?.message || e);
    return null;
  }
}

/**
 * Buffer received amount from Firestore nft_purchases (no block scan).
 * Count = times wallet sold then token was resold (wallet got BufferPaid).
 * Pending comes from on-chain bufferOwedFor, not Firestore.
 */
export async function getBufferReceivedFromFirestore(wallet, bufferAmount) {
  const db = getFirestore();
  if (!db || !wallet) return null;
  const target = (wallet || "").toLowerCase();
  if (!target.startsWith("0x")) return null;
  const amount = bufferAmount != null ? BigInt(bufferAmount.toString()) : 0n;
  if (amount <= 0n) return null;
  try {
    const snap = await db.collection(PURCHASES_COLLECTION).limit(5000).get();
    const purchases = snap.docs.map((d) => d.data()).filter((x) => x?.tokenId);
    const byTokenOrdered = {};
    purchases.forEach((x) => {
      const tid = String(x?.tokenId ?? "").trim();
      if (!tid) return;
      if (!byTokenOrdered[tid]) byTokenOrdered[tid] = [];
      const block = Number(x?.blockNumber ?? 0) || 0;
      const ts = (x?.createdAt?.toDate?.() ?? x?.createdAt)?.getTime?.() ?? 0;
      byTokenOrdered[tid].push({
        seller: (x?.seller ?? "").toLowerCase(),
        order: block || ts,
      });
    });
    let receivedCount = 0;
    Object.keys(byTokenOrdered).forEach((tid) => {
      const list = byTokenOrdered[tid].sort((a, b) => a.order - b.order);
      for (let i = 0; i < list.length - 1; i++) {
        if (list[i].seller === target) receivedCount++;
      }
    });
    return (BigInt(receivedCount) * amount).toString();
  } catch (e) {
    console.warn("getBufferReceivedFromFirestore error:", e?.message || e);
    return null;
  }
}

/** Get activities for a wallet, newest first. Returns successful activity only: subscription, mint, buy, sell. Failed transactions are excluded. */
export async function getActivities(wallet, limit = 50, offset = 0) {
  const db = getFirestore();
  if (!db || !wallet) return { activities: [], total: 0 };
  const w = (wallet || "").toLowerCase();
  if (!w) return { activities: [], total: 0 };
  try {
    const snap = await db.collection(ACTIVITIES_COLLECTION).where("wallet", "==", w).limit(500).get();
    const docs = snap.docs.map((d) => {
      const x = d.data();
      const createdAt = x.createdAt?.toDate?.() ?? x.createdAt;
      const txHashRaw = x.txHash;
      const txHash = (typeof txHashRaw === "string" && txHashRaw.trim()) ? txHashRaw.trim() : null;
      return {
        id: d.id,
        type: x.type,
        tokenId: x.tokenId ?? null,
        price: x.price ?? null,
        txHash,
        createdAt: createdAt instanceof Date ? createdAt.toISOString() : (createdAt ?? null),
        _ts: createdAt instanceof Date ? createdAt.getTime() : (typeof createdAt === "string" ? new Date(createdAt).getTime() : 0),
      };
    });
    const onlySuccess = docs.filter((d) => isSuccessActivityType(d.type));
    onlySuccess.sort((a, b) => (b._ts || 0) - (a._ts || 0));
    const total = onlySuccess.length;
    const activities = onlySuccess.slice(offset, offset + limit).map(({ _ts, ...rest }) => rest);
    return { activities, total };
  } catch (e) {
    console.warn("getActivities error:", e?.message || e);
    return { activities: [], total: 0 };
  }
}

/** Record who bought which tokenId (buyer, seller, tokenId, price). Also update ownedTokenIds: add to buyer, remove from seller. options.txHash optional. */
export async function recordPurchase(buyerWallet, sellerWallet, tokenId, price, options = {}) {
  const db = getFirestore();
  if (!db) throw new Error("Firestore not configured");
  const buyer = (buyerWallet || "").toLowerCase();
  const seller = (sellerWallet || "").toLowerCase();
  const tid = String(tokenId || "");
  if (!buyer || !tid) return;

  const priceStr = typeof price === "bigint" ? price.toString() : String(price || "0");
  const txHash = normalizeTxHash(options.txHash);
  const eventId = typeof options.eventId === "string" ? options.eventId : "";
  const purchaseDocId = buildPurchaseDocId({ buyer, tokenId: tid, txHash, eventId });
  const purchaseRef = purchaseDocId
    ? db.collection(PURCHASES_COLLECTION).doc(purchaseDocId)
    : db.collection(PURCHASES_COLLECTION).doc();

  const purchasePayload = {
    buyer,
    seller: seller || null,
    tokenId: tid,
    price: priceStr,
    txHash: txHash || null,
    eventId: eventId || null,
    blockNumber: Number.isFinite(Number(options.blockNumber)) ? Number(options.blockNumber) : null,
    createdAt: new Date(),
  };

  if (purchaseDocId) {
    try {
      await purchaseRef.create(purchasePayload);
    } catch (e) {
      // Already recorded by indexer/API earlier - avoid duplicating activities and trade counts.
      if (e?.code === 6 || String(e?.message || "").toLowerCase().includes("already exists")) return;
      throw e;
    }
  } else {
    await purchaseRef.set(purchasePayload);
  }

  await logActivity(buyer, "buy", { tokenId: tid, price: priceStr, ...(txHash ? { txHash } : {}) });
  if (seller) await logActivity(seller, "sell", { tokenId: tid, price: priceStr, ...(txHash ? { txHash } : {}) });

  await incrementUserTrades(buyer);
  if (seller) await incrementUserTrades(seller);

  const { FieldValue } = await import("firebase-admin/firestore");
  const buyerRef = db.collection(COLLECTION).doc(docIdWallet(buyer));
  const sellerRef = seller ? db.collection(COLLECTION).doc(docIdWallet(seller)) : null;

  try {
    await buyerRef.update({
      ownedTokenIds: FieldValue.arrayUnion(tid),
      lastActivity: new Date(),
    });
  } catch (_) {
    const doc = await buyerRef.get();
    if (!doc.exists) return;
    const data = doc.data() || {};
    const arr = Array.isArray(data.ownedTokenIds) ? data.ownedTokenIds : [];
    if (!arr.includes(tid)) arr.push(tid);
    await buyerRef.set({ ...data, ownedTokenIds: arr, lastActivity: new Date() }, { merge: true });
  }

  if (sellerRef) {
    try {
      await sellerRef.update({
        ownedTokenIds: FieldValue.arrayRemove(tid),
        lastActivity: new Date(),
      });
    } catch (_) {
      const doc = await sellerRef.get();
      if (!doc.exists) return;
      const data = doc.data() || {};
      const arr = Array.isArray(data.ownedTokenIds) ? data.ownedTokenIds : [];
      const next = arr.filter((id) => id !== tid);
      await sellerRef.update({ ownedTokenIds: next, lastActivity: new Date() });
    }
  }
}

/** Add tokenId to user's ownedTokenIds (e.g. after mint). */
export async function addOwnedTokenId(wallet, tokenId) {
  const db = getFirestore();
  if (!db || !wallet || tokenId == null) return;
  const id = docIdWallet(wallet);
  if (!id) return;
  const tid = String(tokenId);
  const ref = db.collection(COLLECTION).doc(id);
  try {
    const { FieldValue } = await import("firebase-admin/firestore");
    await ref.update({
      ownedTokenIds: FieldValue.arrayUnion(tid),
      lastActivity: new Date(),
    });
  } catch (_) {
    const doc = await ref.get();
    const data = (doc.exists && doc.data()) || {};
    const arr = Array.isArray(data.ownedTokenIds) ? data.ownedTokenIds : [];
    if (!arr.includes(tid)) arr.push(tid);
    await ref.set({ ...data, ownedTokenIds: arr, lastActivity: new Date() }, { merge: true });
  }
}

/** Read ownedTokenIds array for a wallet from Firestore. Used by /marketplace/my-assets to avoid scanning 1..totalMinted. */
export async function getOwnedTokenIds(wallet) {
  const db = getFirestore();
  if (!db || !wallet) return [];
  const id = docIdWallet(wallet);
  if (!id) return [];
  const doc = await db.collection(COLLECTION).doc(id).get();
  if (!doc.exists) return [];
  const data = doc.data() || {};
  const arr = Array.isArray(data.ownedTokenIds) ? data.ownedTokenIds : [];
  return arr.map((x) => String(x));
}
