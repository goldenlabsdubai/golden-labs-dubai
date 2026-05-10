import { useEffect, useRef } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAccount, useSwitchChain, useReconnect } from "wagmi";
import "./App.css";
import { useAuth } from "./hooks/useAuth";
import { withTradingGateOverlay } from "./utils/tradingRouteGate";
import ParticleNetwork from "./components/ParticleNetwork";
import SupportChat from "./components/SupportChat";
import MobileBottomNav from "./components/MobileBottomNav";
import PlatformMaintenanceOverlay from "./components/PlatformMaintenanceOverlay";
import { SeoHead } from "./components/SeoHead";
import { BSC_CHAIN_ID } from "./constants/chain";

/** Same keys as useAuth — read without waiting for context (fixes MM in-app race + deep links). */
function readStoredAuth() {
  if (typeof window === "undefined") return { lsToken: null, lsUser: null };
  try {
    const lsToken = localStorage.getItem("gl_token");
    if (!lsToken) return { lsToken: null, lsUser: null };
    let lsUser = null;
    try {
      lsUser = JSON.parse(localStorage.getItem("gl_user") || "null");
    } catch {
      /* ignore */
    }
    return { lsToken, lsUser };
  } catch {
    return { lsToken: null, lsUser: null };
  }
}

function ForceBscMainnet() {
  const { isConnected, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  useEffect(() => {
    if (!isConnected || chainId == null || chainId === BSC_CHAIN_ID) return;
    switchChainAsync({ chainId: BSC_CHAIN_ID }).catch(() => {});
  }, [isConnected, chainId, switchChainAsync]);
  return null;
}

/** Restore wagmi connection from storage once when app loads so the same wallet stays connected across all pages. */
function ReconnectOnLoad() {
  const { mutate: reconnect } = useReconnect();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    reconnect();
  }, [reconnect]);
  return null;
}
import Landing from "./pages/Landing";
import Profile from "./pages/Profile";
import ProfileSetup from "./pages/ProfileSetup";
import Subscription from "./pages/Subscription";
import Mint from "./pages/Mint";
import Marketplace from "./pages/Marketplace";
import Dashboard from "./pages/Dashboard";
import Leaderboard from "./pages/Leaderboard";
import UserProfile from "./pages/UserProfile";

/**
 * Onboarding funnel (matches SubscriptionContract + NFT gates):
 * 1) Wallet connect → profile (username + SIWE) → state PROFILE_SET
 * 2) Subscription page until chain reports active subscription (isSubscribed on contract)
 * 3) Mint page until minted (or holding NFT) → state MINTED → dashboard / marketplace / leaderboard
 *
 * Suspended (on-chain): inactivity past `inactivityDays` (e.g. 5) OR cumulative marketplace
 * trading-income profit ≥ `profitThreshold` (e.g. $50 USDT) → must re-subscribe.
 * DB state SUSPENDED: only /subscription is allowed; everything else redirects there.
 *
 * Desktop and mobile use the same rules; `canAccessTradingNav` controls marketplace nav links.
 * Listing/buy DB sync (`/marketplace/record-purchase`, `/marketplace/my-listings`) re-checks
 * active subscription + mint on the server’s configured contracts (env addresses + RPC).
 *
 * Bots (`user.isBot`): skip subscription + mint pages; always use marketplace/trading routes.
 * Re-subscribed users who already hold an NFT: `hasMinted` from /me is true → not sent back to /mint.
 */
