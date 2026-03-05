/**
 * SIWE (Sign-In with Ethereum) using the wallet connected via Reown AppKit (wagmi).
 * Uses useSignMessage from wagmi to sign the SIWE message, then POSTs to backend.
 */
import { useState, useEffect } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { SiweMessage } from "siwe";
import { API } from "../config";

const TOKEN_KEY = "gl_token";
const USER_KEY = "gl_user";

export function useSignInWithWallet() {
  const { address, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(false);

  // Reset loading when wallet disconnects so "Continue" is clickable again after reconnect
  useEffect(() => {
    if (!address) setLoading(false);
  }, [address]);

  const isNetworkError = (e) => {
      if (!e || typeof e.message !== "string") return false;
      const m = e.message.toLowerCase();
      return e.name === "TypeError" && (m.includes("failed to fetch") || m.includes("network request failed")) || m.includes("connection refused") || m.includes("err_connection_refused");
    };

    const signIn = async () => {
      if (!address || !chainId || !signMessageAsync) {
        throw new Error("Wallet not connected");
      }
      setLoading(true);
      try {
        let nonceRes;
        try {
          nonceRes = await fetch(`${API}/auth/nonce/${address}`);
        } catch (e) {
          if (isNetworkError(e)) throw new Error("Cannot reach server. Make sure the backend is running (e.g. npm run dev in the backend folder).");
          throw e;
        }
        const nonceData = await nonceRes.json().catch(() => ({}));
        const nonce = nonceData.nonce;
        if (!nonce) throw new Error(nonceData.error || "Failed to get sign-in nonce");

        const siweMsg = new SiweMessage({
          domain: typeof window !== "undefined" ? window.location.host : "",
          address,
          statement: "Welcome to Golden Labs! Sign this message to sign in and continue.",
          uri: typeof window !== "undefined" ? window.location.origin : "",
          version: "1",
          chainId: Number(chainId),
          nonce,
        });
        const message = siweMsg.prepareMessage();
        const signature = await signMessageAsync({ message });

        const referrer = typeof sessionStorage !== "undefined" ? sessionStorage.getItem("gl_ref") : null;
        let verifyRes;
        try {
          verifyRes = await fetch(`${API}/auth/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message, signature, referrer: referrer || undefined }),
          });
        } catch (e) {
          if (isNetworkError(e)) throw new Error("Cannot reach server. Make sure the backend is running (e.g. npm run dev in the backend folder).");
          throw e;
        }
        const data = await verifyRes.json().catch(() => ({}));
        if (!verifyRes.ok) throw new Error(data.error || "Auth failed");

        if (referrer && typeof sessionStorage !== "undefined") sessionStorage.removeItem("gl_ref");
        localStorage.setItem(TOKEN_KEY, data.token);
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        return { token: data.token, user: data.user, redirect: data.redirect };
      } finally {
        setLoading(false);
      }
    };

  return { signIn, loading };
}
