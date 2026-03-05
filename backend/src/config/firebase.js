/**
 * Firebase Admin SDK – verify ID tokens from Firebase Auth (email/password, Google, etc.).
 * Local: FIREBASE_SERVICE_ACCOUNT_PATH (path to JSON key file)
 * Vercel: FIREBASE_SERVICE_ACCOUNT_JSON (stringified JSON) – no file access on serverless
 */
import path from "path";
import fs from "fs";
import admin from "firebase-admin";

let app = null;

export function getFirebaseAdmin() {
  if (app) return app;
  const pathEnv = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || undefined;
  const options = { storageBucket };
  const isVercel = !!process.env.VERCEL;

  try {
    // Vercel/serverless: only JSON works (no file system for keys)
    if (isVercel) {
      if (!json) {
        console.warn("Firebase: on Vercel set FIREBASE_SERVICE_ACCOUNT_JSON in Environment Variables (JSON string)");
        return null;
      }
      const key = typeof json === "string" ? JSON.parse(json) : json;
      options.credential = admin.credential.cert(key);
    } else if (json) {
      const key = typeof json === "string" ? JSON.parse(json) : json;
      options.credential = admin.credential.cert(key);
    } else if (pathEnv) {
      const resolved = path.isAbsolute(pathEnv) ? pathEnv : path.resolve(process.cwd(), pathEnv);
      if (!fs.existsSync(resolved)) {
        console.warn("Firebase: key file not found:", resolved);
        return null;
      }
      options.credential = admin.credential.cert(resolved);
    } else {
      console.warn("Firebase: set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON");
      return null;
    }
    app = admin.initializeApp(options);
    return app;
  } catch (e) {
    console.error("Firebase init failed:", e?.message || e);
    return null;
  }
}

export function getFirestore() {
  const firebase = getFirebaseAdmin();
  if (!firebase) return null;
  return admin.firestore();
}

/** Firebase Storage bucket for avatar uploads. Set FIREBASE_STORAGE_BUCKET in .env (e.g. your-project.appspot.com). */
export function getStorageBucket() {
  const firebase = getFirebaseAdmin();
  if (!firebase || !firebase.options?.storageBucket) return null;
  return admin.storage().bucket(firebase.options.storageBucket);
}

export async function verifyIdToken(idToken) {
  const firebase = getFirebaseAdmin();
  if (!firebase) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return { uid: decoded.uid, email: decoded.email || null };
  } catch (e) {
    console.warn("Firebase verifyIdToken:", e.message);
    return null;
  }
}

/**
 * Update Firebase Auth user profile (displayName, photoURL) so Auth stays in sync with Firestore.
 * Call after updating user in Firestore when req.firebaseUid is present.
 */
export async function updateAuthUser(uid, { displayName, photoURL }) {
  const firebase = getFirebaseAdmin();
  if (!firebase || !uid) return;
  try {
    const updates = {};
    if (displayName !== undefined) updates.displayName = displayName || null;
    if (photoURL !== undefined) updates.photoURL = photoURL || null;
    if (Object.keys(updates).length === 0) return;
    await admin.auth().updateUser(uid, updates);
  } catch (e) {
    console.warn("Firebase updateAuthUser:", e.message);
  }
}
