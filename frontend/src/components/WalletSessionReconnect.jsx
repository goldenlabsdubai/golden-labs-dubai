import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useAccount, useConfig, useReconnect } from "wagmi";
import { getAccount } from "wagmi/actions";
import { useAuth } from "../hooks/useAuth";

const RECONNECT_COOLDOWN_MS = 3200;

/**
 * After SIWE, wagmi can stay “disconnected” until `reconnect` runs (mobile browsers, wallet in-app WebViews, tab backgrounding).
 * Re-run reconnect when the signed-in user navigates or returns to the tab so `address` stays in sync with the JWT profile wallet.
 */
export default function WalletSessionReconnect() {
  const { token, user } = useAuth();
  const { address, status } = useAccount();
  const config = useConfig();
  const { reconnectAsync } = useReconnect();
  const { pathname } = useLocation();
  const lastReconnectAtRef = useRef(0);
  const reconnectAsyncRef = useRef(reconnectAsync);
  reconnectAsyncRef.current = reconnectAsync;

  const profileWallet = token && user?.wallet ? String(user.wallet).toLowerCase() : "";
  const live = address ? String(address).toLowerCase() : "";

  useEffect(() => {
    if (!profileWallet) return;
    if (live === profileWallet) return;
    if (status === "connecting" || status === "reconnecting") return;
    // Another wallet is connected — don’t auto-reconnect (user must switch in the wallet or disconnect).
    if (live && live !== profileWallet) return;

    const run = () => {
      try {
        const a = getAccount(config).address;
        if (a && String(a).toLowerCase() === profileWallet) return;
      } catch {
        /* ignore */
      }
      reconnectAsyncRef.current().catch(() => {});
    };

    /** Embedded browsers fire focus/visibility often; avoid reconnect storms that freeze the WebView. */
    const runThrottled = () => {
      const now = Date.now();
      if (now - lastReconnectAtRef.current < RECONNECT_COOLDOWN_MS) return;
      lastReconnectAtRef.current = now;
      run();
    };

    run();
    const t1 = setTimeout(run, 450);
    const t2 = setTimeout(run, 1400);

    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      runThrottled();
    };
    const onFocus = () => runThrottled();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
    };
  }, [profileWallet, live, status, pathname, config]);

  return null;
}
