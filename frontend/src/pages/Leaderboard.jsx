import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useAccount, useBalance, useDisconnect } from "wagmi";
import { formatEther } from "viem";
import { useAuth } from "../hooks/useAuth";
import { useWalletConnect } from "../hooks/useWalletConnect";
import { API, getAvatarUrl } from "../config";

const EXPLORER_BY_CHAIN = {
  1: "https://etherscan.io",
  56: "https://bscscan.com",
  97: "https://testnet.bscscan.com",
  137: "https://polygonscan.com",
  8453: "https://basescan.org",
};

const TOP_SELLERS_LIMIT = 10;

export default function Leaderboard() {
  const { user, token } = useAuth();
  const { openModal, isConnected, address } = useWalletConnect();
  const { chainId } = useAccount();
  const { data: balanceData } = useBalance({ address: address ?? undefined });
  const { disconnect: disconnectWallet } = useDisconnect();
  const [topSellers, setTopSellers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addressMenuOpen, setAddressMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const menuRef = useRef(null);

  const displayAddress = (token && (user?.wallet || address)) ? (user?.wallet || address) : (isConnected && address) ? address : null;
  const explorerUrl = chainId && EXPLORER_BY_CHAIN[chainId] && displayAddress ? `${EXPLORER_BY_CHAIN[chainId]}/address/${displayAddress}` : null;

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

  const handleCopyAddress = () => {
    if (!displayAddress) return;
    navigator.clipboard.writeText(displayAddress).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

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
          <Link to="/" className="marketplace-page__logo">Golden Labs</Link>
        </div>
        {(user?.state === "MINTED" || user?.state === "ACTIVE_TRADER") && (
          <nav className="marketplace-page__links">
            <Link to="/marketplace">Marketplace</Link>
            <Link to="/leaderboard">Leaderboard</Link>
            <Link to="/dashboard">My Dashboard</Link>
          </nav>
        )}
        <div className="marketplace-page__right" ref={menuRef}>
          {displayAddress ? (
            <>
              <Link to="/profile" className="marketplace-page__nav-profile marketplace-page__profile-icon-btn" aria-label="Edit profile">
                {user?.avatar && !avatarError ? (
                  <img src={getAvatarUrl(user.avatar)} alt="" className="marketplace-page__profile-icon-img" onError={() => setAvatarError(true)} />
                ) : (
                  <span className="marketplace-page__profile-icon-placeholder" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                  </span>
                )}
              </Link>
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
                  {user && (
                    <div className="marketplace-page__user-summary">
                      {user.avatar ? (
                        <img src={getAvatarUrl(user.avatar)} alt="" className="marketplace-page__user-avatar" />
                      ) : (
                        <span className="marketplace-page__user-avatar marketplace-page__user-avatar--placeholder">@</span>
                      )}
                      <div className="marketplace-page__user-info">
                        <span className="marketplace-page__user-name">{user.username ? `@${user.username}` : (user.name || "—")}</span>
                        <span className="marketplace-page__user-wallet" title={displayAddress}>{displayAddress?.slice(0, 6)}…{displayAddress?.slice(-4)}</span>
                        <span className="marketplace-page__user-meta">Trades: {user.totalTrades ?? 0}</span>
                      </div>
                    </div>
                  )}
                  {balanceData && (
                    <div className="marketplace-page__dropdown-balance">
                      {Number(formatEther(balanceData.value ?? 0n)).toFixed(4)} {balanceData.symbol ?? "BNB"}
                    </div>
                  )}
                  <button type="button" onClick={handleCopyAddress}>{copied ? "Copied!" : "Copy address"}</button>
                  {explorerUrl && <a href={explorerUrl} target="_blank" rel="noopener noreferrer">View on explorer</a>}
                  <Link to="/dashboard" onClick={() => setAddressMenuOpen(false)}>My Dashboard</Link>
                  <div className="marketplace-page__dropdown-divider" />
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
          <p className="leaderboard-page__subtitle">Top 10 sellers by total trades</p>
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
                          <span className="leaderboard-page__earnings">${(Number(seller.earnings || "0") / 1e6).toFixed(2)} USDT</span>
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
