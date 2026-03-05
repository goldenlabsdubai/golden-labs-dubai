import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import { SiweMessage } from "siwe";
import { API } from "../config";

const TOKEN_KEY = "gl_token";
const USER_KEY = "gl_user";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
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

  const refreshUser = useCallback(async () => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) return;
    const headers = { Authorization: `Bearer ${t}` };
    if (connectedWallet) headers["X-Connected-Wallet"] = connectedWallet;
    try {
      const r = await fetch(`${API}/user/me`, { headers });
      if (r.ok) {
        const u = await r.json();
        setUser(u);
        localStorage.setItem(USER_KEY, JSON.stringify(u));
      } else if (r.status === 401) {
        // Stale or invalid token – clear session (no console error)
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setToken(null);
        setUser(null);
      }
    } catch {
      // Network error etc – avoid spamming console
    }
  }, [connectedWallet]);

  useEffect(() => {
    if (token) refreshUser();
  }, [token, refreshUser, connectedWallet]);

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
      setToken(data.token);
      setUser(data.user);
      return data.redirect;
    } catch (e) {
      console.error(e);
      throw e;
    }
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  };

  const setSession = (newToken, newUser) => {
    if (newToken) localStorage.setItem(TOKEN_KEY, newToken);
    if (newUser) localStorage.setItem(USER_KEY, JSON.stringify(newUser));
    setToken(newToken || null);
    setUser(newUser || null);
  };

  const value = { token, user, loading, connect, logout, refreshUser, setSession };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
