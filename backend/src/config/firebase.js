/**
 * Firebase Admin SDK – verify ID tokens from Firebase Auth (email/password, Google, etc.).
 * Set FIREBASE_SERVICE_ACCOUNT_PATH (path to JSON key file) or
 * FIREBASE_SERVICE_ACCOUNT_JSON (stringified JSON) in .env.
 */
import path from "path";
import admin from "firebase-admin";

let app = null;

export function getFirebaseAdmin() {
  if (app) return app;
  const pathEnv = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const jsonEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || undefined;
  const options = { storageBucket };

  const tryParseJson = (raw) => {
    if (raw == null || raw === "") return null;
    const s = typeof raw === "string" ? raw.trim() : String(raw);
    if (s.startsWith("{")) {
      try {
        return JSON.parse(s);
      } catch (e) {
        console.warn("Firebase: invalid JSON in credential env", e.message);
        return null;
      }
    }
    return null;
  };

  // Prefer explicit JSON env (Vercel: set FIREBASE_SERVICE_ACCOUNT_JSON to the stringified key)
  let key = tryParseJson(jsonEnv);
  if (key) {
    options.credential = admin.credential.cert(key);
  } else if (pathEnv) {
    const pathVal = pathEnv.trim();
    // If PATH was set to the JSON string by mistake (e.g. on Vercel), use it as JSON
    key = tryParseJson(pathVal);
    if (key) {
      options.credential = admin.credential.cert(key);
    } else {
      const resolved = path.isAbsolute(pathVal) ? pathVal : path.resolve(process.cwd(), pathVal);
      options.credential = admin.credential.cert(resolved);
    }
  } else {
    console.warn("Firebase: set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON in .env");
    return null;
  }
  app = admin.initializeApp(options);
  return app;
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
