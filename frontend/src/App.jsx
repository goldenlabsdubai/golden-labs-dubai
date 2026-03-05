import { useEffect, useRef } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAccount, useSwitchChain, useReconnect } from "wagmi";
import "./App.css";
import { useAuth } from "./hooks/useAuth";
import ParticleNetwork from "./components/ParticleNetwork";
import SupportChat from "./components/SupportChat";

const BSC_TESTNET_CHAIN_ID = 97;

function ForceBscTestnet() {
  const { isConnected, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  useEffect(() => {
    if (!isConnected || chainId == null || chainId === BSC_TESTNET_CHAIN_ID) return;
    switchChainAsync({ chainId: BSC_TESTNET_CHAIN_ID }).catch(() => {});
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

function ProtectedRoute({ children, require }) {
  const { token, user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="app-loading">Loading...</div>;
  if (!token) return <Navigate to="/" replace />;

  const active = user?.state === "SUBSCRIBED" || user?.state === "MINTED" || user?.state === "ACTIVE_TRADER";

  // Suspended: only /subscription allowed; send to subscription for any other path
  if (user?.state === "SUSPENDED") {
    if (require === "subscription") return children;
    return <Navigate to="/subscription" replace state={{ from: location.pathname }} />;
  }

  // Not subscribed (and not suspended): must do profile then subscription; no mint/marketplace
  if (!active) {
    if (!user?.username && location.pathname !== "/profile") return <Navigate to="/profile" replace />;
    if (require === "profile") return children;
    if (require === "subscription") return children;
    // Trying to visit mint or marketplace without being subscribed → subscription
    return <Navigate to="/subscription" replace state={{ from: location.pathname }} />;
  }

  // Subscribed but not minted: no marketplace/dashboard/leaderboard
  if (user?.state === "SUBSCRIBED" && require === "marketplace") {
    return <Navigate to="/mint" replace state={{ from: location.pathname }} />;
  }

  return children;
}

export default function App() {
  const location = useLocation();
  const isProfilePage = location.pathname === "/profile";
  const isProfileSetupPage = location.pathname === "/profile/setup";
  const isLandingPage = location.pathname === "/";

  return (
    <div className="app">
      <ReconnectOnLoad />
      <ForceBscTestnet />
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
    </div>
  );
}
