import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { assignAppPath } from "../utils/appNavigation";
import { useDisconnect } from "wagmi";
import { useAuth } from "../hooks/useAuth";
import { useWalletConnect } from "../hooks/useWalletConnect";
import { useSignInWithWallet } from "../hooks/useSignInWithWallet";
import { API, getAvatarUrl } from "../config.js";
import { getTransactionErrorMessage } from "../utils/transactionError";
import { NavbarBrandLink } from "../components/NavbarBrandLink";

const POLL_TOP_SELLERS_MS = 8000;

function formatTrades(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

const RECENT_LISTINGS_LIMIT = 12;
const POLL_RECENT_LISTINGS_MS = 10000;

/** Copy uses asset / GLFA / Golden Labs asset — not “NFT”. Shown after Recently Listed (main + overlay). */
function AboutGoldenLabsSection() {
  return (
    <section className="landing-v2__section landing-v2__section--about-gl" aria-label="About Golden Labs">
      <h2 className="landing-v2__section-title">About Golden Labs</h2>
      <div className="landing-v2__about-gl">
        <p className="landing-v2__about-gl-lead">
          Golden Labs is a community-driven platform where each <strong>Golden Labs asset</strong> (GLFA) is a unique on-chain collectible you can mint, list, and trade with USDT on BNB Smart Chain.
        </p>
        <ul className="landing-v2__about-gl-list">
          <li>
            <strong>Subscribe</strong> — unlock minting and marketplace access for your wallet.
          </li>
          <li>
            <strong>Mint</strong> — claim your GLFA asset and add it to your collection.
          </li>
          <li>
            <strong>Trade</strong> — buy and sell listed assets at clear, fixed pricing.
          </li>
          <li>
            <strong>Refer</strong> — invite friends and family and earn as the network grows.
          </li>
        </ul>
        <p className="landing-v2__about-gl-note">
          Your Golden Labs asset is yours to hold, list on the marketplace, or pick up from other members—built for transparency and true ownership in the Golden Labs ecosystem.
        </p>
      </div>
    </section>
  );
}

export default function Landing() {
  const { connect, token, user, setSession, refreshUser, logout } = useAuth();
  const { openModal, isConnected, address } = useWalletConnect();
  const { signIn, loading: signInLoading } = useSignInWithWallet();
  const { disconnect: disconnectWallet } = useDisconnect();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [addressMenuOpen, setAddressMenuOpen] = useState(false);
  const [topSellers, setTopSellers] = useState([]);
  const [topSellersLoading, setTopSellersLoading] = useState(true);
  const [recentListings, setRecentListings] = useState([]);
  const [recentListingsLoading, setRecentListingsLoading] = useState(true);
  /** null = not measured yet — avoids portal overlay sitting at y=0 on top of hero image */
  const [continuityTop, setContinuityTop] = useState(null);
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
        if (!exists) assignAppPath("/profile/setup");
        else setWalletCheckExists(true);
      })
      .catch(() => {
        if (!cancelled) setWalletCheckExists(true);
      });
    return () => { cancelled = true; };
  }, [isConnected, address, token]);

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
  /** Measure before paint + on data/layout changes so overlay never stacks on hero; ResizeObserver catches hero image load reflow */
  useLayoutEffect(() => {
    const el = continuityRef.current;
    if (!el) return undefined;
    updateContinuityOffset();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => updateContinuityOffset()) : null;
    if (ro) ro.observe(el);
    const onScroll = () => updateContinuityOffset();
    const onResize = () => updateContinuityOffset();
    const onLoad = () => updateContinuityOffset();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    window.addEventListener("load", onLoad);
    requestAnimationFrame(() => updateContinuityOffset());
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("load", onLoad);
    };
  }, [topSellers, recentListings]);

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
      const seg = redirect && String(redirect).trim() ? String(redirect).replace(/^\/+/, "") : "profile";
      assignAppPath(`/${seg}`);
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
      if (!data?.token || !data?.user) {
        setPopupContinueClicked(false);
        setError("Sign in incomplete. Please try again.");
        return;
      }
      setSession(data.token, data.user);
      const seg = data.redirect && String(data.redirect).trim() ? String(data.redirect).replace(/^\/+/, "") : "profile";
      assignAppPath(`/${seg}`);
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

  let ctaLabel = "Connect Wallet";
  let ctaLoading = loading;
  let ctaOnClick = handleConnect;

  if (isSignedIn && user) {
    if (!user.username) {
      ctaLabel = "Complete profile";
      ctaLoading = false;
      ctaOnClick = () => assignAppPath("/profile");
    } else if (user.state === "SUSPENDED") {
      ctaLabel = "Resubscribe";
      ctaLoading = false;
      ctaOnClick = () => assignAppPath("/subscription");
    } else if (!["SUBSCRIBED", "MINTED", "ACTIVE_TRADER"].includes(user.state ?? "")) {
      ctaLabel = "Proceed to subscription";
      ctaLoading = false;
      ctaOnClick = () => assignAppPath("/subscription");
    } else if (user.state === "SUBSCRIBED") {
      ctaLabel = "Mint asset";
      ctaLoading = false;
      ctaOnClick = () => assignAppPath("/mint");
    } else {
      ctaLabel = "Go to Marketplace";
      ctaLoading = false;
      ctaOnClick = () => assignAppPath("/marketplace");
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
        <NavbarBrandLink to="/" className="landing-v2__logo" />
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
              <h1 className="landing-v2__hero-title">Bring friends &amp; family into the Golden Labs marketplace</h1>
              <p className="landing-v2__hero-sub">
                Subscribe, mint your GLFA, trade with USDT, and earn referrals. 390+ wallets supported.
              </p>
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
          <h2 className="landing-v2__section-title">Top sellers · lifetime earnings</h2>
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
                      <p className="landing-v2__nft-card-price">{l.priceFormatted || (Number(l.price) / 1e6).toFixed(0) + " USDT"}</p>
                      <button type="button" className="landing-v2__btn landing-v2__btn--primary landing-v2__btn--sm" onClick={() => assignAppPath("/marketplace")}>Buy Now</button>
                    </div>
                  ));
                })()}
              </div>
            )}
          </div>
        </section>

        <AboutGoldenLabsSection />
        </div>

        <section className="landing-v2__banner">
          <p className="landing-v2__banner-text">Join the world&apos;s largest Asset community & start collecting Assets</p>
          <button className="landing-v2__btn landing-v2__btn--primary landing-v2__btn--lg" onClick={ctaOnClick} disabled={ctaLoading}>
            Join Now
          </button>
        </section>

        <footer className="landing-v2__footer">
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
        continuityTop != null &&
        createPortal(
          <>
            <div style={{ height: continuityTop, minHeight: 0 }} aria-hidden="true" />
            <div className="landing-v2__continuity landing-v2__continuity--overlay">
              <section className="landing-v2__section">
                <h2 className="landing-v2__section-title">Top sellers · lifetime earnings</h2>
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
                            <p className="landing-v2__nft-card-price">{l.priceFormatted || (Number(l.price) / 1e6).toFixed(0) + " USDT"}</p>
                            <button type="button" className="landing-v2__btn landing-v2__btn--primary landing-v2__btn--sm" onClick={() => assignAppPath("/marketplace")}>Buy Now</button>
                          </div>
                        ));
                      })()}
                    </div>
                  )}
                </div>
              </section>

              <AboutGoldenLabsSection />
            </div>
          </>,
          document.getElementById("cards-overlay")
        )}
    </div>
  );
}
