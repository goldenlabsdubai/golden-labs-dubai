/**
 * Firebase email/password login – sign in, get ID token, POST to backend /auth/firebase.
 */
import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../config/firebase";
import { API } from "../config";

export function useFirebaseAuth() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loginWithEmail = async (email, password) => {
    if (!auth) {
      throw new Error("Firebase not configured. Add VITE_FIREBASE_* to .env");
    }
    setLoading(true);
    setError("");
    try {
      const userCred = await signInWithEmailAndPassword(auth, email.trim(), password);
      const idToken = await userCred.user.getIdToken();
      const res = await fetch(`${API}/auth/firebase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Auth failed");
      return { token: data.token, user: data.user, redirect: data.redirect };
    } catch (e) {
      const msg = e.code === "auth/invalid-credential" || e.code === "auth/wrong-password"
        ? "Invalid email or password"
        : e.code === "auth/user-not-found"
          ? "No account for this email"
          : e.message || "Login failed";
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  };

  return { loginWithEmail, loading, error };
}
