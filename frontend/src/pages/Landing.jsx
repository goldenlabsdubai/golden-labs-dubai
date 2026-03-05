import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAccount, useBalance, useDisconnect } from "wagmi";
import { formatEther } from "viem";
import { useAuth } from "../hooks/useAuth";
import { useWalletConnect } from "../hooks/useWalletConnect";
import { useSignInWithWallet } from "../hooks/useSignInWithWallet";
import { API, getAvatarUrl } from "../config.js";
import { getTransactionErrorMessage } from "../utils/transactionError";

const EXPLORER_BY_CHAIN = {
  1: "https://etherscan.io",
  56: "https://bscscan.com",
  137: "https://polygonscan.com",
  8453: "https://basescan.org",
};

const POLL_TOP_SELLERS_MS = 8000;

function formatTrades(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

const RECENT_LISTINGS_LIMIT = 12;
const POLL_RECENT_LISTINGS_MS = 10000;

export default function Landing() {
  const navigate = useNavigate();
  const { connect, token, user, setSession, refreshUser, logout } = useAuth();
  const { openModal, isConnected, address } = useWalletConnect();
  const { chainId } = useAccount();
  const { data: balanceData } = useBalance({ address: address ?? undefined });
  const { signIn, loading: signInLoading } = useSignInWithWallet();
  const { disconnect: disconnectWallet } = useDisconnect();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [addressMenuOpen, setAddressMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [topSellers, setTopSellers] = useState([]);
  const [topSellersLoading, setTopSellersLoading] = useState(true);
  const [recentListings, setRecentListings] = useState([]);
  const [recentListingsLoading, setRecentListingsLoading] = useState(true);
  const [continuityTop, setContinuityTop] = useState(0);
  const menuRef = useRef(null);
  const continuityRef = useRef(null);
  const supportCloseTimeoutRef = useRef(null);
  const wasConnectedRef = useRef(false);
  const [popupContinueClicked, setPopupContinueClicked] = useState(false);
  const [walletCheckExists, setWalletCheckExists] = useState(undefined);

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setAddressMenuOpen(false);
    }
    if (addressMenuOpen) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [addressMenuOpen]);

  // New user: connect → profile setup (no sign-in). Existing user: connect → show sign-in popup.
  useEffect(() => {
    if (!isConnected || !address || token) {
      setWalletCheckExists(undefined);
      return;
    }
    let cancelled = false;
    fetch(`${API}/auth/check/${address}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const exists = data.exists === true;
        if (!exists) navigate("/profile/setup", { replace: true });
        else setWalletCheckExists(true);
      })
      .catch(() => {
        if (!cancelled) setWalletCheckExists(true);
      });
    return () => { cancelled = true; };
  }, [isConnected, address, token, navigate]);

  const showContinueDisconnectPopup = Boolean(isConnected && address && !token && walletCheckExists === true);
  useEffect(() => {
    if (showContinueDisconnectPopup) {
      wasConnectedRef.current = true;
      setPopupContinueClicked(false);
    } else {
      wasConnectedRef.current = false;
    }
  }, [showContinueDisconnectPopup]);

  useEffect(() => {
    if (token) refreshUser();
  }, [token, refreshUser]);

  // Capture ?ref= (referral code) from URL and store for sign-in
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref && ref.trim()) sessionStorage.setItem("gl_ref", ref.trim());
  }, []);

  useEffect(() => {
    const fetchTopSellers = async () => {
      try {
        const res = await fetch(`${API}/top-sellers?limit=10`);
        if (res.ok) {
          const data = await res.json();
          setTopSellers(data.topSellers || []);
        } else {
          setTopSellers([]);
        }
      } catch {
        setTopSellers([]);
      } finally {
        setTopSellersLoading(false);
      }
    };
    fetchTopSellers();
    const interval = setInterval(fetchTopSellers, POLL_TOP_SELLERS_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchRecentListings = async () => {
      try {
        const res = await fetch(`${API}/marketplace/listings`);
        if (res.ok) {
          const data = await res.json();
          const list = data.listings || [];
          setRecentListings(list.slice(0, RECENT_LISTINGS_LIMIT));
        } else {
          setRecentListings([]);
        }
      } catch (_) {
        setRecentListings([]);
      } finally {
        setRecentListingsLoading(false);
      }
    };
    fetchRecentListings();
    const interval = setInterval(fetchRecentListings, POLL_RECENT_LISTINGS_MS);
    return () => clearInterval(interval);
  }, []);

  function updateContinuityOffset() {
    if (continuityRef.current) {
      const rect = continuityRef.current.getBoundingClientRect();
      setContinuityTop(rect.top + window.scrollY);
    }
  }
  useLayoutEffect(() => {
    updateContinuityOffset();
  }, [topSellers, recentListings]);
  useEffect(() => {
    window.addEventListener("scroll", updateContinuityOffset, { passive: true });
    window.addEventListener("resize", updateContinuityOffset);
    return () => {
      window.removeEventListener("scroll", updateContinuityOffset);
      window.removeEventListener("resize", updateContinuityOffset);
    };
  }, []);

  const displayAddress = (token && user?.wallet) ? user.wallet : (isConnected && address) ? address : null;
  const isSignedIn = Boolean(token);

  const handleConnect = async () => {
    setError("");
    if (openModal) {
      openModal();
      return;
    }
    if (!window.ethereum) {
      setError("Install a Web3 wallet (e.g. MetaMask)");
      return;
    }
    setLoading(true);
    try {
      const redirect = await connect();
      navigate(redirect ? `/${redirect}` : "/marketplace");
    } catch (e) {
      setError(getTransactionErrorMessage(e, "Connection failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async () => {
    setError("");
    setPopupContinueClicked(true);
    try {
      const data = await signIn();
      if (data?.token && data?.user) setSession(data.token, data.user);
      navigate(data?.redirect ? `/${data.redirect}` : "/marketplace");
    } catch (e) {
      setError(getTransactionErrorMessage(e, "Sign in failed"));
      setPopupContinueClicked(false);
    }
  };

  const handleDisconnect = () => {
    setAddressMenuOpen(false);
    disconnectWallet();
    logout();
  };

  const handleCopyAddress = () => {
    if (!displayAddress) return;
    navigator.clipboard.writeText(displayAddress).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const explorerBase = chainId ? (EXPLORER_BY_CHAIN[chainId] ?? "https://bscscan.com") : "https://bscscan.com";
  const explorerUrl = displayAddress ? `${explorerBase}/address/${displayAddress}` : null;

  let ctaLabel = "Connect Wallet";
  let ctaLoading = loading;
  let ctaOnClick = handleConnect;

  if (isSignedIn && user) {
    if (!user.username) {
      ctaLabel = "Complete profile";
      ctaLoading = false;
      ctaOnClick = () => navigate("/profile");
    } else if (!["SUBSCRIBED", "MINTED", "ACTIVE_TRADER"].includes(user.state ?? "")) {
      ctaLabel = "Proceed to subscription";
      ctaLoading = false;
      ctaOnClick = () => navigate("/subscription");
    } else if (user.state === "SUBSCRIBED") {
      ctaLabel = "Mint asset";
      ctaLoading = false;
      ctaOnClick = () => navigate("/mint");
    } else {
      ctaLabel = "Go to Marketplace";
      ctaLoading = false;
      ctaOnClick = () => navigate("/marketplace");
    }
  } else if (isConnected && address && !token) {
    ctaLabel = "Wallet connected";
    ctaLoading = false;
    ctaOnClick = () => {};
  } else if (!token) {
    ctaLabel = loading ? "Connecting..." : "Get Started";
    ctaLoading = loading;
    ctaOnClick = handleConnect;
  }

  return (
    <div className="landing-v2">
      <div className="landing-v2__particles" aria-hidden="true" />
      <header className="landing-v2__header">
        <span className="landing-v2__logo">Golden Labs</span>
        <div className="landing-v2__header-right">
          {displayAddress ? (
            <div className="landing-v2__address-wrap" ref={menuRef}>
              <button
                type="button"
                className="landing-v2__address"
                title={displayAddress}
                onClick={() => setAddressMenuOpen((o) => !o)}
                aria-expanded={addressMenuOpen}
                aria-haspopup="true"
              >
                {displayAddress.slice(0, 6)}…{displayAddress.slice(-4)}
              </button>
              {addressMenuOpen && (
                <div className="landing-v2__address-menu">
                  {balanceData && (
                    <div className="landing-v2__address-menu-balance">
                      <span className="landing-v2__address-menu-balance-label">Balance</span>
                      <span className="landing-v2__address-menu-balance-value">
                        {Number(formatEther(balanceData.value ?? 0n)).toFixed(4)} {balanceData.symbol ?? "BNB"}
                      </span>
                    </div>
                  )}
                  <button type="button" className="landing-v2__address-menu-item" onClick={handleCopyAddress}>
                    {copied ? "Copied!" : "Copy address"}
                  </button>
                  {explorerUrl && (
                    <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="landing-v2__address-menu-item landing-v2__address-menu-item--link">
                      View on explorer
                    </a>
                  )}
                  <div className="landing-v2__address-menu-divider" />
                  <button type="button" className="landing-v2__address-menu-item landing-v2__address-menu-item--danger" onClick={handleDisconnect}>
                    Disconnect wallet
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button className="landing-v2__btn landing-v2__btn--primary" onClick={handleConnect} disabled={loading}>
              {loading ? "Connecting..." : "Connect Wallet"}
            </button>
          )}
        </div>
      </header>

      <main className="landing-v2__main">
        <section className="landing-v2__hero">
          <div className="landing-v2__hero-bg" aria-hidden="true" />
          <div className="landing-v2__hero-row">
            <div className="landing-v2__hero-content">
              <h1 className="landing-v2__hero-title">Subscribe, Mint, Trade & Refer With Friends & Family</h1>
              <p className="landing-v2__hero-sub">Subscribe, Mint Asset & Trade on Golden Labs. Connect with 390+ wallets.</p>
            </div>
            <div className="landing-v2__hero-cta-row">
              <img
                className="landing-v2__hero-asset-left"
                src="/golden_labs_asset%20left.png"
                alt=""
                aria-hidden="true"
              />
              <div className="landing-v2__hero-cta-wrap">
                <img
                  className="landing-v2__hero-asset-center"
                  src="/gldas.png"
                  alt="Golden Labs DeFi Asset"
                  aria-hidden="true"
                />
                <button className="landing-v2__btn landing-v2__btn--primary landing-v2__btn--lg" onClick={ctaOnClick} disabled={ctaLoading}>
                  {ctaLabel}
                </button>
                {error && <p className="landing-v2__error">{error}</p>}
              </div>
              <img
                className="landing-v2__hero-asset"
                src="/golden_labs_asset%20right.png"
                alt="Golden Labs DeFi Asset"
              />
            </div>
          </div>
        </section>

        <div ref={continuityRef} className="landing-v2__continuity" style={{ visibility: "hidden" }} aria-hidden="true">
        <section className="landing-v2__section">
          <h2 className="landing-v2__section-title">Top Sellers</h2>
          <div className="landing-v2__marquee-wrap">
            {topSellersLoading ? (
              <div className="landing-v2__top-sellers-loading">Loading...</div>
            ) : topSellers.length === 0 ? (
              <div className="landing-v2__top-sellers-empty">No sellers yet</div>
            ) : (
              <div className={`landing-v2__marquee-track landing-v2__marquee-track--sellers${topSellers.length < 3 ? " landing-v2__marquee-track--no-scroll" : ""}`}>
                {(() => {
                  const duplicateForMarquee = topSellers.length >= 3;
                  const displayList = duplicateForMarquee ? [...topSellers, ...topSellers] : topSellers;
                  return displayList.map((seller, i) => {
                    const rank = seller.rank ?? (i % topSellers.length) + 1;
                    const crownColor = rank === 1 ? "gold" : rank === 2 ? "silver" : rank === 3 ? "bronze" : null;
                    return (
                      <div key={seller.wallet ? `${seller.wallet}-${i}` : `seller-${i}`} className="landing-v2__seller-card">
                        <div className="landing-v2__seller-avatar-wrap">
                          {seller.avatar ? (
                            <img src={getAvatarUrl(seller.avatar)} alt="" className="landing-v2__seller-avatar landing-v2__seller-avatar--img" />
                          ) : (
                            <div className="landing-v2__seller-avatar" />
                          )}
                          {crownColor && (
                            <span className={`landing-v2__seller-crown landing-v2__seller-crown--${crownColor}`} aria-hidden="true">
                              <img src={`/svg%20${crownColor}.png`} alt="" width="32" height="32" className="landing-v2__seller-crown-img" />
                            </span>
                          )}
                        </div>
                        <span className="landing-v2__seller-name">{seller.username}</span>
                        <span className="landing-v2__seller-rank">Top #{rank}</span>
                        <span className="landing-v2__seller-trades">{formatTrades(seller.trades ?? 0)} trades</span>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </div>
        </section>

        <section className="landing-v2__section">
          <h2 className="landing-v2__section-title">Recently Listed</h2>
          <div className="landing-v2__marquee-wrap">
            {recentListingsLoading ? (
              <div className="landing-v2__top-sellers-loading">Loading...</div>
            ) : recentListings.length === 0 ? (
              <div className="landing-v2__top-sellers-empty">No listings yet</div>
            ) : (
              <div className={`landing-v2__marquee-track landing-v2__marquee-track--nft${recentListings.length < 3 ? " landing-v2__marquee-track--no-scroll" : ""}`}>
                {(() => {
                  const duplicateForMarquee = recentListings.length >= 3;
                  const displayList = duplicateForMarquee ? [...recentListings, ...recentListings] : recentListings;
                  return displayList.map((l, i) => (
                    <div key={`listing-${l.tokenId}-${i}`} className="landing-v2__nft-card">
                      <div className="landing-v2__nft-card-image" style={{ backgroundImage: 'url("/gldass.png")', backgroundSize: "cover", backgroundPosition: "center" }} />
                      <h3 className="landing-v2__nft-card-title">GLFA #{l.tokenId}</h3>
                      <p className="landing-v2__nft-card-creator">Owned by {l.sellerUsername ? `@${l.sellerUsername}` : "—"}</p>
                      <p className="landing-v2__nft-card-price">{l.priceFormatted || (Number(l.price) / 1e6).toFixed(0) + " USDT"}</p>
                      <button type="button" className="landing-v2__btn landing-v2__btn--primary landing-v2__btn--sm" onClick={() => navigate("/marketplace")}>Buy Now</button>
                    </div>
                  ));
                })()}
              </div>
            )}
          </div>
        </section>
        </div>

        <section className="landing-v2__banner">
          <p className="landing-v2__banner-text">Join the world&apos;s largest Asset community & start collecting Assets</p>
          <button className="landing-v2__btn landing-v2__btn--primary landing-v2__btn--lg" onClick={ctaOnClick} disabled={ctaLoading}>
            Join Now
          </button>
        </section>

        <footer className="landing-v2__footer">
          <div className="landing-v2__footer-inner">
            <span className="landing-v2__footer-logo">Golden Labs</span>
            <div className="landing-v2__footer-links">
              <div className="landing-v2__footer-col">
                <h4 className="landing-v2__footer-col-title">JOIN & follow</h4>
                <div className="landing-v2__footer-social">
                  <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" aria-label="Twitter" className="landing-v2__footer-social-link">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                  </a>
                  <a href="https://t.me" target="_blank" rel="noopener noreferrer" aria-label="Telegram" className="landing-v2__footer-social-link">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                    </svg>
                  </a>
                </div>
              </div>
            </div>
          </div>
          <p className="landing-v2__footer-copy">© {new Date().getFullYear()} Golden Labs. All rights reserved.</p>
        </footer>
      </main>

      {typeof document !== "undefined" &&
        document.getElementById("support-layer") &&
        showContinueDisconnectPopup &&
        createPortal(
          <div className="landing-v2__wallet-popup-overlay" role="dialog" aria-modal="true" aria-labelledby="wallet-popup-title">
            <div className="landing-v2__wallet-popup">
              <h2 id="wallet-popup-title" className="landing-v2__wallet-popup-title">Welcome to Golden Labs</h2>
              <p className="landing-v2__wallet-popup-text">Your wallet is connected. Sign the message in your wallet to continue, or disconnect if you prefer.</p>
              <div className="landing-v2__wallet-popup-actions">
                <button
                  type="button"
                  className="landing-v2__btn landing-v2__btn--primary landing-v2__wallet-popup-btn"
                  onClick={handleSignIn}
                  disabled={signInLoading}
                >
                  {popupContinueClicked && signInLoading ? "Signing in..." : "Continue"}
                </button>
                <button
                  type="button"
                  className="landing-v2__wallet-popup-disconnect"
                  onClick={handleDisconnect}
                >
                  Disconnect wallet
                </button>
              </div>
            </div>
          </div>,
          document.getElementById("support-layer")
        )}
      {typeof document !== "undefined" &&
        document.getElementById("cards-overlay") &&
        createPortal(
          <>
            <div style={{ height: continuityTop, minHeight: 0 }} aria-hidden="true" />
            <div className="landing-v2__continuity landing-v2__continuity--overlay">
              <section className="landing-v2__section">
                <h2 className="landing-v2__section-title">Top Sellers</h2>
                <div className="landing-v2__marquee-wrap">
                  {topSellersLoading ? (
                    <div className="landing-v2__top-sellers-loading">Loading...</div>
                  ) : topSellers.length === 0 ? (
                    <div className="landing-v2__top-sellers-empty">No sellers yet</div>
                  ) : (
                    <div className={`landing-v2__marquee-track landing-v2__marquee-track--sellers${topSellers.length < 3 ? " landing-v2__marquee-track--no-scroll" : ""}`}>
                      {(() => {
                        const duplicateForMarquee = topSellers.length >= 3;
                        const displayList = duplicateForMarquee ? [...topSellers, ...topSellers] : topSellers;
                        return displayList.map((seller, i) => {
                          const rank = seller.rank ?? (i % topSellers.length) + 1;
                          const crownColor = rank === 1 ? "gold" : rank === 2 ? "silver" : rank === 3 ? "bronze" : null;
                          return (
                            <div key={seller.wallet ? `${seller.wallet}-${i}` : `seller-${i}`} className="landing-v2__seller-card">
                              <div className="landing-v2__seller-avatar-wrap">
                                {seller.avatar ? (
                                  <img src={getAvatarUrl(seller.avatar)} alt="" className="landing-v2__seller-avatar landing-v2__seller-avatar--img" />
                                ) : (
                                  <div className="landing-v2__seller-avatar" />
                                )}
                                {crownColor && (
                                  <span className={`landing-v2__seller-crown landing-v2__seller-crown--${crownColor}`} aria-hidden="true">
                                    <img src={`/svg%20${crownColor}.png`} alt="" width="32" height="32" className="landing-v2__seller-crown-img" />
                                  </span>
                                )}
                              </div>
                              <span className="landing-v2__seller-name">{seller.username}</span>
                              <span className="landing-v2__seller-rank">Top #{rank}</span>
                              <span className="landing-v2__seller-trades">{formatTrades(seller.trades ?? 0)} trades</span>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  )}
                </div>
              </section>
              <section className="landing-v2__section">
                <h2 className="landing-v2__section-title">Recently Listed</h2>
                <div className="landing-v2__marquee-wrap">
                  {recentListingsLoading ? (
                    <div className="landing-v2__top-sellers-loading">Loading...</div>
                  ) : recentListings.length === 0 ? (
                    <div className="landing-v2__top-sellers-empty">No listings yet</div>
                  ) : (
                    <div className={`landing-v2__marquee-track landing-v2__marquee-track--nft${recentListings.length < 3 ? " landing-v2__marquee-track--no-scroll" : ""}`}>
                      {(() => {
                        const duplicateForMarquee = recentListings.length >= 3;
                        const displayList = duplicateForMarquee ? [...recentListings, ...recentListings] : recentListings;
                        return displayList.map((l, i) => (
                          <div key={`listing-${l.tokenId}-${i}`} className="landing-v2__nft-card">
                            <div className="landing-v2__nft-card-image" style={{ backgroundImage: 'url("/gldass.png")', backgroundSize: "cover", backgroundPosition: "center" }} />
                            <h3 className="landing-v2__nft-card-title">GLFA #{l.tokenId}</h3>
                            <p className="landing-v2__nft-card-creator">Owned by {l.sellerUsername ? `@${l.sellerUsername}` : "—"}</p>
                            <p className="landing-v2__nft-card-price">{l.priceFormatted || (Number(l.price) / 1e6).toFixed(0) + " USDT"}</p>
                            <button type="button" className="landing-v2__btn landing-v2__btn--primary landing-v2__btn--sm" onClick={() => navigate("/marketplace")}>Buy Now</button>
                          </div>
                        ));
                      })()}
                    </div>
                  )}
                </div>
              </section>
            </div>
          </>,
          document.getElementById("cards-overlay")
        )}
    </div>
  );
}
