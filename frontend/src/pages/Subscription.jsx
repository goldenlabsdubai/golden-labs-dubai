import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { useAccount, useBalance, useDisconnect, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { formatEther, formatUnits, parseUnits } from "viem";
import { useAuth } from "../hooks/useAuth";
import { useWalletConnect } from "../hooks/useWalletConnect";
import { API, ASSET_IMAGE } from "../config";
import { applyWalletTxError } from "../utils/transactionError";
import {
  safeGasLimit,
  DEFAULT_APPROVE_GAS,
  DEFAULT_SUBSCRIBE_GAS,
} from "../utils/safeContractGas";
import InsufficientBalanceModal from "../components/InsufficientBalanceModal";

// USDT (BEP20) – balance and approve. Use same chain as connected wallet.
const USDT_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
];
const SUBSCRIPTION_ABI = [
  { name: "subscriptionPrice", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "subscribe", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] },
];

export default function Subscription() {
  const { token, refreshUser, user } = useAuth();
  const isResubscribe = user?.state === "SUSPENDED";
  const navigate = useNavigate();
  const { openModal, isConnected, address } = useWalletConnect();
  const { chainId } = useAccount();
  const { data: balanceData } = useBalance({ address: (address || (token && user?.wallet ? user.wallet : null)) ?? undefined });
  const { disconnect: disconnectWallet } = useDisconnect();
  const [loading, setLoading] = useState(false);
  const [payStep, setPayStep] = useState(null);
  const [error, setError] = useState("");
  const [insufficientBalanceType, setInsufficientBalanceType] = useState(null);
  const subContractAddress = (import.meta.env.VITE_SUBSCRIPTION_CONTRACT || "").trim();
  const subContractAddressNormalized = subContractAddress && subContractAddress.startsWith("0x") ? subContractAddress : subContractAddress ? `0x${subContractAddress}` : "";
  const [config, setConfig] = useState({ priceFormatted: "10 USDT", contractAddress: subContractAddressNormalized || import.meta.env.VITE_SUBSCRIPTION_CONTRACT || "" });
  const [addressMenuOpen, setAddressMenuOpen] = useState(false);
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const { data: subscriptionPriceWei } = useReadContract({
    address: subContractAddressNormalized || undefined,
    abi: SUBSCRIPTION_ABI,
    functionName: "subscriptionPrice",
  });
  const subscriptionPriceFormatted = subscriptionPriceWei != null ? `${Number(formatUnits(subscriptionPriceWei, 6))} USDT` : "10 USDT";
  const [portalReady, setPortalReady] = useState(false);
  const menuRef = useRef(null);

  // USDT contract from .env – same chain as connected wallet (e.g. BSC Testnet)
  const usdtAddress = (import.meta.env.VITE_USDT_ADDRESS || "").trim();
  const usdtAddressNormalized = usdtAddress && usdtAddress.startsWith("0x") ? usdtAddress : usdtAddress ? `0x${usdtAddress}` : "";
  const walletForReads = address || (token && user?.wallet ? user.wallet : null) || undefined;
  const { data: usdtBalanceRaw, isLoading: usdtBalanceLoading, refetch: refetchUsdtBalance } = useReadContract({
    address: usdtAddressNormalized || undefined,
    abi: USDT_ABI,
    functionName: "balanceOf",
    args: walletForReads ? [walletForReads] : undefined,
    ...(chainId != null && { chainId }),
  });
  const usdtBalance = usdtBalanceRaw != null ? Number(formatUnits(usdtBalanceRaw, 6)) : null;
  const bnbBalanceFormatted = balanceData?.value != null ? Number(formatEther(balanceData.value)).toFixed(4) : null;

  useEffect(() => {
    setPortalReady(true);
  }, []);

  const displayAddress = address || (token && user?.wallet ? user.wallet : null) || null;

  const handleConnect = () => {
    if (openModal) openModal();
  };

  const handleDisconnect = () => {
    setAddressMenuOpen(false);
    disconnectWallet();
    navigate("/", { replace: true });
  };

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setAddressMenuOpen(false);
    }
    if (addressMenuOpen) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [addressMenuOpen]);

  useEffect(() => {
    const loadConfig = async () => {
      const r = await fetch(`${API}/subscription/config`, { headers: { Authorization: `Bearer ${token}` } });
      const c = await r.json().catch(() => ({}));
      const addr = c.contractAddress || subContractAddressNormalized || import.meta.env.VITE_SUBSCRIPTION_CONTRACT || "";
      setConfig((prev) => ({ ...prev, ...c, contractAddress: addr }));
    };
    loadConfig();
  }, [token, subContractAddressNormalized]);

  const handlePay = async () => {
    if (!address) {
      setError("Wallet is connecting… Please wait a moment and try again.");
      return;
    }
    if (!config.contractAddress) {
      setError("Contract not configured. Deploy contracts first.");
      return;
    }
    if (!usdtAddressNormalized) {
      setError("USDT address not set in config.");
      return;
    }
    if (!publicClient || !writeContractAsync) {
      setError("Wallet is connecting… Please wait a moment and try again.");
      return;
    }
    setLoading(true);
    setPayStep("approve");
    setError("");
    try {
      const amount = subscriptionPriceWei ?? parseUnits("10", 6);
      // 1) Approve USDT – wallet will ask to approve spending
      const gasApprove = await safeGasLimit(
        publicClient,
        {
          address: usdtAddressNormalized,
          abi: USDT_ABI,
          functionName: "approve",
          args: [config.contractAddress, amount],
          account: address,
        },
        DEFAULT_APPROVE_GAS
      );
      const hashApprove = await writeContractAsync({
        address: usdtAddressNormalized,
        abi: USDT_ABI,
        functionName: "approve",
        args: [config.contractAddress, amount],
        gas: gasApprove,
      });
      await publicClient.waitForTransactionReceipt({ hash: hashApprove });
      // 2) Subscribe (Pay) – wallet will ask to confirm subscribe
      setPayStep("subscribe");
      const gasSubscribe = await safeGasLimit(
        publicClient,
        {
          address: config.contractAddress,
          abi: SUBSCRIPTION_ABI,
          functionName: "subscribe",
          account: address,
        },
        DEFAULT_SUBSCRIBE_GAS
      );
      const hashSubscribe = await writeContractAsync({
        address: config.contractAddress,
        abi: SUBSCRIPTION_ABI,
        functionName: "subscribe",
        gas: gasSubscribe,
      });
      await publicClient.waitForTransactionReceipt({ hash: hashSubscribe });

      const res = await fetch(`${API}/subscription/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ txHash: hashSubscribe }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Confirm failed");
      await refreshUser();
      refetchUsdtBalance?.();
      navigate("/mint");
    } catch (e) {
      applyWalletTxError(e, {
        setInsufficientBalanceType,
        setError,
        refetchUsdt: refetchUsdtBalance,
        fallbackMessage: "Payment failed",
      });
    } finally {
      setLoading(false);
      setPayStep(null);
    }
  };

  const displayPrice = (subscriptionPriceFormatted || config.priceFormatted || "10 USDT").replace(/^\$+\s*/, "").trim() || "10 USDT";

  const subscriptionBg = (
    <div className="profile-modern__bg" aria-hidden="true">
      <div className="profile-modern__bg-image" />
      <div className="profile-modern__bg-overlay" />
    </div>
  );
  const portalContainer = typeof document !== "undefined" ? document.getElementById("profile-bg-layer") : null;

  return (
    <div className="profile-modern subscription-modern">
      <InsufficientBalanceModal
        open={Boolean(insufficientBalanceType)}
        type={insufficientBalanceType}
        onClose={() => setInsufficientBalanceType(null)}
        usdtBalanceFormatted={usdtBalance != null ? usdtBalance.toFixed(2) : null}
        bnbBalanceFormatted={bnbBalanceFormatted}
      />
      {portalReady && portalContainer && createPortal(subscriptionBg, portalContainer)}

      <header className="profile-modern__header landing-v2__header">
        <Link to="/" className="landing-v2__logo">
          Golden Labs
        </Link>
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
            <button type="button" className="landing-v2__btn landing-v2__btn--primary" onClick={handleConnect}>
              Connect Wallet
            </button>
          )}
        </div>
      </header>

      <div className="profile-modern__panel-top">
        <img src={ASSET_IMAGE} alt="Golden Labs DeFi Asset" className="profile-modern__panel-asset" />
        <h2 className="profile-modern__panel-title">Golden Labs</h2>
      </div>

      <main className="profile-modern__main">
        <div className="profile-modern__glass subscription-modern__glass">
          <span className="profile-modern__step">{isResubscribe ? "Resubscribe" : "Step 2 · Subscription"}</span>
          <h1 className="profile-modern__headline">{isResubscribe ? "Resubscribe to continue" : "Unlock Minting & Trading"}</h1>
          <p className="profile-modern__subline">
            {isResubscribe
              ? "Your subscription is suspended (e.g. profit threshold reached). Pay again to unlock marketplace, dashboard, trading, and referral withdrawals."
              : "Subscribe To Access Assets & The Marketplace"}
          </p>

          <div className="subscription-modern__price-card">
            <div className="subscription-modern__price-row">
              <div className="subscription-modern__price">{displayPrice}</div>
              <img src="/USDT_BEP20.png" alt="USDT BEP20" className="subscription-modern__price-icon" />
            </div>
          </div>

          <div className="subscription-modern__balance-wrap">
            <div className="subscription-modern__balance">
              <img src="/USDT_BEP20.png" alt="" className="subscription-modern__balance-icon" aria-hidden="true" />
              <span className="subscription-modern__balance-label">Your USDT balance:</span>
              <span className="subscription-modern__balance-value">
                {usdtBalanceLoading ? "…" : usdtBalance != null ? <>{usdtBalance.toFixed(2)} USDT <img src="/USDT_BEP20.png" alt="" className="usdt-logo-inline" aria-hidden="true" /></> : "—"}
              </span>
            </div>
          </div>

          <div className="subscription-modern__two-steps">
            <span className="subscription-modern__two-steps-intro">You&apos;ll sign 2 transactions:</span>
            <span className="subscription-modern__two-steps-item">1) Approve USDT</span>
            <span className="subscription-modern__two-steps-item">2) Pay (Subscribe)</span>
          </div>
          {error && <p className="profile-modern__error subscription-modern__error">{error}</p>}
          <button
            type="button"
            className="profile-modern__submit subscription-modern__submit"
            onClick={handlePay}
            disabled={loading || !address}
          >
            {loading
              ? (payStep === "approve" ? "1/2 Approving USDT…" : "2/2 Subscribing…")
              : !address
                ? "Preparing wallet…"
                : isResubscribe ? `Re-subscribe ${displayPrice}` : `Pay ${displayPrice}`}
          </button>
        </div>
      </main>

      <div className="profile-modern__panel-howto-wrap">
        <div className="profile-modern__panel-howto">
          <h3 className="profile-modern__panel-howto-title">What you get</h3>
          <ul className="profile-modern__panel-howto-list">
            <li>Subscribe with BEP20 USDT</li>
            <li>Subscription to unlock all features</li>
            {!isResubscribe && <li>Access to mint your Golden Labs asset (1 Asset per wallet)</li>}
            <li>Full marketplace: buy, sell, trade & earn</li>
            <li>Referral rewards and dashboard</li>
            {isResubscribe && (
              <li className="subscription-modern__resub-note">While suspended: no trading, no referral withdrawals on-chain until you resubscribe.</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