function ProtectedRoute({ children, require }) {
  const { token, user, loading, setSession } = useAuth();
  const location = useLocation();
  const storageSyncRef = useRef({ lastToken: null, didSync: false });
  const { lsToken, lsUser } = readStoredAuth();
  const effectiveToken = token || lsToken;
  const effectiveUser = user ?? lsUser;

  useEffect(() => {
    if (token) {
      storageSyncRef.current = { lastToken: token, didSync: false };
      return;
    }
    if (!lsToken) {
      storageSyncRef.current = { lastToken: null, didSync: false };
      return;
    }
    const { lastToken, didSync } = storageSyncRef.current;
    if (didSync && lastToken === lsToken) return;
    storageSyncRef.current = { lastToken: lsToken, didSync: true };
    let u = null;
    try {
      u = JSON.parse(localStorage.getItem("gl_user") || "null");
    } catch {
      /* ignore */
    }
    setSession(lsToken, u);
  }, [token, lsToken, setSession]);

  if (loading) return <div className="app-loading">Loading...</div>;
  if (!effectiveToken) return <Navigate to="/" replace />;

  // Raw suspension always wins — never use optimistic overlay.
  if (effectiveUser?.state === "SUSPENDED") {
    if (require === "subscription") return children;
    return <Navigate to="/subscription" replace state={{ from: location.pathname }} />;
  }

  /** Stabilizes route rules when /user/me briefly downgrades state during wallet/RPC activity. */
  const gateUser = withTradingGateOverlay(effectiveUser);
  const isBot = Boolean(gateUser?.isBot);

  if (isBot && require === "subscription") {
    return <Navigate to="/marketplace" replace />;
  }
  if (isBot && require === "mint") {
    return <Navigate to="/marketplace" replace />;
  }

  const active =
    isBot ||
    gateUser?.state === "SUBSCRIBED" ||
    gateUser?.state === "MINTED" ||
    gateUser?.state === "ACTIVE_TRADER";

  // Not subscribed (and not suspended): profile then subscription; block mint + marketplace
  if (!active) {
    if (!gateUser?.username && location.pathname !== "/profile") return <Navigate to="/profile" replace />;
    if (require === "profile") return children;
    if (require === "subscription") return children;
    // Trying to visit mint or marketplace without active subscription → subscription
    return <Navigate to="/subscription" replace state={{ from: location.pathname }} />;
  }

  // First-time subscribe → mint before trading. Re-subscribe + already minted: hasMinted true or state not SUBSCRIBED-only gate.
  const needsMintForTrading =
    !isBot &&
    gateUser?.state === "SUBSCRIBED" &&
    gateUser?.hasMinted !== true;

  if (needsMintForTrading && require === "marketplace") {
    return <Navigate to="/mint" replace state={{ from: location.pathname }} />;
  }

  return children;
}

export default function App() {
  const location = useLocation();
  const { isConnected } = useAccount();
  const isProfilePage = location.pathname === "/profile";
  const isProfileSetupPage = location.pathname === "/profile/setup";
  const isLandingPage = location.pathname === "/";
  /** Bottom tab bar only when wallet is connected — avoids dead-end taps that redirect to home while disconnected. */
  const showMobileBottomNav =
    Boolean(isConnected) &&
    !/^\/profile\/setup/.test(location.pathname) &&
    !/^\/user\//.test(location.pathname);

  return (
    <div className={`app${showMobileBottomNav ? " app--mobile-nav" : ""}`}>
      <SeoHead />
      <ReconnectOnLoad />
      <ForceBscMainnet />
      <div className={`app-content${isLandingPage ? " app-content--landing" : ""}`}>
        <div id="profile-bg-layer" className="profile-bg-layer" aria-hidden="true" />
        <ParticleNetwork />
        <div id="cards-overlay" className="app-cards-overlay" aria-hidden="true" />
        <div id="support-layer" className="app-support-layer" aria-hidden="true">
          <SupportChat />
        </div>
        <div className={`app-routes${(isProfilePage || isProfileSetupPage) ? " app-routes--over-particles" : ""}`}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/profile/setup" element={<ProfileSetup />} />
            <Route path="/profile" element={<ProtectedRoute require="profile"><Profile /></ProtectedRoute>} />
            <Route path="/subscription" element={<ProtectedRoute require="subscription"><Subscription /></ProtectedRoute>} />
            <Route path="/mint" element={<ProtectedRoute require="mint"><Mint /></ProtectedRoute>} />
            <Route path="/marketplace" element={<ProtectedRoute require="marketplace"><Marketplace /></ProtectedRoute>} />
            <Route path="/leaderboard" element={<ProtectedRoute require="marketplace"><Leaderboard /></ProtectedRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute require="marketplace"><Dashboard /></ProtectedRoute>} />
            <Route path="/user/:username" element={<UserProfile />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
      {showMobileBottomNav ? <MobileBottomNav /> : null}
      <PlatformMaintenanceOverlay />
    </div>
  );
}
