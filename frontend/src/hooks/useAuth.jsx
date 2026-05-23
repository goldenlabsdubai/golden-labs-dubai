import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import { SiweMessage } from "siwe";
import { API } from "../config";
import { recordTradingGateIfEligible, clearTradingRouteGate } from "../utils/tradingRouteGate";
import { isWalletTxInFlight } from "../utils/appNavigation";

const TOKEN_KEY = "gl_token";
const USER_KEY = "gl_user";

function responseLooksLikeApiJson(res) {
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json");
}
/** Bump this string after DB wipes / contract redeploys to force-clear cached auth for all clients on next load. */
const AUTH_STORAGE_VERSION_KEY = "gl_auth_storage_v";
const AUTH_STORAGE_VERSION = "2";

function applyAuthStorageMigration() {
  try {
    if (localStorage.getItem(AUTH_STORAGE_VERSION_KEY) === AUTH_STORAGE_VERSION) return;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.setItem(AUTH_STORAGE_VERSION_KEY, AUTH_STORAGE_VERSION);
  } catch {
    /* storage disabled */
  }
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  applyAuthStorageMigration();
  const { address: connectedWallet } = useAccount();
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY));
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(false);
  /** Bumps on each refresh start so stale / slower responses never clear the session after a newer refresh. */
  const refreshGenRef = useRef(0);

  const refreshUser = useCallback(async () => {
    const readToken = () => {
      try {
        return localStorage.getItem(TOKEN_KEY);
      } catch {
        return null;
      }
    };

    const buildHeaders = (t) => {
      const headers = { Authorization: `Bearer ${t}` };
      if (connectedWallet) headers["X-Connected-Wallet"] = connectedWallet;
      return headers;
    };

    const gen = ++refreshGenRef.current;
    const t = readToken();
    if (!t) return;

    const applyUser = (u) => {
      setUser(u);
      localStorage.setItem(USER_KEY, JSON.stringify(u));
      if (u?.state === "SUSPENDED") clearTradingRouteGate();
      else recordTradingGateIfEligible(u);
    };

    const clearSession = () => {
      clearTradingRouteGate();
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      flushSync(() => {
        setToken(null);
        setUser(null);
      });
    };

    try {
      let r = await fetch(`${API}/user/me`, { headers: buildHeaders(t) });
      if (gen !== refreshGenRef.current) return;

      if (r.ok) {
        const u = await r.json();
        if (gen !== refreshGenRef.current) return;
        applyUser(u);
        return;
      }

      if (r.status === 401 || r.status === 404) {
        // MetaMask / mobile: transient proxy or timing — retry once before dropping session.
        await new Promise((res) => setTimeout(res, 450));
        if (gen !== refreshGenRef.current) return;
        const t2 = readToken();
        if (!t2 || t2 !== t) return;

        r = await fetch(`${API}/user/me`, { headers: buildHeaders(t2) });
        if (gen !== refreshGenRef.current) return;

        if (r.ok) {
          const u = await r.json();
          if (gen !== refreshGenRef.current) return;
          applyUser(u);
          return;
        }

        // Avoid nuking login on HTML/error pages that return 401 (captive portals, CDN glitches).
        if ((r.status === 401 || r.status === 404) && responseLooksLikeApiJson(r)) {
          if (gen !== refreshGenRef.current) return;
          if (readToken() !== t2) return;
          if (isWalletTxInFlight()) return;
          clearSession();
        }
      }
    } catch {
      // Network error — keep session
    }
  }, [connectedWallet]);

  // Debounce: wallet address often flaps undefined→address while MetaMask handles a tx; avoids refresh storms and spurious logouts.
  useEffect(() => {
    if (!token) return;
    const id = setTimeout(() => {
      refreshUser();
    }, 320);
    return () => clearTimeout(id);
  }, [token, refreshUser, connectedWallet]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(USER_KEY);
      if (!raw) return;
      recordTradingGateIfEligible(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  const connect = async () => {
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();

      const { nonce } = await (await fetch(`${API}/auth/nonce/${address}`)).json();
      const chainId = (await provider.getNetwork()).chainId;
      const siweMsg = new SiweMessage({
        domain: window.location.host,
        address,
        statement: "Welcome to Golden Labs! Sign this message to sign in and continue.",
        uri: window.location.origin,
        version: "1",
        chainId: Number(chainId),
        nonce
      });
      const message = siweMsg.prepareMessage();
      const signature = await signer.signMessage(message);

      const res = await fetch(`${API}/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Auth failed");

      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      flushSync(() => {
        setToken(data.token);
        setUser(data.user);
      });
      if (data.user?.state === "SUSPENDED") clearTradingRouteGate();
      else recordTradingGateIfEligible(data.user);
      return data.redirect;
    } catch (e) {
      console.error(e);
      throw e;
    }
  };

  const logout = useCallback(() => {
    clearTradingRouteGate();
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    flushSync(() => {
      setToken(null);
      setUser(null);
    });
  }, []);

  const setSession = useCallback((newToken, newUser) => {
    flushSync(() => {
      if (newToken) localStorage.setItem(TOKEN_KEY, newToken);
      if (newUser) localStorage.setItem(USER_KEY, JSON.stringify(newUser));
      setToken(newToken || null);
      setUser(newUser || null);
    });
    if (!newToken && !newUser) clearTradingRouteGate();
    else if (newUser?.state === "SUSPENDED") clearTradingRouteGate();
    else if (newUser) recordTradingGateIfEligible(newUser);
  }, []);

  const value = { token, user, loading, connect, logout, refreshUser, setSession };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
