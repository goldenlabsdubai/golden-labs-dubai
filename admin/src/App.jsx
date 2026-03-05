import { useState, useEffect, useCallback } from "react";
import { useAppKit } from "@reown/appkit/react";
import { useAccount, useSignMessage } from "wagmi";
import { SiweMessage } from "siwe";
import BotsPage from "./pages/BotsPage";
import ContractsPage from "./pages/ContractsPage";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001/api";
const TOKEN_KEY = "gl_admin_token";
const BOTS_REFRESH_MS = Number(import.meta.env.VITE_BOTS_REFRESH_MS || 10000);
const BOTS_REQUEST_TIMEOUT_MS = Number(import.meta.env.VITE_BOTS_REQUEST_TIMEOUT_MS || 15000);

async function fetchWithTimeout(url, options = {}, timeoutMs = BOTS_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export default function App() {
  const { open } = useAppKit();
  const { address, isConnected, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [wallet, setWallet] = useState(null);
  const [bots, setBots] = useState([]);
  const [signingIn, setSigningIn] = useState(false);
  const [botsLoading, setBotsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [error, setError] = useState("");
  const [togglingId, setTogglingId] = useState(null);
  const [activeTab, setActiveTab] = useState("bots");

  const openWalletModal = useCallback(() => {
    queueMicrotask(() => open());
  }, [open]);

  // After wallet connect: sign SIWE and get admin token (only when connected and no token yet)
  useEffect(() => {
    if (!isConnected || !address || token || signingIn || !chainId) return;
    setSigningIn(true);
    setError("");
    (async () => {
      try {
        const { nonce } = await (await fetch(`${API}/auth/nonce/${address}`)).json();
        const message = new SiweMessage({
          domain: window.location.host,
          address,
          statement: "Sign in to Golden Labs Admin.",
          uri: window.location.origin,
          version: "1",
          chainId: Number(chainId),
          nonce,
        });
        const signature = await signMessageAsync({ message: message.prepareMessage() });
        const res = await fetch(`${API}/auth/admin-login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: message.prepareMessage(), signature }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Login failed");
        localStorage.setItem(TOKEN_KEY, data.token);
        setToken(data.token);
        setWallet(data.user?.wallet || address);
      } catch (e) {
        setError(e?.message || "Sign-in failed");
      } finally {
        setSigningIn(false);
      }
    })();
  }, [isConnected, address, chainId, signMessageAsync, token, signingIn]);

  const loadBots = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setBotsLoading(true);
    if (silent) setRefreshing(true);
    try {
      const r = await fetchWithTimeout(
        `${API}/admin/bots`,
        { headers: { Authorization: `Bearer ${token}` } },
        BOTS_REQUEST_TIMEOUT_MS
      );
      if (r.status === 403) throw new Error("Not an admin wallet");
      if (!r.ok) {
        let message = "Failed to load bots";
        try {
          const payload = await r.json();
          if (payload?.error) message = payload.error;
        } catch (_) {}
        throw new Error(message);
      }
      const d = await r.json();
      setBots(d.bots || []);
      setLastUpdatedAt(d.serverTime || Date.now());
      setError("");
    } catch (e) {
      const reason = e?.name === "AbortError" ? "Bots request timeout" : (e?.message || "Failed to load bots");
      setError(reason);
      throw e;
    } finally {
      if (!silent) setBotsLoading(false);
      if (silent) setRefreshing(false);
    }
  }, [token]);

  // Load data when token exists
  useEffect(() => {
    if (!token) {
      setBotsLoading(false);
      return;
    }
    setError("");
    (async () => {
      try {
        await loadBots();
      } catch (e) {
        setError(e.message || "Failed to load admin data");
        setBotsLoading(false);
      }
    })();
  }, [token, loadBots]);

  // Live bots data refresh while Bots tab is open
  useEffect(() => {
    if (!token || activeTab !== "bots") return;
    const id = setInterval(() => {
      loadBots({ silent: true }).catch(() => {});
    }, Math.max(3000, BOTS_REFRESH_MS));
    return () => clearInterval(id);
  }, [token, activeTab, loadBots]);

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setWallet(null);
    setBots([]);
    setLastUpdatedAt(null);
    setError("");
    setActiveTab("bots");
  };

  const handleStart = async (id) => {
    setTogglingId(id);
    setError("");
    try {
      const r = await fetch(`${API}/admin/bots/${id}/start`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error("Failed to start");
      await loadBots();
    } catch (e) {
      setError(e.message);
    } finally {
      setTogglingId(null);
    }
  };

  const handleStop = async (id) => {
    setTogglingId(id);
    setError("");
    try {
      const r = await fetch(`${API}/admin/bots/${id}/stop`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error("Failed to stop");
      await loadBots();
    } catch (e) {
      setError(e.message);
    } finally {
      setTogglingId(null);
    }
  };

  if (!token) {
    return (
      <div className="login">
        <div className="login__card">
          <h1 className="login__title">Golden Labs Admin</h1>
          <p className="login__hint">Connect your admin wallet to manage bots and settings.</p>
          <button
            type="button"
            className="login__btn"
            onClick={openWalletModal}
            disabled={signingIn}
          >
            {signingIn ? "Signing in..." : isConnected ? "Sign in" : "Connect wallet"}
          </button>
          {error && <p className="login__error">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="admin">
      <header className="admin__header">
        <h1 className="admin__title">Golden Labs Admin</h1>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <span className="admin__wallet" title={wallet}>
            {wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : ""}
          </span>
          <button type="button" className="admin__disconnect" onClick={logout}>Disconnect</button>
        </div>
      </header>

      <nav className="admin__nav">
        <button
          type="button"
          className={`nav__link ${activeTab === "bots" ? "nav__link--active" : ""}`}
          onClick={() => setActiveTab("bots")}
        >
          Bots Page
        </button>
        <button
          type="button"
          className={`nav__link ${activeTab === "contracts" ? "nav__link--active" : ""}`}
          onClick={() => setActiveTab("contracts")}
        >
          Contracts Setup Page
        </button>
      </nav>

      {activeTab === "bots" ? (
        <BotsPage
          bots={bots}
          botsLoading={botsLoading}
          refreshing={refreshing}
          lastUpdatedAt={lastUpdatedAt}
          error={error}
          togglingId={togglingId}
          onRefresh={() => loadBots({ silent: true }).catch(() => {})}
          onStart={handleStart}
          onStop={handleStop}
        />
      ) : (
        <ContractsPage connectedWallet={address} />
      )}
    </div>
  );
}
