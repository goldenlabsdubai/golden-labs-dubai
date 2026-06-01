import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AppRouteLink } from "../components/AppRouteLink";
import {
  assignAppPath,
  rememberWalletTxReturnPath,
  clearWalletTxReturnPath,
  markWalletTxInFlight,
  clearWalletTxInFlight,
} from "../utils/appNavigation";
import { useBalance, useDisconnect, useWriteContract, usePublicClient, useWatchContractEvent, useReadContract } from "wagmi";
import { formatEther, formatUnits } from "viem";
import { useAuth } from "../hooks/useAuth";
import { useWalletConnect } from "../hooks/useWalletConnect";
import { API, getAvatarUrl, MARKETPLACE_AND_RESERVE_POOL_ADDRESS } from "../config";
import { fetchMyAssetsWithRetry } from "../utils/fetchMyAssets";
import { applyWalletTxError, tryOpenInsufficientUsdtModal } from "../utils/transactionError";
import { resolveSellerReferrerRoot } from "../utils/marketplaceReferrer";
import { canAccessTradingNav } from "../utils/tradingAccess";
import { marketplaceListPriceUsdtLabel } from "../utils/marketplaceListPriceLabel";
import { USDT_DECIMALS } from "../constants/usdtDecimals";
import { BSC_CHAIN_ID } from "../constants/chain";
import { bscWriteParams } from "../utils/wagmiBscWrite";
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
import { NavbarBrandLink } from "../components/NavbarBrandLink";

