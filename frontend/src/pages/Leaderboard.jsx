import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AppRouteLink } from "../components/AppRouteLink";
import { useDisconnect } from "wagmi";
import { useAuth } from "../hooks/useAuth";
import { useWalletConnect } from "../hooks/useWalletConnect";
import { API, getAvatarUrl } from "../config";
import { canAccessTradingNav } from "../utils/tradingAccess";
import { NavbarBrandLink } from "../components/NavbarBrandLink";
import { formatUnits } from "viem";
import { USDT_DECIMALS } from "../constants/usdtDecimals";

const TOP_SELLERS_LIMIT = 10;

export default function Leaderboard() {
  const { user, token } = useAuth();
  const { openModal, isConnected, address } = useWalletConnect();
  const { disconnect: disconnectWallet } = useDisconnect();
  const [topSellers, setTopSellers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addressMenuOpen, setAddressMenuOpen] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const menuRef = useRef(null);

  const displayAddress = (token && (user?.wallet || address)) ? (user?.wallet || address) : (isConnected && address) ? address : null;

  useEffect(() => setPortalReady(true), []);

  useEffect(() => {
    const fetchTopSellers = async () => {
      try {
        const res = await fetch(`${API}/top-sellers?limit=${TOP_SELLERS_LIMIT}`, {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
        });
        if (res.ok) {
          const data = await res.json();
          setTopSellers(data.topSellers || []);
        } else {
          setTopSellers([]);
        }
      } catch {
        setTopSellers([]);
      } finally {
        setLoading(false);
      }
    };
    fetchTopSellers();
    const interval = setInterval(fetchTopSellers, 15_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setAddressMenuOpen(false);
    }
    if (addressMenuOpen) document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [addressMenuOpen]);

  const handleDisconnect = () => {
    setAddressMenuOpen(false);
    disconnectWallet();
  };

  const subscriptionBg = (
    <div className="profile-modern__bg" aria-hidden="true">
      <div className="profile-modern__bg-image" />
      <div className="profile-modern__bg-overlay" />
    </div>
  );
  const portalContainer = typeof document !== "undefined" ? document.getElementById("profile-bg-layer") : null;

  return (
    <div className="leaderboard-page">
      {portalReady && portalContainer && createPortal(subscriptionBg, portalContainer)}

      <header className="marketplace-page__nav">
        <div className="marketplace-page__nav-left">
          <NavbarBrandLink to="/" className="marketplace-page__logo" />
        </div>
        {canAccessTradingNav(user) && (
          <nav className="marketplace-page__links">
            <AppRouteLink to="/marketplace">Marketplace</AppRouteLink>
            <AppRouteLink to="/leaderboard">Leaderboard</AppRouteLink>
            <AppRouteLink to="/dashboard">My Dashboard</AppRouteLink>
          </nav>
        )}
        <div className="marketplace-page__right" ref={menuRef}>
          {displayAddress ? (
            <>
              <AppRouteLink to="/profile" className="marketplace-page__nav-profile marketplace-page__profile-icon-btn" aria-label="Edit profile">
                {user?.avatar && !avatarError ? (
                  <img src={getAvatarUrl(user.avatar)} alt="" className="marketplace-page__profile-icon-img" onError={() => setAvatarError(true)} />
                ) : (
                  <span className="marketplace-page__profile-icon-placeholder" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                  </span>
                )}
              </AppRouteLink>
              <button
                type="button"
                className="marketplace-page__wallet"
                onClick={() => setAddressMenuOpen((o) => !o)}
                aria-expanded={addressMenuOpen}
              >
                {displayAddress.slice(0, 6)}…{displayAddress.slice(-4)}
              </button>
              {addressMenuOpen && (
                <div className="marketplace-page__dropdown">
                  <button type="button" className="marketplace-page__dropdown-danger" onClick={handleDisconnect}>Disconnect</button>
                </div>
              )}
            </>
          ) : (
            <button type="button" className="marketplace-page__connect" onClick={openModal}>Connect Wallet</button>
          )}
        </div>
      </header>

      <main className="leaderboard-page__main">
        <div className="leaderboard-page__header">
          <h2 className="leaderboard-page__section-title">Leaderboard</h2>
          <p className="leaderboard-page__subtitle">Top 10 by lifetime earnings (trade + referral)</p>
        </div>

        {loading ? (
          <div className="leaderboard-page__loading">Loading…</div>
        ) : (
          <div className="leaderboard-page__table-wrap">
            <table className="leaderboard-page__table" role="grid">
              <thead>
                <tr>
                  <th className="leaderboard-page__th leaderboard-page__th--rank">#</th>
                  <th className="leaderboard-page__th leaderboard-page__th--user">User</th>
                  <th className="leaderboard-page__th leaderboard-page__th--name">Name</th>
                  <th className="leaderboard-page__th leaderboard-page__th--trades">Total Trades</th>
                  <th className="leaderboard-page__th leaderboard-page__th--referrals">Total Referrals</th>
                  <th className="leaderboard-page__th leaderboard-page__th--earnings">Lifetime Earnings</th>
                </tr>
              </thead>
              <tbody>
                {topSellers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="leaderboard-page__empty">No sellers yet</td>
                  </tr>
                ) : (
                  topSellers.map((seller, i) => {
                    const rank = seller.rank ?? i + 1;
                    const crownColor = rank === 1 ? "gold" : rank === 2 ? "silver" : rank === 3 ? "bronze" : null;
                    return (
                      <tr key={seller.wallet ? `${seller.wallet}-${i}` : `seller-${i}`} className="leaderboard-page__row">
                        <td className="leaderboard-page__cell leaderboard-page__cell--rank">
                          <span className={`leaderboard-page__rank-badge leaderboard-page__rank-badge--${rank <= 3 ? ["gold", "silver", "bronze"][rank - 1] : "default"}`}>
                            {rank}
                          </span>
                        </td>
                        <td className="leaderboard-page__cell leaderboard-page__cell--user">
                          <div className="leaderboard-page__avatar-wrap">
                            {seller.avatar ? (
                              <img src={getAvatarUrl(seller.avatar)} alt="" className="leaderboard-page__avatar" />
                            ) : (
                              <div className="leaderboard-page__avatar leaderboard-page__avatar--placeholder" />
                            )}
                            {crownColor && (
                              <span className={`landing-v2__seller-crown landing-v2__seller-crown--${crownColor}`} aria-hidden="true">
                                <img src={`/svg%20${crownColor}.png`} alt="" width="28" height="28" className="landing-v2__seller-crown-img" />
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="leaderboard-page__cell leaderboard-page__cell--name">
                          {seller.username ? `@${seller.username}` : (seller.wallet ? `${seller.wallet.slice(0, 8)}…` : "Anonymous")}
                        </td>
                        <td className="leaderboard-page__cell leaderboard-page__cell--trades">
                          <strong>{seller.trades ?? 0}</strong>
                        </td>
                        <td className="leaderboard-page__cell leaderboard-page__cell--referrals">
                          <strong>{seller.referrals ?? 0}</strong>
                        </td>
                        <td className="leaderboard-page__cell leaderboard-page__cell--earnings">
                          <span className="leaderboard-page__earnings">${Number(formatUnits(BigInt(String(seller.earnings || "0")), USDT_DECIMALS)).toFixed(2)} USDT</span>
                          <img src="/USDT_BEP20.png" alt="" className="usdt-logo-inline" aria-hidden="true" />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
