import { useState, useEffect, useCallback } from "react";
import { useAppKit } from "@reown/appkit/react";
import { useAccount, useSignMessage } from "wagmi";
import { SiweMessage } from "siwe";
import BotsPage from "./pages/BotsPage";
import ContractsPage from "./pages/ContractsPage";

function normalizeApiBase(url) {
  return String(url || "")
    .trim()
    .replace(/\/+$/, "");
}

/** Backend base must include /api (e.g. http://localhost:3001/api). Dev default avoids broken relative fetches to the Vite server. */
const API = normalizeApiBase(
  import.meta.env.VITE_API_URL?.trim() || (import.meta.env.DEV ? "http://localhost:3001/api" : "")
);
const TOKEN_KEY = "gl_admin_token";
const BOTS_REFRESH_MS = Number(import.meta.env.VITE_BOTS_REFRESH_MS || 10000);
const BOTS_REQUEST_TIMEOUT_MS = Number(import.meta.env.VITE_BOTS_REQUEST_TIMEOUT_MS || 45000);

async function fetchWithTimeout(url, options = {}, timeoutMs = BOTS_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isLikelyAbortedError(e) {
  const name = e?.name;
  if (name === "AbortError" || name === "TimeoutError") return true;
  const msg = String(e?.message || "").toLowerCase();
  return msg.includes("abort") || msg.includes("aborted");
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
  const [botSettings, setBotSettings] = useState({ buybackDelayMs: 60 * 60 * 1000, disableBotToBotBuys: true });
  const [savingBotSettings, setSavingBotSettings] = useState(false);

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
        const { nonce } = await (await fetch(`${API}/auth/admin-nonce/${address}`)).json();
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
      if (r.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setWallet(null);
        setBots([]);
        setError("Session expired or invalid token — disconnect and sign in again with your admin wallet.");
        return;
      }
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
      if (d.settings && typeof d.settings === "object") {
        setBotSettings({
          buybackDelayMs: Number(d.settings.buybackDelayMs) || 60 * 60 * 1000,
          disableBotToBotBuys: true,
        });
      } else {
        try {
          const s = await fetchWithTimeout(`${API}/admin/bots/settings`, { headers: { Authorization: `Bearer ${token}` } });
          if (s.ok) {
            const payload = await s.json();
            setBotSettings({
              buybackDelayMs: Number(payload?.settings?.buybackDelayMs) || 60 * 60 * 1000,
              disableBotToBotBuys: true,
            });
          }
        } catch (_) {}
      }
      setLastUpdatedAt(d.serverTime || Date.now());
      setError("");
    } catch (e) {
      const reason = isLikelyAbortedError(e)
        ? `Bots request timed out after ${BOTS_REQUEST_TIMEOUT_MS}ms — backend or RPC may be slow. Increase VITE_BOTS_REQUEST_TIMEOUT_MS in admin env and redeploy, or fix RPC on the server.`
        : (e?.message || "Failed to load bots");
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
        // loadBots() already set error; avoid overwriting with raw DOMException text (e.g. "signal is aborted without reason")
        if (!isLikelyAbortedError(e)) {
          setError(e?.message || "Failed to load admin data");
        }
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

  const handleSaveBotSettings = async ({ buybackDelayMinutes }) => {
    setSavingBotSettings(true);
    setError("");
    try {
      const mins = Number(buybackDelayMinutes);
      if (!Number.isFinite(mins) || mins < 1) {
        throw new Error("Buyback timeframe must be at least 1 minute");
      }
      const buybackDelayMs = Math.floor(mins * 60 * 1000);
      const r = await fetch(`${API}/admin/bots/settings`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ buybackDelayMs }),
      });
      const payload = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(payload?.error || "Failed to save bot settings");
      setBotSettings({
        buybackDelayMs: Number(payload?.settings?.buybackDelayMs) || buybackDelayMs,
        disableBotToBotBuys: true,
      });
    } catch (e) {
      setError(e?.message || "Failed to save bot settings");
    } finally {
      setSavingBotSettings(false);
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

  if (!API) {
    return (
      <div className="login">
        <div className="login__card">
          <h1 className="login__title">Missing API URL</h1>
          <p className="login__hint">
            Set <code>VITE_API_URL</code> when building the admin app (for example <code>https://your-api.example.com/api</code>),
            then rebuild. Relative requests would hit the admin host, not the backend.
          </p>
          <button type="button" className="login__btn" onClick={logout}>
            Disconnect
          </button>
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
          botSettings={botSettings}
          savingBotSettings={savingBotSettings}
          botsLoading={botsLoading}
          refreshing={refreshing}
          lastUpdatedAt={lastUpdatedAt}
          error={error}
          togglingId={togglingId}
          onRefresh={() => loadBots({ silent: true }).catch(() => {})}
          onStart={handleStart}
          onStop={handleStop}
          onSaveSettings={handleSaveBotSettings}
        />
      ) : (
        <ContractsPage connectedWallet={address} />
      )}
    </div>
  );
}
