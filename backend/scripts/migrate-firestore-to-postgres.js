/**
 * One-time migration: Firestore → PostgreSQL (RDS).
 * Run from backend dir: node scripts/migrate-firestore-to-postgres.js
 * Requires: Firebase (Firestore) and PostgreSQL env vars set in .env.
 */
import "dotenv/config";
import { getFirestore } from "../src/config/firebase.js";
import { getPool, query } from "../src/config/postgres.js";

function toPgTs(val) {
  if (val == null) return null;
  if (val.toDate && typeof val.toDate === "function") return val.toDate().toISOString();
  if (val instanceof Date) return val.toISOString();
  if (typeof val === "string") return val;
  return null;
}

/** Recursively convert Firestore Timestamps in obj to ISO strings for JSONB. */
function toPlainJson(obj) {
  if (obj == null) return obj;
  if (obj.toDate && typeof obj.toDate === "function") return obj.toDate().toISOString();
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map(toPlainJson);
  if (typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = toPlainJson(v);
    return out;
  }
  return obj;
}

async function migrateUsers(db) {
  const snap = await db.collection("users").get();
  for (const doc of snap.docs) {
    const d = doc.data();
    const id = doc.id;
    const lastActivity = toPgTs(d.lastActivity);
    const createdAt = toPgTs(d.createdAt);
    const ownedTokenIds = Array.isArray(d.ownedTokenIds) ? JSON.stringify(d.ownedTokenIds) : "[]";
    await query(
      `INSERT INTO users (
        id, wallet, firebase_uid, email, username, name, bio, avatar, website_url, x_url, telegram_url,
        total_trades, nonce, state, referrer,
        referral_count_l1, referral_count_l2, referral_count_l3, referral_count_l4, referral_count_l5,
        total_referrals, referral_earnings_l1, referral_earnings_l2, referral_earnings_l3,
        referral_earnings_l4, referral_earnings_l5, referral_earnings_total,
        last_activity, created_at, owned_token_ids
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        $12, $13, $14, $15,
        $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27,
        $28::timestamptz, $29::timestamptz, $30::jsonb
      )
      ON CONFLICT (id) DO UPDATE SET
        wallet = EXCLUDED.wallet, firebase_uid = EXCLUDED.firebase_uid, email = EXCLUDED.email,
        username = EXCLUDED.username, name = EXCLUDED.name, bio = EXCLUDED.bio, avatar = EXCLUDED.avatar,
        website_url = EXCLUDED.website_url, x_url = EXCLUDED.x_url, telegram_url = EXCLUDED.telegram_url,
        total_trades = EXCLUDED.total_trades, nonce = EXCLUDED.nonce, state = EXCLUDED.state, referrer = EXCLUDED.referrer,
        referral_count_l1 = EXCLUDED.referral_count_l1, referral_count_l2 = EXCLUDED.referral_count_l2,
        referral_count_l3 = EXCLUDED.referral_count_l3, referral_count_l4 = EXCLUDED.referral_count_l4,
        referral_count_l5 = EXCLUDED.referral_count_l5, total_referrals = EXCLUDED.total_referrals,
        referral_earnings_l1 = EXCLUDED.referral_earnings_l1, referral_earnings_l2 = EXCLUDED.referral_earnings_l2,
        referral_earnings_l3 = EXCLUDED.referral_earnings_l3, referral_earnings_l4 = EXCLUDED.referral_earnings_l4,
        referral_earnings_l5 = EXCLUDED.referral_earnings_l5, referral_earnings_total = EXCLUDED.referral_earnings_total,
        last_activity = EXCLUDED.last_activity, created_at = EXCLUDED.created_at, owned_token_ids = EXCLUDED.owned_token_ids`,
      [
        id,
        d.wallet ?? null,
        d.firebaseUid ?? null,
        d.email ?? null,
        d.username ?? null,
        d.name ?? null,
        d.bio ?? null,
        d.avatar ?? null,
        d.websiteUrl ?? null,
        d.xUrl ?? null,
        d.telegramUrl ?? null,
        typeof d.totalTrades === "number" ? d.totalTrades : 0,
        d.nonce ?? null,
        d.state ?? "CONNECTED",
        d.referrer ?? null,
        typeof d.referralCountL1 === "number" ? d.referralCountL1 : 0,
        typeof d.referralCountL2 === "number" ? d.referralCountL2 : 0,
        typeof d.referralCountL3 === "number" ? d.referralCountL3 : 0,
        typeof d.referralCountL4 === "number" ? d.referralCountL4 : 0,
        typeof d.referralCountL5 === "number" ? d.referralCountL5 : 0,
        typeof d.totalReferrals === "number" ? d.totalReferrals : 0,
        String(d.referralEarningsL1 ?? "0"),
        String(d.referralEarningsL2 ?? "0"),
        String(d.referralEarningsL3 ?? "0"),
        String(d.referralEarningsL4 ?? "0"),
        String(d.referralEarningsL5 ?? "0"),
        String(d.referralEarningsTotal ?? "0"),
        lastActivity,
        createdAt,
        ownedTokenIds,
      ]
    );
  }
  console.log("  users:", snap.size, "docs");
  return snap.size;
}

async function migrateUserActivities(db) {
  const snap = await db.collection("user_activities").get();
  for (const doc of snap.docs) {
    const d = doc.data();
    const createdAt = toPgTs(d.createdAt) || new Date().toISOString();
    await query(
      `INSERT INTO user_activities (wallet, type, token_id, price, tx_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz)`,
      [
        d.wallet ?? "",
        d.type ?? "",
        d.tokenId ?? null,
        d.price != null ? String(d.price) : null,
        d.txHash ?? null,
        createdAt,
      ]
    );
  }
  console.log("  user_activities:", snap.size, "docs");
  return snap.size;
}

