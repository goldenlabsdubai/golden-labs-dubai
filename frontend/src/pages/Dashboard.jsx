import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { useAccount, useBalance, useDisconnect, useReadContract, useWriteContract, usePublicClient, useWatchContractEvent } from "wagmi";
import { formatEther, formatUnits } from "viem";
import { useAuth } from "../hooks/useAuth";
import { useWalletConnect } from "../hooks/useWalletConnect";
import { API, getAvatarUrl } from "../config";
import { detectInsufficientBalanceType, getTransactionErrorMessage } from "../utils/transactionError";
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
const REFERRAL_ABI = [
  { name: "withdrawEarnings", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { name: "referralEarnings", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
];

const EXPLORER_BY_CHAIN = {
  1: "https://etherscan.io",
  56: "https://bscscan.com",
  97: "https://testnet.bscscan.com",
  137: "https://polygonscan.com",
  8453: "https://basescan.org",
};

const TABS = ["Owned", "Referral earnings", "Activity"];

export default function Dashboard() {
  const { user, token, refreshUser } = useAuth();
  const navigate = useNavigate();
  const { openModal, isConnected, address } = useWalletConnect();
  const { chainId } = useAccount();
  const { data: balanceData } = useBalance({ address: address ?? undefined });
  const { disconnect: disconnectWallet } = useDisconnect();
  const [activeTab, setActiveTab] = useState("Owned");
  const [listings, setListings] = useState([]);
  const [myAssets, setMyAssets] = useState([]);
  const [ownedAssetsLoading, setOwnedAssetsLoading] = useState(true);
  const [sortBy, setSortBy] = useState("Recently Listed");
  const [filterOpen, setFilterOpen] = useState(false);
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [loadingList, setLoadingList] = useState(null);
  const [loadingBuy, setLoadingBuy] = useState(null);
  const [listStep, setListStep] = useState(null);
  const [buyStep, setBuyStep] = useState(null);
  const [error, setError] = useState("");
  const [addressMenuOpen, setAddressMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [referralStats, setReferralStats] = useState(null);
  const [referralLinkCopied, setReferralLinkCopied] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const [openMenuTokenId, setOpenMenuTokenId] = useState(null);
  const [loadingDelist, setLoadingDelist] = useState(null);
  const [loadingWithdraw, setLoadingWithdraw] = useState(false);
  const [insufficientBalanceType, setInsufficientBalanceType] = useState(null);
  const [activities, setActivities] = useState([]);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityPage, setActivityPage] = useState(1);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const menuRef = useRef(null);
  const cardMenuRef = useRef(null);
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const wallet = (user?.wallet || address || "").toLowerCase();
  const hasClaimableEarnings = referralStats?.claimableOnChain != null && BigInt(referralStats.claimableOnChain ?? "0") > 0n;
  const nftAddress = (import.meta.env.VITE_NFT_CONTRACT || "").trim();
  const referralAddress = (import.meta.env.VITE_REFERRAL_CONTRACT || "").trim();
  const referralAddressNormalized = referralAddress?.startsWith("0x") ? referralAddress : referralAddress ? `0x${referralAddress}` : "";
  const nftAddressNormalized = nftAddress?.startsWith("0x") ? nftAddress : nftAddress ? `0x${nftAddress}` : "";
  const marketplaceAddress = (import.meta.env.VITE_MARKETPLACE_CONTRACT || "").trim();
  const marketplaceAddressNormalized = marketplaceAddress?.startsWith("0x") ? marketplaceAddress : marketplaceAddress ? `0x${marketplaceAddress}` : "";
  const usdtAddress = (import.meta.env.VITE_USDT_ADDRESS || "").trim();
  const usdtAddressNormalized = usdtAddress?.startsWith("0x") ? usdtAddress : usdtAddress ? `0x${usdtAddress}` : "";
  const { data: usdtBalanceRaw, refetch: refetchUsdtBalance } = useReadContract({
    address: usdtAddressNormalized || undefined,
    abi: USDT_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
  });
  const rawAddress = (token && (user?.wallet || address)) ? (user?.wallet || address) : (isConnected && address) ? address : null;
  const displayAddress = rawAddress ? String(rawAddress).toLowerCase() : null;
  const usdtBalanceFormatted = usdtBalanceRaw != null ? Number(formatUnits(usdtBalanceRaw, 6)).toFixed(2) : null;
  const bnbBalanceFormatted = balanceData?.value != null ? Number(formatEther(balanceData.value)).toFixed(4) : null;
  const explorerUrl = chainId && EXPLORER_BY_CHAIN[chainId] && displayAddress ? `${EXPLORER_BY_CHAIN[chainId]}/address/${displayAddress}` : null;

  useEffect(() => {
    if (!token) return;
    fetch(`${API}/marketplace/listings`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setListings(d.listings || []))
      .catch(() => {});
  }, [token]);
  useEffect(() => {
    if (!token) return;
    refreshUser();
  }, [token, refreshUser]);
  useEffect(() => {
    setAvatarError(false);
  }, [user?.avatar]);
  useEffect(() => {
    if (!token) {
      setOwnedAssetsLoading(false);
      return;
    }
    setOwnedAssetsLoading(true);
    fetch(`${API}/marketplace/my-assets`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setMyAssets(d.assets || []))
      .catch(() => {})
      .finally(() => setOwnedAssetsLoading(false));
  }, [token, user?.wallet]);
  useEffect(() => {
    if (!token) return;
    fetch(`${API}/referral/stats`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => setReferralStats(data))
      .catch(() => setReferralStats(null));
  }, [token]);

  const ACTIVITY_PAGE_SIZE = 10;
  const fetchActivities = (page = 1) => {
    if (!token) return;
    setLoadingActivities(true);
    const offset = (page - 1) * ACTIVITY_PAGE_SIZE;
    fetch(`${API}/user/activity?limit=${ACTIVITY_PAGE_SIZE}&offset=${offset}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        setActivities(d.activities || []);
        setActivityTotal(d.total ?? 0);
      })
      .catch(() => { setActivities([]); setActivityTotal(0); })
      .finally(() => setLoadingActivities(false));
  };
  useEffect(() => {
    if (token && activeTab === "Activity") fetchActivities(activityPage);
  }, [token, activeTab, activityPage]);

  const refetchData = () => {
    if (!token) return;
    setOwnedAssetsLoading(true);
    fetch(`${API}/marketplace/listings`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setListings(d.listings || []))
      .catch(() => {});
    fetch(`${API}/marketplace/my-assets`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setMyAssets(d.assets || []))
      .catch(() => {})
      .finally(() => setOwnedAssetsLoading(false));
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
  const handleCopyAddress = async () => {
    if (!displayAddress) return;
    try {
      await navigator.clipboard.writeText(displayAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  };
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
    if (!marketplaceAddressNormalized || !writeContractAsync) {
      setError("Wallet or contracts not ready.");
      return;
    }
    setError("");
    setOpenMenuTokenId(null);
    setLoadingDelist(tokenId);
    try {
      const hash = await writeContractAsync({
        address: marketplaceAddressNormalized,
        abi: MARKETPLACE_ABI,
        functionName: "cancelListing",
        args: [BigInt(tokenId)],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      refetchData();
    } catch (e) {
      const insufficientType = detectInsufficientBalanceType(e);
      if (insufficientType) {
        setInsufficientBalanceType(insufficientType);
        if (insufficientType === "usdt") refetchUsdtBalance?.();
        setError("");
      } else {
        setError(getTransactionErrorMessage(e, "Delist failed"));
      }
    } finally {
      setLoadingDelist(null);
    }
  };

  const handleWithdrawEarnings = async () => {
    const connectedWallet = (address || "").toLowerCase();
    const accountWallet = (user?.wallet || "").toLowerCase();
    if (connectedWallet && accountWallet && connectedWallet !== accountWallet) {
      setError("Connect the wallet that has the referral earnings to withdraw.");
      return;
    }
    if (!referralAddressNormalized || !writeContractAsync || !publicClient) {
      setError("Wallet or referral contract not ready.");
      return;
    }
    setError("");
    setLoadingWithdraw(true);
    try {
      const hash = await writeContractAsync({
        address: referralAddressNormalized,
        abi: REFERRAL_ABI,
        functionName: "withdrawEarnings",
        args: [],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      if (token) {
        fetch(`${API}/referral/stats`, { headers: { Authorization: `Bearer ${token}` } })
          .then((d) => d.json())
          .then((data) => setReferralStats(data))
          .catch(() => {});
      }
      refreshUser();
    } catch (e) {
      setError(getTransactionErrorMessage(e, "Withdraw failed"));
    } finally {
      setLoadingWithdraw(false);
    }
  };

  const handleList = async (tokenId, listPriceWei) => {
    if (!nftAddressNormalized || !marketplaceAddressNormalized || !publicClient || !writeContractAsync) {
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
      });
      await publicClient.waitForTransactionReceipt({ hash: hashApprove });
      setListStep("list");
      const hashList = await writeContractAsync({
        address: marketplaceAddressNormalized,
        abi: MARKETPLACE_ABI,
        functionName: "list",
        args: [BigInt(tokenId), BigInt(listPriceWei)],
      });
      await publicClient.waitForTransactionReceipt({ hash: hashList });
      refetchData();
    } catch (e) {
      const insufficientType = detectInsufficientBalanceType(e);
      if (insufficientType) {
        setInsufficientBalanceType(insufficientType);
        if (insufficientType === "usdt") refetchUsdtBalance?.();
        setError("");
      } else {
        setError(getTransactionErrorMessage(e, "List failed"));
      }
    } finally {
      setLoadingList(null);
      setListStep(null);
    }
  };

  const handleBuy = async (tokenId, priceWei, referrer = "0x0000000000000000000000000000000000000000", seller = null) => {
    if (!marketplaceAddressNormalized || !usdtAddressNormalized || !publicClient || !writeContractAsync) {
      setError("Wallet or contracts not ready.");
      return;
    }
    setError("");
    setLoadingBuy(tokenId);
    setBuyStep("approve");
    try {
      const hashApprove = await writeContractAsync({
        address: usdtAddressNormalized,
        abi: USDT_ABI,
        functionName: "approve",
        args: [marketplaceAddressNormalized, BigInt(priceWei)],
      });
      await publicClient.waitForTransactionReceipt({ hash: hashApprove });
      setBuyStep("buy");
      const hashBuy = await writeContractAsync({
        address: marketplaceAddressNormalized,
        abi: MARKETPLACE_ABI,
        functionName: "buy",
        args: [BigInt(tokenId), referrer],
      });
      await publicClient.waitForTransactionReceipt({ hash: hashBuy });
      try {
        await fetch(`${API}/marketplace/record-purchase`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ tokenId, seller: seller || null, price: priceWei, txHash: hashBuy }),
        });
      } catch (_) {}
      refetchData();
    } catch (e) {
      const insufficientType = detectInsufficientBalanceType(e);
      if (insufficientType) {
        setInsufficientBalanceType(insufficientType);
        if (insufficientType === "usdt") refetchUsdtBalance?.();
        setError("");
      } else {
        setError(getTransactionErrorMessage(e, "Buy failed"));
      }
    } finally {
      setLoadingBuy(null);
      setBuyStep(null);
    }
  };

  const formatUsdt = (val) => (Number(val || 0) / 1e6).toFixed(2);

  const filterItems = (items, isNft) => {
    let out = items;
    if ((priceMin !== "" || priceMax !== "") && isNft) {
      const min = priceMin === "" ? 0 : Number(priceMin) * 1e6;
      const max = priceMax === "" ? 1e18 : Number(priceMax) * 1e6;
      out = out.filter((n) => { const p = Number(n.price ?? n.listPriceWei ?? 0); return p >= min && p <= max; });
    }
    return out;
  };

  const ownedFiltered = filterItems(myAssets, true);
  const gridItems = activeTab === "Owned" ? ownedFiltered : [];
  const isEmpty = gridItems.length === 0;
  const showOwnedGrid = activeTab === "Owned" && !isEmpty;
  const showReferralEarnings = activeTab === "Referral earnings";

  const profileBg = (
    <div className="profile-modern__bg" aria-hidden="true">
      <div className="profile-modern__bg-image" />
      <div className="profile-modern__bg-overlay" />
    </div>
  );
  const portalContainer = typeof document !== "undefined" ? document.getElementById("profile-bg-layer") : null;

  return (
    <div className="profile-hub">
      <InsufficientBalanceModal
        open={Boolean(insufficientBalanceType)}
        type={insufficientBalanceType}
        onClose={() => setInsufficientBalanceType(null)}
        usdtBalanceFormatted={usdtBalanceFormatted}
        bnbBalanceFormatted={bnbBalanceFormatted}
      />
      {portalContainer && createPortal(profileBg, portalContainer)}

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
                        <span className="marketplace-page__user-meta">Status: {user.state ?? "—"} · Trades: {user.totalTrades ?? 0}</span>
                        {(user.totalReferrals ?? 0) > 0 && (
                          <span className="marketplace-page__user-meta">Referrals: {user.totalReferrals} · Earnings: ${(Number(user.referralEarningsTotal || "0") / 1e6).toFixed(2)} USDT <img src="/USDT_BEP20.png" alt="" className="usdt-logo-inline" aria-hidden="true" /></span>
                        )}
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
            <button type="button" className="marketplace-page__connect" onClick={handleConnect}>Connect Wallet</button>
          )}
        </div>
      </header>

      <div className="profile-hub__profile">
        <div className="profile-hub__avatar-wrap">
          {user?.avatar && !avatarError ? (
            <img
              src={getAvatarUrl(user.avatar)}
              alt=""
              className="profile-hub__avatar"
              onError={() => setAvatarError(true)}
            />
          ) : (
            <div className="profile-hub__avatar-placeholder" />
          )}
        </div>
        <h1 className="profile-hub__name">
          {user?.username || user?.name || "Unnamed"}
        </h1>
        <p className="profile-hub__address-label">Address</p>
        <p className="profile-hub__address">{user?.wallet || displayAddress || "—"}</p>
        {(user?.xUrl || user?.telegramUrl) && (
          <div className="profile-hub__social">
            {user?.xUrl && (
              <a href={user.xUrl} target="_blank" rel="noopener noreferrer" className="profile-hub__social-link" aria-label="X (Twitter)">
                <svg className="profile-hub__social-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
            )}
            {user?.telegramUrl && (
              <a href={user.telegramUrl} target="_blank" rel="noopener noreferrer" className="profile-hub__social-link" aria-label="Telegram">
                <svg className="profile-hub__social-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                </svg>
              </a>
            )}
          </div>
        )}
      </div>

      <main className="profile-hub__main">
        <div className="profile-hub__tabs">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              className={`profile-hub__tab${activeTab === tab ? " profile-hub__tab--active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="profile-hub__content">
          <div className="profile-hub__grid-wrap">
            {error && <p className="profile-hub__error">{error}</p>}
            {activeTab === "Activity" && (
              <div className="profile-hub__activity-container">
                {loadingActivities && (
                  <div className="profile-hub__empty">
                    <p className="profile-hub__activity-loading">Loading activity…</p>
                  </div>
                )}
                {!loadingActivities && activities.length === 0 && (
                  <div className="profile-hub__empty">
                    <p className="profile-hub__empty-title">No activity yet.</p>
                  </div>
                )}
                {!loadingActivities && activities.length > 0 && (
                  <>
                    <div className="profile-hub__activity-wrap">
                      <p className="profile-hub__activity-heading">
                        Recent activity ({Math.min((activityPage - 1) * ACTIVITY_PAGE_SIZE + 1, activityTotal)}–{Math.min(activityPage * ACTIVITY_PAGE_SIZE, activityTotal)} of {activityTotal})
                      </p>
                      <div className="profile-hub__activity-table-wrap">
                        <table className="profile-hub__activity-table">
                          <thead>
                            <tr>
                              <th className="profile-hub__activity-th profile-hub__activity-th--asset">Asset</th>
                              <th className="profile-hub__activity-th profile-hub__activity-th--price">Price</th>
                              <th className="profile-hub__activity-th profile-hub__activity-th--date">Date & Time</th>
                              <th className="profile-hub__activity-th profile-hub__activity-th--tx">Tx Hash</th>
                            </tr>
                          </thead>
                          <tbody>
                            {activities.map((a) => {
                              const usdt = a.price != null ? (Number(a.price) / 1e6).toFixed(0) : null;
                              const assetLabel =
                                a.type === "subscription"
                                  ? "Subscription"
                                  : a.type === "mint"
                                    ? a.tokenId ? `GLFA #${a.tokenId}` : "GLFA"
                                    : a.type === "buy"
                                      ? a.tokenId ? `GLFA #${a.tokenId}` : "—"
                                      : a.type === "sell"
                                        ? a.tokenId ? `GLFA #${a.tokenId}` : "—"
                                        : a.type;
                              const actionLabel =
                                a.type === "subscription"
                                  ? "Subscription"
                                  : a.type === "mint"
                                    ? "Minted"
                                    : a.type === "buy"
                                      ? "Buy"
                                      : a.type === "sell"
                                        ? "Sell"
                                        : a.type;
                              const dateTime = a.createdAt ? new Date(a.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
                              const explorerBase = chainId && EXPLORER_BY_CHAIN[chainId] ? EXPLORER_BY_CHAIN[chainId] : null;
                              const txHash = (a.txHash && typeof a.txHash === "string") ? a.txHash.trim() : null;
                              const txUrl = explorerBase && txHash ? `${explorerBase}/tx/${txHash}` : null;
                              const shortHash = txHash ? `${txHash.slice(0, 6)}…${txHash.slice(-4)}` : "—";
                              return (
                                <tr key={a.id} className="profile-hub__activity-tr">
                                  <td className="profile-hub__activity-td profile-hub__activity-td--asset">
                                    <span className="profile-hub__activity-asset">{assetLabel}</span>
                                    {" "}
                                    <span className={`profile-hub__activity-action${a.type === "buy" ? " profile-hub__activity-action--buy" : a.type === "sell" ? " profile-hub__activity-action--sell" : ""}`}>{actionLabel}</span>
                                  </td>
                                  <td className="profile-hub__activity-td profile-hub__activity-td--price">
                                    {(usdt != null && usdt !== "0") ? (
                                      <span className="profile-hub__usdt-with-logo">{usdt} USDT <img src="/USDT_BEP20.png" alt="" className="usdt-logo-inline" aria-hidden="true" /></span>
                                    ) : "—"}
                                  </td>
                                  <td className="profile-hub__activity-td profile-hub__activity-td--date">{dateTime}</td>
                                  <td className="profile-hub__activity-td profile-hub__activity-td--tx">
                                    {txUrl ? (
                                      <a href={txUrl} target="_blank" rel="noopener noreferrer" className="profile-hub__activity-tx-link" title={txHash}>
                                        {shortHash}
                                      </a>
                                    ) : (
                                      <span title="Transaction hash not recorded for this activity">{shortHash}</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    {activityTotal > ACTIVITY_PAGE_SIZE && (
                      <div className="profile-hub__activity-pagination">
                        <button
                          type="button"
                          className="profile-hub__activity-page-btn"
                          disabled={activityPage <= 1 || loadingActivities}
                          onClick={() => setActivityPage((p) => Math.max(1, p - 1))}
                        >
                          Previous
                        </button>
                        <span className="profile-hub__activity-page-info">
                          {Math.min((activityPage - 1) * ACTIVITY_PAGE_SIZE + 1, activityTotal)}–{Math.min(activityPage * ACTIVITY_PAGE_SIZE, activityTotal)} of {activityTotal}
                        </span>
                        <button
                          type="button"
                          className="profile-hub__activity-page-btn"
                          disabled={activityPage * ACTIVITY_PAGE_SIZE >= activityTotal || loadingActivities}
                          onClick={() => setActivityPage((p) => p + 1)}
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            {activeTab === "Owned" && ownedAssetsLoading && (
              <div className="profile-hub__empty">
                <p className="profile-hub__activity-loading">Loading your assets…</p>
              </div>
            )}
            {activeTab === "Owned" && !ownedAssetsLoading && isEmpty && (
              <div className="profile-hub__empty">
                <p className="profile-hub__empty-title">You own no assets</p>
                <Link to="/marketplace" className="profile-hub__refresh">Go to Marketplace</Link>
              </div>
            )}
            {showOwnedGrid && (
              <div className="profile-hub__grid">
                {gridItems.map((nft) => (
                  <div key={nft.tokenId} className="profile-hub__nft-card">
                    <div className="profile-hub__nft-card-image-wrap">
                      <NFTMedia tokenURI={nft.tokenURI} tokenId={nft.tokenId} className="profile-hub__nft-card-image" />
                    </div>
                    <div className="profile-hub__nft-card-details">
                      <div className="profile-hub__nft-card-row">
                        <span className="profile-hub__nft-id">GLFA #{nft.tokenId}</span>
                        <span className="profile-hub__nft-price">
                          <span className="profile-hub__nft-price-label">{nft.isListed ? (Number(nft.price || nft.listPriceWei) / 1e6).toFixed(0) : nft.listPriceUsdt} USDT <img src="/USDT_BEP20.png" alt="" className="usdt-logo-inline" aria-hidden="true" /></span>
                        </span>
                      </div>
                      <div className="profile-hub__nft-card-center">
                        {nft.isListed ? (
                          <div className="profile-hub__nft-card-center-row">
                            <span className="profile-hub__nft-badge profile-hub__nft-badge--listed">Listed</span>
                            <div className="profile-hub__nft-card-menu profile-hub__nft-card-menu--beside" ref={openMenuTokenId === nft.tokenId ? cardMenuRef : null}>
                              <button
                                type="button"
                                className="profile-hub__nft-card-dots"
                                onClick={(e) => { e.stopPropagation(); setOpenMenuTokenId((id) => (id === nft.tokenId ? null : nft.tokenId)); }}
                                aria-label="Options"
                                aria-expanded={openMenuTokenId === nft.tokenId}
                              >
                                <span className="profile-hub__nft-card-dots-h"><span /><span /><span /></span>
                              </button>
                              {openMenuTokenId === nft.tokenId && (
                                <div className="profile-hub__nft-card-dropdown">
                                  <button
                                    type="button"
                                    className="profile-hub__nft-card-dropdown-item profile-hub__nft-card-dropdown-item--danger"
                                    onClick={() => handleDelist(nft.tokenId)}
                                    disabled={loadingDelist != null}
                                  >
                                    {loadingDelist === nft.tokenId ? "Delisting…" : "Delist"}
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="profile-hub__nft-btn"
                            onClick={() => handleList(nft.tokenId, nft.listPriceWei)}
                            disabled={loadingList != null}
                          >
                            {loadingList === nft.tokenId ? (listStep === "approve" ? "1/2 Approving…" : "2/2 Listing…") : `List for $${nft.listPriceUsdt}`}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {showReferralEarnings && (
              <div className="profile-hub__referral-inline">
                <h2 className="profile-hub__referral-title">Referral</h2>
                {user?.username ? (
                  <>
                    <div className="profile-hub__referral-link-block">
                      <span className="profile-hub__referral-label">Your referral link</span>
                      <div className="profile-hub__referral-wrap">
                        <input type="text" readOnly className="profile-hub__referral-input" value={`${typeof window !== "undefined" ? window.location.origin : ""}/?ref=${user.username}`} />
                        <button type="button" className="profile-hub__referral-copy" onClick={async () => { try { await navigator.clipboard.writeText(`${typeof window !== "undefined" ? window.location.origin : ""}/?ref=${user.username}`); setReferralLinkCopied(true); setTimeout(() => setReferralLinkCopied(false), 2000); } catch (_) {} }}>{referralLinkCopied ? "Copied!" : "Copy"}</button>
                      </div>
                    </div>
                    <div className="profile-hub__referral-stats-grid">
                      <div className="profile-hub__referral-stat">
                        <span className="profile-hub__referral-stat-label">Lifetime earnings</span>
                        <span className="profile-hub__referral-stat-value">${referralStats != null ? formatUsdt(referralStats.referralEarningsTotal || "0") : formatUsdt(user?.referralEarningsTotal || "0")} USDT <img src="/USDT_BEP20.png" alt="" className="usdt-logo-inline" aria-hidden="true" /></span>
                      </div>
                      <div className="profile-hub__referral-stat">
                        <span className="profile-hub__referral-stat-label">Available to claim</span>
                        <span className="profile-hub__referral-stat-value">${referralStats?.claimableOnChain != null ? formatUsdt(referralStats.claimableOnChain) : "0.00"} USDT <img src="/USDT_BEP20.png" alt="" className="usdt-logo-inline" aria-hidden="true" /></span>
                      </div>
                      <div className="profile-hub__referral-stat">
                        <span className="profile-hub__referral-stat-label">Total referrals</span>
                        <span className="profile-hub__referral-stat-value">{referralStats != null ? (referralStats.totalReferrals ?? user?.totalReferrals ?? 0) : (user?.totalReferrals ?? 0)}</span>
                      </div>
                      <div className="profile-hub__referral-stat">
                        <span className="profile-hub__referral-stat-label">Total trades</span>
                        <span className="profile-hub__referral-stat-value">{referralStats != null ? (referralStats.totalTrades ?? user?.totalTrades ?? 0) : (user?.totalTrades ?? 0)}</span>
                      </div>
                    </div>
                    <div className="profile-hub__referral-levels">
                      <span className="profile-hub__referral-label">Referrals by level</span>
                      <div className="profile-hub__referral-levels-table">
                        <div className="profile-hub__referral-levels-head">
                          <span className="profile-hub__referral-levels-cell profile-hub__referral-levels-cell--level">Level</span>
                          <span className="profile-hub__referral-levels-cell profile-hub__referral-levels-cell--count">Referrals</span>
                          <span className="profile-hub__referral-levels-cell profile-hub__referral-levels-cell--earnings">Earnings</span>
                        </div>
                        {[1, 2, 3, 4, 5].map((lvl) => {
                          const count = referralStats != null ? (referralStats[`referralCountL${lvl}`] ?? 0) : (user?.[`referralCountL${lvl}`] ?? 0);
                          const earnings = referralStats != null ? formatUsdt(referralStats[`referralEarningsL${lvl}`] || "0") : formatUsdt(user?.[`referralEarningsL${lvl}`] || "0");
                          return (
                            <div key={lvl} className="profile-hub__referral-levels-row">
                              <span className="profile-hub__referral-levels-cell profile-hub__referral-levels-cell--level">L{lvl}</span>
                              <span className="profile-hub__referral-levels-cell profile-hub__referral-levels-cell--count">{count}</span>
                              <span className="profile-hub__referral-levels-cell profile-hub__referral-levels-cell--earnings">{earnings} USDT <img src="/USDT_BEP20.png" alt="" className="usdt-logo-inline" aria-hidden="true" /></span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="profile-hub__referral-withdraw-wrap">
                      <button
                        type="button"
                        className="profile-hub__referral-withdraw"
                        onClick={handleWithdrawEarnings}
                        disabled={
                          loadingWithdraw ||
                          !referralAddressNormalized ||
                          !hasClaimableEarnings ||
                          user?.state === "SUSPENDED" ||
                          (address && user?.wallet && (address || "").toLowerCase() !== (user.wallet || "").toLowerCase())
                        }
                      >
                        {loadingWithdraw ? "Withdrawing…" : "Withdraw earnings"}
                      </button>
                      <p className="profile-hub__referral-withdraw-hint">
                        {user?.state === "SUSPENDED"
                          ? "Resubscribe to withdraw your referral earnings."
                          : address && user?.wallet && (address || "").toLowerCase() !== (user.wallet || "").toLowerCase()
                            ? "Connect the wallet that has the earnings to withdraw."
                            : "Sends your claimable referral USDT to your wallet. Requires active subscription."}
                      </p>
                    </div>
                  </>
                ) : (
                  <p className="profile-hub__referral-hint">Set your username in Edit Profile to get your referral link.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="profile-hub__footer">
        <div className="profile-hub__footer-inner">
          <Link to="/" className="profile-hub__footer-logo">Golden Labs</Link>
          <div className="profile-hub__footer-links">
            <div className="profile-hub__footer-col">
              <h4>Marketplace</h4>
              <Link to="/marketplace">All Assets</Link>
              <Link to="/leaderboard">Leaderboard</Link>
            </div>
            <div className="profile-hub__footer-col">
              <h4>Resources</h4>
              <Link to="/profile">Profile</Link>
              <Link to="/dashboard">My Dashboard</Link>
            </div>
          </div>
        </div>
        <p className="profile-hub__footer-copy">© {new Date().getFullYear()} Golden Labs. All rights reserved.</p>
      </footer>
    </div>
  );
}
