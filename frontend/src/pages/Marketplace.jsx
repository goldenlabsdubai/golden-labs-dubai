import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { useBalance, useDisconnect, useWriteContract, usePublicClient, useWatchContractEvent, useReadContract } from "wagmi";
import { formatEther, formatUnits } from "viem";
import { useAuth } from "../hooks/useAuth";
import { useWalletConnect } from "../hooks/useWalletConnect";
import { API, getAvatarUrl, MARKETPLACE_AND_RESERVE_POOL_ADDRESS } from "../config";
import { fetchMyAssetsWithRetry } from "../utils/fetchMyAssets";
import { applyWalletTxError } from "../utils/transactionError";
import { resolveSellerReferrerRoot } from "../utils/marketplaceReferrer";
import {
  safeGasLimit,
  DEFAULT_APPROVE_GAS,
  DEFAULT_MARKETPLACE_BUY_GAS,
  DEFAULT_MARKETPLACE_LIST_GAS,
  DEFAULT_MARKETPLACE_CANCEL_GAS,
  DEFAULT_NFT_APPROVE_GAS,
} from "../utils/safeContractGas";
import NFTMedia from "../components/NFTMedia";
import InsufficientBalanceModal from "../components/InsufficientBalanceModal";

const NFT_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "tokenId", type: "uint256" }], outputs: [] },
];
const MARKETPLACE_ABI = [
  { name: "list", type: "function", stateMutability: "nonpayable", inputs: [{ name: "tokenId", type: "uint256" }, { name: "price", type: "uint256" }], outputs: [] },
  { name: "buy", type: "function", stateMutability: "nonpayable", inputs: [{ name: "tokenId", type: "uint256" }, { name: "referrer", type: "address" }], outputs: [] },
  { name: "cancelListing", type: "function", stateMutability: "nonpayable", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [] },
  { type: "event", name: "Listed", inputs: [{ name: "tokenId", type: "uint256", indexed: true }, { name: "seller", type: "address", indexed: false }, { name: "price", type: "uint256", indexed: false }] },
  { type: "event", name: "Sold", inputs: [{ name: "tokenId", type: "uint256", indexed: true }, { name: "seller", type: "address", indexed: false }, { name: "buyer", type: "address", indexed: false }, { name: "price", type: "uint256", indexed: false }] },
  { type: "event", name: "ListingCancelled", inputs: [{ name: "tokenId", type: "uint256", indexed: true }] },
];
const USDT_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
];

