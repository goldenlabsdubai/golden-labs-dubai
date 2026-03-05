/**
 * Seed Firestore "admins" collection with the default admin wallet.
 * Run from backend folder: npm run seed-admins
 * Requires: FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON in backend .env
 */
import "dotenv/config";
import { getFirestore } from "../src/config/firebase.js";

const ADMINS_COLLECTION = "admins";
const DEFAULT_ADMIN_WALLET = "0xbdf976981242e8078b525e78784bf87c3b9da4ca";

async function main() {
  const db = getFirestore();
  if (!db) {
    console.error("Firestore not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON in backend .env");
    process.exit(1);
  }
  const ref = db.collection(ADMINS_COLLECTION).doc(DEFAULT_ADMIN_WALLET);
  const doc = await ref.get();
  if (doc.exists) {
    console.log("Admin already exists:", DEFAULT_ADMIN_WALLET);
    process.exit(0);
  }
  await ref.set({ wallet: DEFAULT_ADMIN_WALLET, createdAt: new Date() });
  console.log("Seeded admin wallet in Firestore collection 'admins':", DEFAULT_ADMIN_WALLET);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