async function migrateNftPurchases(db) {
  const snap = await db.collection("nft_purchases").get();
  for (const doc of snap.docs) {
    const d = doc.data();
    const id = doc.id;
    const createdAt = toPgTs(d.createdAt) || new Date().toISOString();
    await query(
      `INSERT INTO nft_purchases (id, buyer, seller, token_id, price, tx_hash, event_id, block_number, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      [
        id,
        d.buyer ?? "",
        d.seller ?? null,
        d.tokenId ?? "",
        String(d.price ?? "0"),
        d.txHash ?? null,
        d.eventId ?? null,
        typeof d.blockNumber === "number" ? d.blockNumber : null,
        createdAt,
      ]
    );
  }
  console.log("  nft_purchases:", snap.size, "docs");
  return snap.size;
}

async function migrateAdmins(db) {
  const snap = await db.collection("admins").get();
  for (const doc of snap.docs) {
    const d = doc.data();
    const wallet = doc.id;
    const createdAt = toPgTs(d.createdAt);
    const updatedAt = toPgTs(d.updatedAt) || createdAt;
    await query(
      `INSERT INTO admins (wallet, nonce, created_at, updated_at)
       VALUES ($1, $2, $3::timestamptz, $4::timestamptz)
       ON CONFLICT (wallet) DO UPDATE SET nonce = EXCLUDED.nonce, updated_at = EXCLUDED.updated_at`,
      [wallet, d.nonce ?? null, createdAt, updatedAt]
    );
  }
  console.log("  admins:", snap.size, "docs");
  return snap.size;
}

async function migrateBotControl(db) {
  const doc = await db.collection("bot_control").doc("bots").get();
  if (!doc.exists) {
    console.log("  bot_control: no doc");
    return 0;
  }
  const d = doc.data();
  const runningByBotId = d.runningByBotId && typeof d.runningByBotId === "object" ? JSON.stringify(d.runningByBotId) : "{}";
  const updatedAt = toPgTs(d.updatedAt);
  await query(
    `INSERT INTO bot_control (id, running_by_bot_id, updated_at)
     VALUES ('bots', $1::jsonb, $2::timestamptz)
     ON CONFLICT (id) DO UPDATE SET running_by_bot_id = EXCLUDED.running_by_bot_id, updated_at = EXCLUDED.updated_at`,
    [runningByBotId, updatedAt]
  );
  console.log("  bot_control: 1 doc");
  return 1;
}

async function migrateAdminSettings(db) {
  const doc = await db.collection("admin_settings").doc("contracts").get();
  if (!doc.exists) {
    console.log("  admin_settings: no doc");
    return 0;
  }
  const d = doc.data();
  const addresses = d.addresses && typeof d.addresses === "object" ? JSON.stringify(d.addresses) : "{}";
  const updatedAt = toPgTs(d.updatedAt);
  await query(
    `INSERT INTO admin_settings (id, addresses, updated_at, updated_by)
     VALUES ('contracts', $1::jsonb, $2::timestamptz, $3)
     ON CONFLICT (id) DO UPDATE SET addresses = EXCLUDED.addresses, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
    [addresses, updatedAt, d.updatedBy ?? null]
  );
  console.log("  admin_settings: 1 doc");
  return 1;
}

async function migrateMarketplaceProcessedSales(db) {
  const snap = await db.collection("marketplace_processed_sales").get();
  for (const doc of snap.docs) {
    const d = doc.data();
    const eventId = doc.id;
    const payload = JSON.stringify(toPlainJson(d));
    const createdAt = toPgTs(d.createdAt);
    await query(
      `INSERT INTO marketplace_processed_sales (event_id, payload, created_at)
       VALUES ($1, $2::jsonb, $3::timestamptz)
       ON CONFLICT (event_id) DO NOTHING`,
      [eventId, payload, createdAt]
    );
  }
  console.log("  marketplace_processed_sales:", snap.size, "docs");
  return snap.size;
}

async function migrateMeta(db) {
  const keys = ["marketplaceActivityIndexer", "referralIndexer", "marketplace_listing_blocks"];
  let count = 0;
  for (const key of keys) {
    const doc = await db.collection("meta").doc(key).get();
    if (!doc.exists) continue;
    const d = doc.data();
    const data = JSON.stringify(toPlainJson(d));
    const updatedAt = toPgTs(d.updatedAt);
    await query(
      `INSERT INTO meta (key, data, updated_at)
       VALUES ($1, $2::jsonb, $3::timestamptz)
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
      [key, data, updatedAt]
    );
    count++;
  }
  console.log("  meta:", count, "docs");
  return count;
}

async function main() {
  console.log("Firestore → PostgreSQL migration\n");

  const db = getFirestore();
  if (!db) {
    console.error("Firestore not configured. Set Firebase credentials in .env.");
    process.exit(1);
  }

  const pool = getPool();
  if (!pool) {
    console.error("PostgreSQL not configured. Set PGHOST, PGDATABASE, PGUSER in .env.");
    process.exit(1);
  }

  try {
    await pool.query("SELECT 1");
  } catch (e) {
    console.error("PostgreSQL unreachable:", e?.message);
    process.exit(1);
  }

  try {
    console.log("Migrating collections...");
    await migrateUsers(db);
    await migrateUserActivities(db);
    await migrateNftPurchases(db);
    await migrateAdmins(db);
    await migrateBotControl(db);
    await migrateAdminSettings(db);
    await migrateMarketplaceProcessedSales(db);
    await migrateMeta(db);
    console.log("\nMigration finished.");
  } catch (e) {
    console.error("Migration error:", e?.message || e);
    process.exit(1);
  }
  process.exit(0);
}

main();