export default function Marketplace() {
  const { user, token, refreshUser } = useAuth();
  const navigate = useNavigate();
  const { openModal, isConnected, address } = useWalletConnect();
  const { data: balanceData } = useBalance({ address: address ?? undefined });
  const { disconnect: disconnectWallet } = useDisconnect();
  const [listings, setListings] = useState([]);
  const [myAssets, setMyAssets] = useState([]);
  const [listingsLoading, setListingsLoading] = useState(true);
  const [loadingBuy, setLoadingBuy] = useState(null);
  const [buyStep, setBuyStep] = useState(null);
  const [loadingList, setLoadingList] = useState(null);
  const [listStep, setListStep] = useState(null);
  const [loadingDelist, setLoadingDelist] = useState(null);
  const [openMenuTokenId, setOpenMenuTokenId] = useState(null);
  const [error, setError] = useState("");
  const [addressMenuOpen, setAddressMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const [sortBy, setSortBy] = useState("Oldest Listed");
  const [listLayout, setListLayout] = useState("grid-3");
  const [portalReady, setPortalReady] = useState(false);
  const [insufficientBalanceType, setInsufficientBalanceType] = useState(null);
  const sortDropdownRef = useRef(null);
  const menuRef = useRef(null);
  const cardMenuRef = useRef(null);
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const listingsReqIdRef = useRef(0);
  const assetsReqIdRef = useRef(0);

  const marketplaceAddress = MARKETPLACE_AND_RESERVE_POOL_ADDRESS;
  const marketplaceAddressNormalized = marketplaceAddress?.startsWith("0x") ? marketplaceAddress : marketplaceAddress ? `0x${marketplaceAddress}` : "";
  const nftAddress = (import.meta.env.VITE_NFT_CONTRACT || "").trim();
  const nftAddressNormalized = nftAddress?.startsWith("0x") ? nftAddress : nftAddress ? `0x${nftAddress}` : "";
  const usdtAddress = (import.meta.env.VITE_USDT_ADDRESS || "").trim();
  const usdtAddressNormalized = usdtAddress?.startsWith("0x") ? usdtAddress : usdtAddress ? `0x${usdtAddress}` : "";
  const referralAddress = (import.meta.env.VITE_REFERRAL_CONTRACT || "").trim();
  const referralAddressNormalized = referralAddress?.startsWith("0x") ? referralAddress : referralAddress ? `0x${referralAddress}` : "";
  const { data: usdtBalanceRaw, refetch: refetchUsdtBalance } = useReadContract({
    address: usdtAddressNormalized || undefined,
    abi: USDT_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
  });
  const usdtBalanceFormatted = usdtBalanceRaw != null ? Number(formatUnits(usdtBalanceRaw, 6)).toFixed(2) : null;
  const bnbBalanceFormatted = balanceData?.value != null ? Number(formatEther(balanceData.value)).toFixed(4) : null;
  const displayAddress = (token && (user?.wallet || address)) ? (user?.wallet || address) : (isConnected && address) ? address : null;
  const currentWallet = (displayAddress || user?.wallet || address || "").toString().toLowerCase();

  useEffect(() => setPortalReady(true), []);
  const fetchListingsLatest = () => {
    const reqId = ++listingsReqIdRef.current;
    return fetch(`${API}/marketplace/listings`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.json())
      .then((d) => {
        const incoming = d.listings || [];
        if (reqId === listingsReqIdRef.current) setListings(incoming);
      })
      .catch(() => {});
  };

  const fetchMyAssetsLatest = () => {
    if (!token) {
      setMyAssets([]);
      return Promise.resolve();
    }
    const reqId = ++assetsReqIdRef.current;
    return fetchMyAssetsWithRetry(token, user?.state)
      .then((assets) => {
        if (reqId === assetsReqIdRef.current) setMyAssets(assets);
      })
      .catch(() => {});
  };

  useEffect(() => {
    setListingsLoading(true);
    Promise.all([fetchListingsLatest(), fetchMyAssetsLatest()]).finally(() => setListingsLoading(false));
  }, [token, user?.state]);

  const refetchData = () => {
    fetchListingsLatest();
    fetchMyAssetsLatest();
  };
  const refetchDataRef = useRef(refetchData);
  refetchDataRef.current = refetchData;

  // Live updates: refetch when anyone lists, buys, or cancels on-chain
  useWatchContractEvent({
    address: marketplaceAddressNormalized || undefined,
    abi: MARKETPLACE_ABI,
    eventName: "Listed",
    onLogs: () => refetchDataRef.current?.(),
  });
  useWatchContractEvent({
    address: marketplaceAddressNormalized || undefined,
    abi: MARKETPLACE_ABI,
    eventName: "Sold",
    onLogs: () => refetchDataRef.current?.(),
  });
  useWatchContractEvent({
    address: marketplaceAddressNormalized || undefined,
    abi: MARKETPLACE_ABI,
    eventName: "ListingCancelled",
    onLogs: () => refetchDataRef.current?.(),
  });

  const handleConnect = () => { if (openModal) openModal(); };
  const handleDisconnect = () => { setAddressMenuOpen(false); disconnectWallet(); navigate("/", { replace: true }); };
  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setAddressMenuOpen(false);
    }
    if (addressMenuOpen) document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [addressMenuOpen]);

  useEffect(() => {
    function handleCardMenuOutside(e) {
      if (cardMenuRef.current && !cardMenuRef.current.contains(e.target)) setOpenMenuTokenId(null);
    }
    if (openMenuTokenId != null) document.addEventListener("click", handleCardMenuOutside);
    return () => document.removeEventListener("click", handleCardMenuOutside);
  }, [openMenuTokenId]);

  const handleDelist = async (tokenId) => {
    if (!marketplaceAddressNormalized || !writeContractAsync || !publicClient || !address) {
      setError("Wallet or contracts not ready.");
      return;
    }
    setError("");
    setOpenMenuTokenId(null);
    setLoadingDelist(tokenId);
    try {
      const gasCancel = await safeGasLimit(
        publicClient,
        {
          address: marketplaceAddressNormalized,
          abi: MARKETPLACE_ABI,
          functionName: "cancelListing",
          args: [BigInt(tokenId)],
          account: address,
        },
        DEFAULT_MARKETPLACE_CANCEL_GAS
      );
      const hash = await writeContractAsync({
        address: marketplaceAddressNormalized,
        abi: MARKETPLACE_ABI,
        functionName: "cancelListing",
        args: [BigInt(tokenId)],
        gas: gasCancel,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      refetchData();
    } catch (e) {
      applyWalletTxError(e, {
        setInsufficientBalanceType,
        setError,
        refetchUsdt: refetchUsdtBalance,
        fallbackMessage: "Delist failed",
      });
    } finally {
      setLoadingDelist(null);
    }
  };

  const handleBuy = async (tokenId, priceWei, seller = null) => {
    if (!marketplaceAddressNormalized || !usdtAddressNormalized || !publicClient || !writeContractAsync || !address) {
      setError("Wallet or contracts not ready.");
      return;
    }
    setError("");
    setLoadingBuy(tokenId);
    setBuyStep("approve");
    try {
      const tradeReferrerRoot = await resolveSellerReferrerRoot(publicClient, referralAddressNormalized, seller);
      const hashApprove = await writeContractAsync({
        address: usdtAddressNormalized,
        abi: USDT_ABI,
        functionName: "approve",
        args: [marketplaceAddressNormalized, BigInt(priceWei)],
        gas: await safeGasLimit(
          publicClient,
          {
            address: usdtAddressNormalized,
            abi: USDT_ABI,
            functionName: "approve",
            args: [marketplaceAddressNormalized, BigInt(priceWei)],
            account: address,
          },
          DEFAULT_APPROVE_GAS
        ),
      });
      await publicClient.waitForTransactionReceipt({ hash: hashApprove });
      setBuyStep("buy");
      const hashBuy = await writeContractAsync({
        address: marketplaceAddressNormalized,
        abi: MARKETPLACE_ABI,
        functionName: "buy",
        args: [BigInt(tokenId), tradeReferrerRoot],
        gas: await safeGasLimit(
          publicClient,
          {
            address: marketplaceAddressNormalized,
            abi: MARKETPLACE_ABI,
            functionName: "buy",
            args: [BigInt(tokenId), tradeReferrerRoot],
            account: address,
          },
          DEFAULT_MARKETPLACE_BUY_GAS
        ),
      });
      await publicClient.waitForTransactionReceipt({ hash: hashBuy });
      setListings((prev) => prev.filter((l) => String(l.tokenId) !== String(tokenId)));
      if (token) {
        try {
          await fetch(`${API}/marketplace/record-purchase`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ tokenId, seller: seller || null, price: priceWei, txHash: hashBuy }),
          });
        } catch (_) {}
      }
      refetchData();
      setTimeout(() => refetchData(), 1500);
    } catch (e) {
      applyWalletTxError(e, {
        setInsufficientBalanceType,
        setError,
        refetchUsdt: refetchUsdtBalance,
        fallbackMessage: "Buy failed",
      });
    } finally {
      setLoadingBuy(null);
      setBuyStep(null);
    }
  };

  const handleList = async (tokenId, listPriceWei) => {
    if (!nftAddressNormalized || !marketplaceAddressNormalized || !publicClient || !writeContractAsync || !address) {
      setError("Wallet or contracts not ready.");
      return;
    }
    setError("");
    setLoadingList(tokenId);
    setListStep("approve");
    try {
      const hashApprove = await writeContractAsync({
        address: nftAddressNormalized,
        abi: NFT_ABI,
        functionName: "approve",
        args: [marketplaceAddressNormalized, BigInt(tokenId)],
        gas: await safeGasLimit(
          publicClient,
          {
            address: nftAddressNormalized,
            abi: NFT_ABI,
            functionName: "approve",
            args: [marketplaceAddressNormalized, BigInt(tokenId)],
            account: address,
          },
          DEFAULT_NFT_APPROVE_GAS
        ),
      });
      await publicClient.waitForTransactionReceipt({ hash: hashApprove });
      setListStep("list");
      const hashList = await writeContractAsync({
        address: marketplaceAddressNormalized,
        abi: MARKETPLACE_ABI,
        functionName: "list",
        args: [BigInt(tokenId), BigInt(listPriceWei)],
        gas: await safeGasLimit(
          publicClient,
          {
            address: marketplaceAddressNormalized,
            abi: MARKETPLACE_ABI,
            functionName: "list",
            args: [BigInt(tokenId), BigInt(listPriceWei)],
            account: address,
          },
          DEFAULT_MARKETPLACE_LIST_GAS
        ),
      });
      await publicClient.waitForTransactionReceipt({ hash: hashList });
      refetchData();
    } catch (e) {
      applyWalletTxError(e, {
        setInsufficientBalanceType,
        setError,
        refetchUsdt: refetchUsdtBalance,
        fallbackMessage: "List failed",
      });
    } finally {
      setLoadingList(null);
      setListStep(null);
    }
  };

  const ownedNotListed = myAssets.filter((a) => !a.isListed);

  const filteredListings = listings;

  const fallbackListingTierRank = (l) => {
    if (l?.listingTierRank != null && Number.isFinite(Number(l.listingTierRank))) return Number(l.listingTierRank);
    const mp = (marketplaceAddressNormalized || "").toLowerCase();
    const s = (l?.seller || "").toLowerCase();
    if (mp && s === mp) return 0;
    return 2;
  };

  /** Same tier: oldest list time first, newest last; missing time last; tie = seller (not tokenId). */
  const byListedTimeOldestFirst = (a, b) => {
    const aT = Number(a.listedAt ?? 0);
    const bT = Number(b.listedAt ?? 0);
    const aBad = !Number.isFinite(aT) || aT <= 0;
    const bBad = !Number.isFinite(bT) || bT <= 0;
    if (aBad && bBad) return String(a.seller || "").localeCompare(String(b.seller || ""));
    if (aBad) return 1;
    if (bBad) return -1;
    if (aT !== bT) return aT - bT;
    return String(a.seller || "").localeCompare(String(b.seller || ""));
  };
  const byListedTimeNewestFirst = (a, b) => {
    const aT = Number(a.listedAt ?? 0);
    const bT = Number(b.listedAt ?? 0);
    const aBad = !Number.isFinite(aT) || aT <= 0;
    const bBad = !Number.isFinite(bT) || bT <= 0;
    if (aBad && bBad) return String(a.seller || "").localeCompare(String(b.seller || ""));
    if (aBad) return 1;
    if (bBad) return -1;
    if (aT !== bT) return bT - aT;
    return String(a.seller || "").localeCompare(String(b.seller || ""));
  };

  const sortedListings = [...filteredListings].sort((a, b) => {
    const trA = fallbackListingTierRank(a);
    const trB = fallbackListingTierRank(b);
    if (trA !== trB) return trA - trB;

    const aPrice = Number(a.price || 0);
    const bPrice = Number(b.price || 0);
    if (sortBy === "Price: Low to High") {
      if (aPrice !== bPrice) return aPrice - bPrice;
      return byListedTimeOldestFirst(a, b);
    }
    if (sortBy === "Price: High to Low") {
      if (aPrice !== bPrice) return bPrice - aPrice;
      return byListedTimeOldestFirst(a, b);
    }
    if (sortBy === "Oldest Listed") return byListedTimeOldestFirst(a, b);
    if (sortBy === "Recently Listed") return byListedTimeNewestFirst(a, b);
    return byListedTimeOldestFirst(a, b);
  });

  useEffect(() => {
    function handleSortDropdownOutside(e) {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target)) setSortDropdownOpen(false);
    }
    if (sortDropdownOpen) document.addEventListener("click", handleSortDropdownOutside);
    return () => document.removeEventListener("click", handleSortDropdownOutside);
  }, [sortDropdownOpen]);

  const subscriptionBg = (
    <div className="profile-modern__bg" aria-hidden="true">
      <div className="profile-modern__bg-image" />
      <div className="profile-modern__bg-overlay" />
    </div>
  );
  const portalContainer = typeof document !== "undefined" ? document.getElementById("profile-bg-layer") : null;

  return (
    <div className="marketplace-page">
      <InsufficientBalanceModal
        open={Boolean(insufficientBalanceType)}
        type={insufficientBalanceType}
        onClose={() => setInsufficientBalanceType(null)}
        usdtBalanceFormatted={usdtBalanceFormatted}
        bnbBalanceFormatted={bnbBalanceFormatted}
      />
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
                  <button type="button" className="marketplace-page__dropdown-danger" onClick={handleDisconnect}>Disconnect</button>
                </div>
              )}
            </>
          ) : (
            <button type="button" className="marketplace-page__connect" onClick={handleConnect}>Connect Wallet</button>
          )}
        </div>
      </header>

      <div className="marketplace-page__body">
        <aside className="marketplace-page__sidebar">
          {token && user && (
            <div className="marketplace-page__profile-card">
              <h3 className="marketplace-page__profile-card-title">Your profile</h3>
              <div className="marketplace-page__profile-card-body">
                {user.avatar ? (
                  <img src={getAvatarUrl(user.avatar)} alt="" className="marketplace-page__profile-card-avatar" />
                ) : (
                  <span className="marketplace-page__profile-card-avatar marketplace-page__profile-card-avatar--placeholder">@</span>
                )}
                <p className="marketplace-page__profile-card-name">{user.username ? `@${user.username}` : (user.name || "—")}</p>
                <p className="marketplace-page__profile-card-wallet" title={user.wallet}>{String(user.wallet || "").slice(0, 8)}…{String(user.wallet || "").slice(-6)}</p>
                <dl className="marketplace-page__profile-card-stats">
                  <div><dt>Status</dt><dd>{user.state || "—"}</dd></div>
                  <div><dt>Trades</dt><dd>{user.totalTrades ?? 0}</dd></div>
                  <div><dt>Referrals</dt><dd>{user.totalReferrals ?? 0}</dd></div>
                  <div><dt>Earnings</dt><dd>${(Number(user.referralEarningsTotal || "0") / 1e6).toFixed(2)} USDT <img src="/USDT_BEP20.png" alt="" className="usdt-logo-inline" aria-hidden="true" /></dd></div>
                </dl>
                <Link to="/dashboard" className="marketplace-page__profile-card-link">My Dashboard</Link>
              </div>
            </div>
          )}
        </aside>

        <main className="marketplace-page__main">
          {error && <p className="marketplace-page__error">{error}</p>}
          {token && ownedNotListed.length > 0 && (
            <section className="marketplace-page__owned">
              <h2 className="marketplace-page__owned-title">Your Assets</h2>
              <p className="marketplace-page__owned-desc">List your Assets for sale from here.</p>
              <div className="profile-hub__grid marketplace-page__grid marketplace-page__grid--grid-3 marketplace-page__owned-grid">
                {ownedNotListed.map((nft) => (
                  <div key={nft.tokenId} className="profile-hub__nft-card">
                    <div className="profile-hub__nft-card-image-wrap">
                      <NFTMedia tokenURI={nft.tokenURI} tokenId={nft.tokenId} className="profile-hub__nft-card-image" />
                    </div>
                    <div className="profile-hub__nft-card-details">
                      <div className="profile-hub__nft-card-row">
                        <span className="profile-hub__nft-id">GLFA #{nft.tokenId}</span>
                        <span className="profile-hub__nft-price">
                          <span className="profile-hub__nft-price-label">{nft.listPriceUsdt} USDT <img src="/USDT_BEP20.png" alt="" className="usdt-logo-inline" aria-hidden="true" /></span>
                        </span>
                      </div>
                      <p className="profile-hub__nft-owned-by">Not listed</p>
                      <div className="profile-hub__nft-card-center">
                        <button
                          type="button"
                          className="profile-hub__nft-btn"
                          onClick={() => handleList(nft.tokenId, nft.listPriceWei)}
                          disabled={loadingList != null}
                        >
                          {loadingList === nft.tokenId ? (listStep === "approve" ? "1/2 Approving…" : "2/2 Listing…") : `List for $${nft.listPriceUsdt}`}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          <section className="marketplace-page__listings-section">
            <h2 className="marketplace-page__section-title">Marketplace</h2>
          <div className="marketplace-page__list-toolbar">
            <div className="marketplace-page__sort-wrap" ref={sortDropdownRef}>
              <button
                type="button"
                className="marketplace-page__sort-btn"
                onClick={() => setSortDropdownOpen((o) => !o)}
                aria-expanded={sortDropdownOpen}
                aria-haspopup="listbox"
              >
                <span>{sortBy}</span>
                <span className="marketplace-page__sort-chevron" aria-hidden="true">▼</span>
              </button>
              {sortDropdownOpen && (
                <div className="marketplace-page__sort-dropdown" role="listbox">
                  {["Oldest Listed", "Recently Listed", "Price: Low to High", "Price: High to Low"].map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      role="option"
                      aria-selected={sortBy === opt}
                      className={`marketplace-page__sort-option ${sortBy === opt ? "marketplace-page__sort-option--active" : ""}`}
                      onClick={() => { setSortBy(opt); setSortDropdownOpen(false); }}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="marketplace-page__layout-toggle">
              <button
                type="button"
                className={`marketplace-page__layout-btn ${listLayout === "grid-2" ? "marketplace-page__layout-btn--active" : ""}`}
                onClick={() => setListLayout("grid-2")}
                aria-label="2 by 2 grid"
                title="2 by 2 grid"
              >
                <span className="marketplace-page__layout-icon" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect width="6" height="6" x="1" y="1" rx="1" /><rect width="6" height="6" x="9" y="1" rx="1" /><rect width="6" height="6" x="1" y="9" rx="1" /><rect width="6" height="6" x="9" y="9" rx="1" /></svg>
                </span>
              </button>
              <button
                type="button"
                className={`marketplace-page__layout-btn ${listLayout === "grid-3" ? "marketplace-page__layout-btn--active" : ""}`}
                onClick={() => setListLayout("grid-3")}
                aria-label="3 by 3 grid"
                title="3 by 3 grid"
              >
                <span className="marketplace-page__layout-icon" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect width="3" height="3" x="1" y="1" rx="0.5" /><rect width="3" height="3" x="6" y="1" rx="0.5" /><rect width="3" height="3" x="11" y="1" rx="0.5" /><rect width="3" height="3" x="1" y="6" rx="0.5" /><rect width="3" height="3" x="6" y="6" rx="0.5" /><rect width="3" height="3" x="11" y="6" rx="0.5" /><rect width="3" height="3" x="1" y="11" rx="0.5" /><rect width="3" height="3" x="6" y="11" rx="0.5" /><rect width="3" height="3" x="11" y="11" rx="0.5" /></svg>
                </span>
              </button>
            </div>
          </div>
          {listingsLoading ? (
            <div className="marketplace-page__empty marketplace-page__empty--loading">
              <div className="marketplace-page__loading-spinner" aria-hidden="true" />
              <p>Loading listings…</p>
            </div>
          ) : filteredListings.length === 0 ? (
            <div className="marketplace-page__empty">
              <p className="marketplace-page__empty-text">Try changing your filters or sort order.</p>
              <button type="button" className="marketplace-page__refresh" onClick={refetchData}>Refresh</button>
            </div>
          ) : (
            <div className={`profile-hub__grid marketplace-page__grid marketplace-page__grid--${listLayout}`}>
              {sortedListings.map((l) => {
                const isMyListing = currentWallet && (String(l.seller || "").toLowerCase() === currentWallet);
                return (
                <div key={l.tokenId} className="profile-hub__nft-card">
                  <div className="profile-hub__nft-card-image-wrap">
                    <NFTMedia tokenURI={l.tokenURI} tokenId={l.tokenId} className="profile-hub__nft-card-image" />
                  </div>
                  <div className="profile-hub__nft-card-details">
                    <div className="profile-hub__nft-card-row">
                      <span className="profile-hub__nft-id">GLFA #{l.tokenId}</span>
                      <span className="profile-hub__nft-price">
                      <span className="profile-hub__nft-price-label">{l.priceFormatted ? l.priceFormatted.replace(/\s*USDT$/i, "").trim() : (Number(l.price) / 1e6).toFixed(0)} USDT <img src="/USDT_BEP20.png" alt="" className="usdt-logo-inline" aria-hidden="true" /></span>
                    </span>
                    </div>
                    <div className="profile-hub__nft-card-center">
                      {isMyListing ? (
                        <div className="profile-hub__nft-card-center-row">
                          <span className="profile-hub__nft-badge profile-hub__nft-badge--listed">Listed</span>
                          <div className="profile-hub__nft-card-menu profile-hub__nft-card-menu--beside" ref={openMenuTokenId === l.tokenId ? cardMenuRef : null}>
                            <button
                              type="button"
                              className="profile-hub__nft-card-dots"
                              onClick={(e) => { e.stopPropagation(); setOpenMenuTokenId((id) => (id === l.tokenId ? null : l.tokenId)); }}
                              aria-label="Options"
                              aria-expanded={openMenuTokenId === l.tokenId}
                            >
                              <span className="profile-hub__nft-card-dots-h"><span /><span /><span /></span>
                            </button>
                            {openMenuTokenId === l.tokenId && (
                              <div className="profile-hub__nft-card-dropdown">
                                <button
                                  type="button"
                                  className="profile-hub__nft-card-dropdown-item profile-hub__nft-card-dropdown-item--danger"
                                  onClick={() => handleDelist(l.tokenId)}
                                  disabled={loadingDelist != null}
                                >
                                  {loadingDelist === l.tokenId ? "Delisting…" : "Delist"}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="profile-hub__nft-btn"
                          onClick={() => handleBuy(l.tokenId, l.price, l.seller)}
                          disabled={loadingBuy != null}
                        >
                          {loadingBuy === l.tokenId ? (buyStep === "approve" ? "1/2 Approving…" : "2/2 Buying…") : "Buy Now"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
              })}
            </div>
          )}
          </section>
        </main>
      </div>

      <footer className="marketplace-page__footer">
        <p className="marketplace-page__footer-copy">© {new Date().getFullYear()} Golden Labs. All rights reserved.</p>
      </footer>
    </div>
  );
}