const NFT_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "tokenId", type: "uint256" }], outputs: [] },
];
const MARKETPLACE_ABI = [
  { name: "listPrice", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
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

/** After approve confirms, persist so MetaMask / reload cannot strand the user without re-approving. */
const LIST_RESUME_KEY = "gl_mp_list_resume";
const LIST_RESUME_TTL_MS = 45 * 60 * 1000;
const LISTINGS_PER_PAGE = 10;
/** Page 1: only this many rows show Buy Now; rest show lock until a buy advances the window. */
const MARKETPLACE_PAGE1_BUYABLE_COUNT = 4;

/** Pagination state/logic stays; UI only shows the first page of listings (controls hidden). */
const HIDE_MARKETPLACE_PAGINATION_UI = true;

/** Server listings cache warm-up ~90s; countdown before prompting refresh. */
const MARKETPLACE_CACHE_WARM_COUNTDOWN_SEC = 100;
const MARKETPLACE_CACHE_POLL_MS = 12_000;

/** Page 2+ buy buttons show a lock — only page 1 tokens can be purchased. */
function MarketplaceBuyLockIcon({ className = "" }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M7 11V8a5 5 0 0 1 10 0v3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export default function Marketplace() {
  const { user, token, refreshUser } = useAuth();
  const { openModal, isConnected, address } = useWalletConnect();
  const walletForReads =
    address || (token && user?.wallet ? user.wallet : null) || undefined;
  const { data: balanceData } = useBalance({
    address: walletForReads,
    chainId: BSC_CHAIN_ID,
  });
  const { disconnect: disconnectWallet } = useDisconnect();
  const [listings, setListings] = useState([]);
  const [myAssets, setMyAssets] = useState([]);
  const [listingsLoading, setListingsLoading] = useState(true);
  const [warmCountdown, setWarmCountdown] = useState(MARKETPLACE_CACHE_WARM_COUNTDOWN_SEC);
  const [refreshingListings, setRefreshingListings] = useState(false);
  /** Page-1 buy window start index; +1 after each successful Buy Now (max 6 → last window is rows 6–9). */
  const [page1BuyUnlockOffset, setPage1BuyUnlockOffset] = useState(0);
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
  const [listingsPage, setListingsPage] = useState(1);
  const [portalReady, setPortalReady] = useState(false);
  const [insufficientBalanceType, setInsufficientBalanceType] = useState(null);
  /** { tokenId, listPriceWei } after on-chain approve, if list tx still pending */
  const [listResume, setListResume] = useState(null);
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
  const { data: marketplaceListPriceWei } = useReadContract({
    address: marketplaceAddressNormalized || undefined,
    abi: MARKETPLACE_ABI,
    functionName: "listPrice",
    chainId: BSC_CHAIN_ID,
    query: { enabled: Boolean(marketplaceAddressNormalized) },
  });
  const chainListUsdt = marketplaceListPriceUsdtLabel(marketplaceListPriceWei);
  const chainListWeiStr = marketplaceListPriceWei != null ? String(marketplaceListPriceWei) : null;

  const usdtReadEnabled = Boolean(usdtAddressNormalized && walletForReads);
  const { data: usdtBalanceRaw, refetch: refetchUsdtBalance } = useReadContract({
    address: usdtAddressNormalized || undefined,
    abi: USDT_ABI,
    functionName: "balanceOf",
    args: walletForReads ? [walletForReads] : undefined,
    chainId: BSC_CHAIN_ID,
    query: { enabled: usdtReadEnabled },
  });
  const usdtBalanceFormatted = usdtBalanceRaw != null ? Number(formatUnits(usdtBalanceRaw, USDT_DECIMALS)).toFixed(2) : null;
  const bnbBalanceFormatted = balanceData?.value != null ? Number(formatEther(balanceData.value)).toFixed(4) : null;
  const displayAddress = (token && (user?.wallet || address)) ? (user?.wallet || address) : (isConnected && address) ? address : null;
  const currentWallet = (displayAddress || user?.wallet || address || "").toString().toLowerCase();

  useEffect(() => setPortalReady(true), []);

  useEffect(() => {
    setWarmCountdown(MARKETPLACE_CACHE_WARM_COUNTDOWN_SEC);
    const id = window.setInterval(() => {
      setWarmCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const fetchListingsLatest = (opts = {}) => {
    const reqId = ++listingsReqIdRef.current;
    const qs = opts.forceRefresh ? "?refresh=1" : "";
    return fetch(`${API}/marketplace/listings${qs}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.json())
      .then((d) => {
        const incoming = d.listings || [];
        if (reqId === listingsReqIdRef.current) setListings(incoming);
        return incoming;
      })
      .catch(() => []);
  };

  const fetchMyAssetsLatest = () => {
    if (!token) {
      setMyAssets([]);
      return Promise.resolve();
    }
    const reqId = ++assetsReqIdRef.current;
    return fetchMyAssetsWithRetry(token, user?.state, {
      onProgress: (assets) => {
        if (reqId === assetsReqIdRef.current) setMyAssets(assets);
      },
    })
      .then((assets) => {
        if (reqId === assetsReqIdRef.current) setMyAssets(assets);
      })
      .catch(() => {});
  };

  useEffect(() => {
    setListingsLoading(true);
    Promise.all([fetchListingsLatest(), fetchMyAssetsLatest()]).finally(() => setListingsLoading(false));
  }, [token, user?.state]);

  useEffect(() => {
    if (!token) {
      setListResume(null);
      return;
    }
    try {
      const raw = sessionStorage.getItem(LIST_RESUME_KEY);
      if (!raw) {
        setListResume(null);
        return;
      }
      const p = JSON.parse(raw);
      if (!p?.tokenId || p?.listPriceWei == null || !p?.at) {
        sessionStorage.removeItem(LIST_RESUME_KEY);
        setListResume(null);
        return;
      }
      if (Date.now() - p.at > LIST_RESUME_TTL_MS) {
        sessionStorage.removeItem(LIST_RESUME_KEY);
        setListResume(null);
        return;
      }
      setListResume({ tokenId: String(p.tokenId), listPriceWei: String(p.listPriceWei) });
    } catch {
      setListResume(null);
    }
  }, [token]);

  useEffect(() => {
    if (!listResume?.tokenId) return;
    const match = myAssets.find((a) => String(a.tokenId) === String(listResume.tokenId));
    if (match?.isListed) {
      try {
        sessionStorage.removeItem(LIST_RESUME_KEY);
      } catch (_) {
        /* ignore */
      }
      setListResume(null);
    }
  }, [myAssets, listResume?.tokenId]);

  const clearListResume = () => {
    try {
      sessionStorage.removeItem(LIST_RESUME_KEY);
    } catch (_) {
      /* ignore */
    }
    setListResume(null);
  };

  const handleMarketplaceRefresh = () => {
    setRefreshingListings(true);
    Promise.all([fetchListingsLatest({ forceRefresh: true }), fetchMyAssetsLatest()])
      .catch(() => {})
      .finally(() => setRefreshingListings(false));
  };

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
  const handleDisconnect = () => {
    setAddressMenuOpen(false);
    disconnectWallet();
    assignAppPath("/");
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
      const hash = await writeContractAsync(
        bscWriteParams({
          address: marketplaceAddressNormalized,
          abi: MARKETPLACE_ABI,
          functionName: "cancelListing",
          args: [BigInt(tokenId)],
          gas: gasCancel,
        })
      );
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

  const handleBuy = async (tokenId, priceWei, seller = null, listingIndex = -1) => {
    if (listingsPage > 1) return;
    if (listingIndex >= 0 && isListingBuyLocked(listingIndex)) return;
    if (!marketplaceAddressNormalized || !usdtAddressNormalized || !publicClient || !writeContractAsync || !address) {
      setError("Wallet or contracts not ready.");
      return;
    }
    setError("");
    if (tryOpenInsufficientUsdtModal(usdtBalanceRaw, priceWei, { setInsufficientBalanceType, refetchUsdt: refetchUsdtBalance })) {
      return;
    }
    setLoadingBuy(tokenId);
    setBuyStep("approve");
    rememberWalletTxReturnPath("/marketplace");
    markWalletTxInFlight();
    try {
      const tradeReferrerRoot = await resolveSellerReferrerRoot(publicClient, referralAddressNormalized, seller);
      const hashApprove = await writeContractAsync(
        bscWriteParams({
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
        })
      );
      await publicClient.waitForTransactionReceipt({ hash: hashApprove });
      setBuyStep("buy");
      const hashBuy = await writeContractAsync(
        bscWriteParams({
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
        })
      );
      await publicClient.waitForTransactionReceipt({ hash: hashBuy });
      setListings((prev) => prev.filter((l) => String(l.tokenId) !== String(tokenId)));
      setPage1BuyUnlockOffset((o) =>
        Math.min(o + 1, LISTINGS_PER_PAGE - MARKETPLACE_PAGE1_BUYABLE_COUNT)
      );
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
      clearWalletTxReturnPath();
      clearWalletTxInFlight();
    } catch (e) {
      applyWalletTxError(e, {
        setInsufficientBalanceType,
        setError,
        refetchUsdt: refetchUsdtBalance,
        fallbackMessage: "Buy failed",
      });
    } finally {
      clearWalletTxInFlight();
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
    rememberWalletTxReturnPath("/marketplace");
    markWalletTxInFlight();
    try {
      const hashApprove = await writeContractAsync(
        bscWriteParams({
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
        })
      );
      await publicClient.waitForTransactionReceipt({ hash: hashApprove });
      try {
        sessionStorage.setItem(
          LIST_RESUME_KEY,
          JSON.stringify({
            tokenId: String(tokenId),
            listPriceWei: String(listPriceWei),
            at: Date.now(),
          })
        );
      } catch (_) {
        /* sessionStorage unavailable */
      }
      setListResume({ tokenId: String(tokenId), listPriceWei: String(listPriceWei) });
      setListStep("list");
      const hashList = await writeContractAsync(
        bscWriteParams({
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
        })
      );
      await publicClient.waitForTransactionReceipt({ hash: hashList });
      clearListResume();
      refetchData();
      clearWalletTxReturnPath();
      clearWalletTxInFlight();
    } catch (e) {
      applyWalletTxError(e, {
        setInsufficientBalanceType,
        setError,
        refetchUsdt: refetchUsdtBalance,
        fallbackMessage: "List failed",
      });
    } finally {
      clearWalletTxInFlight();
      setLoadingList(null);
      setListStep(null);
    }
  };

  const handleResumeListing = async () => {
    if (!listResume || !marketplaceAddressNormalized || !publicClient || !writeContractAsync || !address) return;
    rememberWalletTxReturnPath("/marketplace");
    markWalletTxInFlight();
    const tokenId = listResume.tokenId;
    const listPriceWei = listResume.listPriceWei;
    setError("");
    setLoadingList(tokenId);
    setListStep("list");
    try {
      const hashList = await writeContractAsync(
        bscWriteParams({
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
        })
      );
      await publicClient.waitForTransactionReceipt({ hash: hashList });
      clearListResume();
      refetchData();
      clearWalletTxReturnPath();
      clearWalletTxInFlight();
    } catch (e) {
      applyWalletTxError(e, {
        setInsufficientBalanceType,
        setError,
        refetchUsdt: refetchUsdtBalance,
        fallbackMessage: "List failed",
      });
    } finally {
      clearWalletTxInFlight();
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

  /** Tier: dynamic (0) → bots (1) → members (2). Within tier: oldest listed first (fixed; no user sort). */
  const sortedListings = [...filteredListings].sort((a, b) => {
    const trA = fallbackListingTierRank(a);
    const trB = fallbackListingTierRank(b);
    if (trA !== trB) return trA - trB;
    return byListedTimeOldestFirst(a, b);
  });

  const totalListingsPages = Math.max(1, Math.ceil(sortedListings.length / LISTINGS_PER_PAGE));
  const paginatedListings = sortedListings.slice(
    (listingsPage - 1) * LISTINGS_PER_PAGE,
    listingsPage * LISTINGS_PER_PAGE
  );

  const displayListings = HIDE_MARKETPLACE_PAGINATION_UI
    ? sortedListings.slice(0, LISTINGS_PER_PAGE)
    : paginatedListings;

  useEffect(() => {
    if (listingsPage > totalListingsPages) setListingsPage(totalListingsPages);
  }, [listingsPage, totalListingsPages]);

  const goToListingsPage = (nextPage) => {
    const clamped = Math.min(Math.max(1, nextPage), totalListingsPages);
    setListingsPage(clamped);
    if (typeof document !== "undefined") {
      document.querySelector(".marketplace-page__listings-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  /** Page 2+ all locked; page 1 uses a sliding window of 4 Buy Now rows (top 4 first, +1 unlock per buy). */
  const maxPage1BuyUnlockOffset = LISTINGS_PER_PAGE - MARKETPLACE_PAGE1_BUYABLE_COUNT;
  const isListingBuyLocked = (indexInDisplay) => {
    if (listingsPage > 1) return true;
    if (!HIDE_MARKETPLACE_PAGINATION_UI && listingsPage !== 1) return true;
    const offset = Math.min(page1BuyUnlockOffset, maxPage1BuyUnlockOffset);
    return indexInDisplay < offset || indexInDisplay >= offset + MARKETPLACE_PAGE1_BUYABLE_COUNT;
  };

  const showCacheWarmCountdown = sortedListings.length === 0 && warmCountdown > 0;
  const showCacheWarmRefresh = sortedListings.length === 0 && warmCountdown === 0;

  useEffect(() => {
    if (warmCountdown === 0 || sortedListings.length > 0) return undefined;
    const id = window.setInterval(() => {
      fetchListingsLatest();
    }, MARKETPLACE_CACHE_POLL_MS);
    return () => window.clearInterval(id);
  }, [warmCountdown, sortedListings.length, token]);

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
                  <div><dt>Earnings</dt><dd>${Number(formatUnits(BigInt(String(user.referralEarningsTotal || "0")), USDT_DECIMALS)).toFixed(2)} USDT <img src="/USDT_BEP20.png" alt="" className="usdt-logo-inline" aria-hidden="true" /></dd></div>
                </dl>
                <AppRouteLink to="/dashboard" className="marketplace-page__profile-card-link">My Dashboard</AppRouteLink>
              </div>
            </div>
          )}
        </aside>

        <main className="marketplace-page__main">
          {error && <p className="marketplace-page__error">{error}</p>}
          {listResume && token && (
            <div className="marketplace-page__resume-list" role="status">
              <p>
                <strong>Listing in progress:</strong> GLFA — approve is on-chain. Complete the list step (no second approve needed).
              </p>
              <div className="marketplace-page__resume-list-actions">
                <button
                  type="button"
                  className="marketplace-page__connect"
                  onClick={handleResumeListing}
                  disabled={Boolean(loadingList) || !address}
                >
                  {loadingList === listResume.tokenId && listStep === "list" ? "Confirm in wallet…" : "Complete listing"}
                </button>
                <button type="button" className="marketplace-page__wallet" onClick={clearListResume}>
                  Dismiss
                </button>
              </div>
            </div>
          )}
          {token && ownedNotListed.length > 0 && (
            <section className="marketplace-page__owned">
              <h2 className="marketplace-page__owned-title">Your Assets</h2>
              <p className="marketplace-page__owned-desc">List your Assets for sale from here.</p>
              <div className="profile-hub__grid marketplace-page__grid marketplace-page__grid--grid-3 marketplace-page__owned-grid">
                {ownedNotListed.map((nft) => {
                  const listUsdt = chainListUsdt ?? nft.listPriceUsdt;
                  const listWei = chainListWeiStr ?? nft.listPriceWei;
                  return (
                  <div key={nft.tokenId} className="profile-hub__nft-card">
                    <div className="profile-hub__nft-card-image-wrap">
                      <NFTMedia tokenURI={nft.tokenURI} tokenId={nft.tokenId} className="profile-hub__nft-card-image" />
                    </div>
                    <div className="profile-hub__nft-card-details">
                      <div className="profile-hub__nft-card-row">
                        <span className="profile-hub__nft-id">GLFA</span>
                        <span className="profile-hub__nft-price">
                          <span className="profile-hub__nft-price-label">{listUsdt} USDT <img src="/USDT_BEP20.png" alt="" className="usdt-logo-inline" aria-hidden="true" /></span>
                        </span>
                      </div>
                      <p className="profile-hub__nft-owned-by">Not listed</p>
                      <div className="profile-hub__nft-card-center">
                        <button
                          type="button"
                          className="profile-hub__nft-btn"
                          onClick={() => handleList(nft.tokenId, listWei)}
                          disabled={loadingList != null || listWei == null || String(listWei) === ""}
                        >
                          {loadingList === nft.tokenId ? (
                            <span className="profile-hub__nft-action-label">
                              {listStep === "approve" ? "1/2 Approving…" : "2/2 Listing…"}
                            </span>
                          ) : (
                            <span className="profile-hub__nft-action-label">{`List for $${listUsdt}`}</span>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            </section>
          )}
          <section className="marketplace-page__listings-section">
            <h2 className="marketplace-page__section-title">Marketplace</h2>
          {showCacheWarmCountdown ? (
            <div className="marketplace-page__cache-warm" role="status" aria-live="polite">
              <p className="marketplace-page__cache-warm-title">Marketplace is loading listings</p>
              <p className="marketplace-page__cache-warm-sub">
                The server is building the listings cache (this can take about 90 seconds). Listings will appear
                automatically when ready, or refresh after the timer ends.
              </p>
              <div className="marketplace-page__cache-warm-count" aria-label={`${warmCountdown} seconds remaining`}>
                {warmCountdown}
              </div>
              <p className="marketplace-page__cache-warm-label">seconds remaining</p>
              {listingsLoading ? (
                <p className="marketplace-page__cache-warm-hint">Checking for listings…</p>
              ) : null}
            </div>
          ) : showCacheWarmRefresh ? (
            <div className="marketplace-page__empty marketplace-page__cache-warm-done">
              <p className="marketplace-page__empty-text">
                {listingsLoading || refreshingListings
                  ? "Loading listings…"
                  : "Cache should be ready. Refresh to load marketplace listings."}
              </p>
              <button
                type="button"
                className="marketplace-page__refresh marketplace-page__refresh--primary"
                onClick={handleMarketplaceRefresh}
                disabled={refreshingListings}
              >
                {refreshingListings ? "Refreshing…" : "Refresh listings"}
              </button>
            </div>
          ) : filteredListings.length === 0 ? (
            <div className="marketplace-page__empty">
              <p className="marketplace-page__empty-text">No listings to show right now. Try refreshing, or list an asset from your Dashboard.</p>
              <button type="button" className="marketplace-page__refresh" onClick={handleMarketplaceRefresh}>
                Refresh
              </button>
            </div>
          ) : (
            <>
            <div className="profile-hub__grid marketplace-page__grid marketplace-page__grid--grid-5">
              {displayListings.map((l, listingIndex) => {
                const isMyListing = currentWallet && (String(l.seller || "").toLowerCase() === currentWallet);
                const buyLocked = !isMyListing && isListingBuyLocked(listingIndex);
                return (
                <div key={l.tokenId} className="profile-hub__nft-card">
                  <div className="profile-hub__nft-card-image-wrap">
                    <NFTMedia tokenURI={l.tokenURI} tokenId={l.tokenId} className="profile-hub__nft-card-image" />
                  </div>
                  <div className="profile-hub__nft-card-details">
                    <div className="profile-hub__nft-card-row">
                      <span className="profile-hub__nft-id">GLFA</span>
                      <span className="profile-hub__nft-price">
                      <span className="profile-hub__nft-price-label">{l.priceFormatted ? l.priceFormatted.replace(/\s*USDT$/i, "").trim() : Number(formatUnits(BigInt(String(l.price || 0)), USDT_DECIMALS)).toFixed(0)} USDT <img src="/USDT_BEP20.png" alt="" className="usdt-logo-inline" aria-hidden="true" /></span>
                    </span>
                    </div>
                    <div className="profile-hub__nft-card-center">
                      {isMyListing ? (
                        <div className="profile-hub__nft-card-center-row">
                          <span className="profile-hub__nft-badge profile-hub__nft-badge--listed">
                            <span className="profile-hub__nft-action-label">Listed</span>
                          </span>
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
                      ) : buyLocked ? (
                        <button
                          type="button"
                          className="profile-hub__nft-btn profile-hub__nft-btn--locked"
                          disabled
                          aria-label="Locked — buy an available listing above to unlock more"
                          title="Buy from an unlocked listing to unlock the next slot"
                        >
                          <MarketplaceBuyLockIcon className="profile-hub__nft-lock-icon" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="profile-hub__nft-btn"
                          onClick={() => handleBuy(l.tokenId, l.price, l.seller, listingIndex)}
                          disabled={loadingBuy != null}
                        >
                          {loadingBuy === l.tokenId ? (
                            <span className="profile-hub__nft-action-label">
                              {buyStep === "approve" ? "1/2 Approving…" : "2/2 Buying…"}
                            </span>
                          ) : (
                            <span className="profile-hub__nft-action-label">Buy Now</span>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
              })}
            </div>
            {totalListingsPages > 1 && (
              <nav
                className={`marketplace-page__pagination${HIDE_MARKETPLACE_PAGINATION_UI ? " marketplace-page__pagination--hidden" : ""}`}
                aria-label="Marketplace pages"
                aria-hidden={HIDE_MARKETPLACE_PAGINATION_UI ? true : undefined}
              >
                <button
                  type="button"
                  className="marketplace-page__page-btn"
                  onClick={() => goToListingsPage(listingsPage - 1)}
                  disabled={listingsPage <= 1}
                >
                  Previous
                </button>
                <span className="marketplace-page__page-info">
                  Page {listingsPage} of {totalListingsPages}
                </span>
                <button
                  type="button"
                  className="marketplace-page__page-btn"
                  onClick={() => goToListingsPage(listingsPage + 1)}
                  disabled={listingsPage >= totalListingsPages}
                >
                  Next
                </button>
              </nav>
            )}
            </>
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
