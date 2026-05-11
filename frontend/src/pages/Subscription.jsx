import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { assignAppPath } from "../utils/appNavigation";
import { useBalance, useConfig, useDisconnect, useReadContract, useWriteContract, usePublicClient, useReconnect } from "wagmi";
import { formatEther, formatUnits } from "viem";
import { useAuth } from "../hooks/useAuth";
import { useWalletConnect } from "../hooks/useWalletConnect";
import { API, ASSET_IMAGE } from "../config";
import { applyWalletTxError, tryOpenInsufficientUsdtModal } from "../utils/transactionError";
import {
  safeGasLimit,
  DEFAULT_APPROVE_GAS,
  DEFAULT_SUBSCRIBE_GAS,
} from "../utils/safeContractGas";
import InsufficientBalanceModal from "../components/InsufficientBalanceModal";
import { NavbarBrandLink } from "../components/NavbarBrandLink";
import { USDT_DECIMALS } from "../constants/usdtDecimals";
import { BSC_CHAIN_ID } from "../constants/chain";
import { formatUsdtTrim, readContractUint256 } from "../utils/formatUsdt";
import { resolveSignerAddress } from "../utils/ensureConnectorAddress";

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
  const { openModal, address } = useWalletConnect();
  const wagmiConfig = useConfig();
  const { reconnectAsync } = useReconnect();
  const balanceAddress = (address || (token && user?.wallet ? user.wallet : null)) ?? undefined;
  /** Reads must not depend on connector `chainId` — it is often undefined before reconnect, which broke balance & price RPC calls. */
  const { data: balanceData } = useBalance({
    address: balanceAddress,
    chainId: BSC_CHAIN_ID,
  });
  const { disconnect: disconnectWallet } = useDisconnect();
  const [loading, setLoading] = useState(false);
  const [payStep, setPayStep] = useState(null);
  const [error, setError] = useState("");
  const [insufficientBalanceType, setInsufficientBalanceType] = useState(null);
  const subContractAddress = (import.meta.env.VITE_SUBSCRIPTION_CONTRACT || "").trim();
  const subContractAddressNormalized = subContractAddress && subContractAddress.startsWith("0x") ? subContractAddress : subContractAddress ? `0x${subContractAddress}` : "";
  const [config, setConfig] = useState({
    price: "",
    priceFormatted: "",
    priceWei: "",
    contractAddress: subContractAddressNormalized || import.meta.env.VITE_SUBSCRIPTION_CONTRACT || "",
  });
  const [configLoadError, setConfigLoadError] = useState("");
  const [addressMenuOpen, setAddressMenuOpen] = useState(false);
  const publicClient = usePublicClient({ chainId: BSC_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();

  const { data: subscriptionPriceWei } = useReadContract({
    address: subContractAddressNormalized || undefined,
    abi: SUBSCRIPTION_ABI,
    functionName: "subscriptionPrice",
    chainId: BSC_CHAIN_ID,
    query: { enabled: Boolean(subContractAddressNormalized) },
  });
  const subscriptionPricePretty = subscriptionPriceWei != null ? formatUsdtTrim(subscriptionPriceWei) : null;
  const subscriptionPriceFormatted = subscriptionPricePretty != null ? `${subscriptionPricePretty} USDT` : null;
  const [portalReady, setPortalReady] = useState(false);
  const menuRef = useRef(null);

  // USDT contract from .env – same chain as connected wallet (BNB Smart Chain mainnet)
  const usdtAddress = (import.meta.env.VITE_USDT_ADDRESS || "").trim();
  const usdtAddressNormalized = usdtAddress && usdtAddress.startsWith("0x") ? usdtAddress : usdtAddress ? `0x${usdtAddress}` : "";
  const walletForReads = address || (token && user?.wallet ? user.wallet : null) || undefined;
  const usdtReadEnabled = Boolean(usdtAddressNormalized && walletForReads);
  const {
    data: usdtBalanceRaw,
    isLoading: usdtBalanceLoading,
    isError: usdtBalanceError,
    refetch: refetchUsdtBalance,
  } = useReadContract({
    address: usdtAddressNormalized || undefined,
    abi: USDT_ABI,
    functionName: "balanceOf",
    args: walletForReads ? [walletForReads] : undefined,
    chainId: BSC_CHAIN_ID,
    query: { enabled: usdtReadEnabled },
  });
  const usdtBalance = usdtBalanceRaw != null ? Number(formatUnits(usdtBalanceRaw, USDT_DECIMALS)) : null;
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
    assignAppPath("/");
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
      if (!token) return;
      setConfigLoadError("");
      const r = await fetch(`${API}/subscription/config`, { headers: { Authorization: `Bearer ${token}` } });
      const c = await r.json().catch(() => ({}));
      if (!r.ok) {
        setConfigLoadError(typeof c.error === "string" ? c.error : `Subscription config unavailable (${r.status})`);
        return;
      }
      const addr = c.contractAddress || subContractAddressNormalized || import.meta.env.VITE_SUBSCRIPTION_CONTRACT || "";
      setConfig((prev) => ({
        ...prev,
        ...c,
        contractAddress: addr,
        price: c.price != null ? String(c.price) : prev.price,
        priceWei: c.priceWei != null ? String(c.priceWei) : prev.priceWei,
      }));
    };
    loadConfig();
  }, [token, subContractAddressNormalized]);

  const handlePay = async () => {
    setError("");
    const txAddress = await resolveSignerAddress(wagmiConfig, address, reconnectAsync);
    if (!txAddress) {
      openModal?.();
      setError("Wallet session didn’t restore in this tab. Tap Connect and pick the same wallet you used to sign in.");
      return;
    }
    if (user?.wallet && String(user.wallet).toLowerCase() !== String(txAddress).toLowerCase()) {
      setError("Switch your wallet to the same address as your profile (shown in the header), then try again.");
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
      const amount =
        readContractUint256(subscriptionPriceWei) ??
        (config.priceWei !== undefined && config.priceWei !== "" ? BigInt(String(config.priceWei)) : undefined);
      if (amount == null) {
        setError("Subscription price could not be loaded. Refresh the page or check your network.");
        setLoading(false);
        setPayStep(null);
        return;
      }
      if (tryOpenInsufficientUsdtModal(usdtBalanceRaw, amount, { setInsufficientBalanceType, refetchUsdt: refetchUsdtBalance })) {
        setLoading(false);
        setPayStep(null);
        return;
      }
      // 1) Approve USDT – wallet will ask to approve spending
      const gasApprove = await safeGasLimit(
        publicClient,
        {
          address: usdtAddressNormalized,
          abi: USDT_ABI,
          functionName: "approve",
          args: [config.contractAddress, amount],
          account: txAddress,
        },
        DEFAULT_APPROVE_GAS
      );
      const hashApprove = await writeContractAsync({
        chainId: BSC_CHAIN_ID,
        account: txAddress,
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
          account: txAddress,
        },
        DEFAULT_SUBSCRIBE_GAS
      );
      const hashSubscribe = await writeContractAsync({
        chainId: BSC_CHAIN_ID,
        account: txAddress,
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
      assignAppPath("/mint");
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

  const displayPrice =
    subscriptionPriceFormatted ||
    (config.price ? `${config.price} USDT` : (config.priceFormatted || "").replace(/^\$\s*/, "").trim()) ||
    "…";
  const approveAmountReady =
    subscriptionPriceWei != null ||
    (config.priceWei !== undefined && String(config.priceWei).length > 0);

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
                {usdtBalanceLoading
                  ? "…"
                  : usdtBalanceError
                    ? "unavailable"
                    : usdtBalance != null
                      ? <>
                          {usdtBalance.toFixed(2)} USDT{" "}
                          <img src="/USDT_BEP20.png" alt="" className="usdt-logo-inline" aria-hidden="true" />
                        </>
                      : "—"}
              </span>
            </div>
          </div>

          <div className="subscription-modern__two-steps">
            <span className="subscription-modern__two-steps-intro">You&apos;ll sign 2 transactions:</span>
            <span className="subscription-modern__two-steps-item">1) Approve USDT</span>
            <span className="subscription-modern__two-steps-item">2) Pay (Subscribe)</span>
          </div>
          {configLoadError && <p className="profile-modern__error subscription-modern__error">{configLoadError}</p>}
          {error && <p className="profile-modern__error subscription-modern__error">{error}</p>}
          <button
            type="button"
            className="profile-modern__submit subscription-modern__submit"
            onClick={handlePay}
            disabled={loading || !approveAmountReady}
          >
            {loading
              ? (payStep === "approve" ? "1/2 Approving USDT…" : "2/2 Subscribing…")
              : !approveAmountReady
                ? "Loading price…"
                : !token || !user?.wallet
                  ? "Connect wallet to pay"
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
