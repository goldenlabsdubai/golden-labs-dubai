/**
 * Firebase client – Auth (email/password), optional Analytics.
 * Config from .env (VITE_FIREBASE_*).
 */
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getAnalytics } from "firebase/analytics";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

let app = null;
let auth = null;
let analytics = null;

if (config.apiKey && config.projectId) {
  app = initializeApp(config);
  auth = getAuth(app);
  if (config.measurementId && typeof window !== "undefined") {
    analytics = getAnalytics(app);
  }
}

export { auth, analytics };
export default app;
