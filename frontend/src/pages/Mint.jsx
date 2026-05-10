import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AppRouteLink } from "../components/AppRouteLink";
import { assignAppPath } from "../utils/appNavigation";
import { useAccount, useBalance, useDisconnect, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { formatEther, formatUnits } from "viem";
import { useAuth } from "../hooks/useAuth";
import { useWalletConnect } from "../hooks/useWalletConnect";
import { API, ASSET_IMAGE, EXPLORER_BY_CHAIN } from "../config";
import { applyWalletTxError, tryOpenInsufficientUsdtModal } from "../utils/transactionError";
import InsufficientBalanceModal from "../components/InsufficientBalanceModal";
import { NavbarBrandLink } from "../components/NavbarBrandLink";
import { canAccessTradingNav } from "../utils/tradingAccess";
import { USDT_DECIMALS } from "../constants/usdtDecimals";
import { formatUsdtTrim, readContractUint256 } from "../utils/formatUsdt";

const USDT_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
];
const NFT_ABI = [
  { name: "mint", type: "function", stateMutability: "nonpayable", inputs: [{ name: "uri", type: "string" }], outputs: [] },
  { name: "mintPrice", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "nextTokenId", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "totalMinted", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];
export default function Mint() {
  const { token, refreshUser, user } = useAuth();
  const { openModal, isConnected, address } = useWalletConnect();
  const { chainId } = useAccount();
  const { data: balanceData } = useBalance({ address: address ?? undefined });
  const { disconnect: disconnectWallet } = useDisconnect();
  const [loading, setLoading] = useState(false);
  const [mintStep, setMintStep] = useState(null);
  const [error, setError] = useState("");
  const [insufficientBalanceType, setInsufficientBalanceType] = useState(null);
  const [config, setConfig] = useState({
    priceFormatted: "",
    priceWei: "",
    price: "",
    rule: "1 Wallet = 1 Asset (lifetime)",
    contractAddress: "",
    metadataUri: "",
    metadataBasePath: "",
    nftName: "",
    nftSymbol: "",
    totalSupply: null,
    maxSupply: null,
  });
  const [addressMenuOpen, setAddressMenuOpen] = useState(false);
  const [configLoadError, setConfigLoadError] = useState("");
  const [portalReady, setPortalReady] = useState(false);
  const menuRef = useRef(null);
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const nftContractAddress = (config.contractAddress || import.meta.env.VITE_NFT_CONTRACT || "").trim();
  const nftAddressNormalized = nftContractAddress && nftContractAddress.startsWith("0x") ? nftContractAddress : nftContractAddress ? `0x${nftContractAddress}` : "";

  const usdtAddress = (import.meta.env.VITE_USDT_ADDRESS || "").trim();
  const usdtAddressNormalized = usdtAddress && usdtAddress.startsWith("0x") ? usdtAddress : usdtAddress ? `0x${usdtAddress}` : "";

  const { data: nextTokenId } = useReadContract({
    address: nftAddressNormalized || undefined,
    abi: NFT_ABI,
    functionName: "nextTokenId",
    query: { enabled: Boolean(nftAddressNormalized) },
    ...(chainId != null && { chainId }),
  });
  const { data: totalMinted } = useReadContract({
    address: nftAddressNormalized || undefined,
    abi: NFT_ABI,
    functionName: "totalMinted",
    query: { enabled: Boolean(nftAddressNormalized) },
    ...(chainId != null && { chainId }),
  });
  const { data: mintPriceOnChain } = useReadContract({
    address: nftAddressNormalized || undefined,
    abi: NFT_ABI,
    functionName: "mintPrice",
    query: { enabled: Boolean(nftAddressNormalized) },
    ...(chainId != null && { chainId }),
  });
  const { data: usdtBalanceRaw, isLoading: usdtBalanceLoading, refetch: refetchUsdtBalance } = useReadContract({
    address: usdtAddressNormalized || undefined,
    abi: USDT_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    ...(chainId != null && { chainId }),
  });
  const usdtBalance = usdtBalanceRaw != null ? Number(formatUnits(usdtBalanceRaw, USDT_DECIMALS)) : null;
  const bnbBalanceFormatted = balanceData?.value != null ? Number(formatEther(balanceData.value)).toFixed(4) : null;

  useEffect(() => setPortalReady(true), []);
  useEffect(() => {
    if (!token) {
      setConfigLoadError("");
      return;
    }
    let cancelled = false;
    setConfigLoadError("");
    fetch(`${API}/mint/config`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        const c = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) {
          setConfigLoadError(typeof c.error === "string" ? c.error : `Mint config unavailable (${r.status})`);
          return;
        }
        setConfig((prev) => ({ ...prev, ...c }));
      })
      .catch(() => {
        if (!cancelled) setConfigLoadError("Could not load mint config from the API.");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Already minted → go to dashboard (don't stay on mint page)
  useEffect(() => {
    if (canAccessTradingNav(user)) {
      assignAppPath("/dashboard");
    }
  }, [user?.state]);

  const displayAddress = address || (token && user?.wallet ? user.wallet : null) || null;
  const explorerUrl = chainId && EXPLORER_BY_CHAIN[chainId] && displayAddress
    ? `${EXPLORER_BY_CHAIN[chainId]}/address/${displayAddress}`
    : null;

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
    if (addressMenuOpen) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [addressMenuOpen]);

  const buildMintUri = () => {
    const base = (config.metadataBasePath || "").replace(/^ipfs:\/\//, "").trim();
    const singleUri = (config.metadataUri || "").replace(/^ipfs:\/\//, "").trim();
    if (base && nextTokenId != null) {
      const id = Number(nextTokenId);
      return `ipfs://${base}/${id}.json`;
    }
    if (singleUri) return singleUri.startsWith("ipfs://") ? singleUri : `ipfs://${singleUri}`;
    return null;
  };

  const handleMint = async () => {
    const nftAddr = config.contractAddress || nftAddressNormalized;
    if (!nftAddr) {
      setError("Asset contract not configured.");
      return;
    }
    if (!usdtAddressNormalized) {
      setError("USDT address not set in config.");
      return;
    }
    if (!publicClient || !writeContractAsync) {
      setError("Wallet not ready. Use the same wallet you connected with (e.g. MetaMask).");
      return;
    }
    const uri = buildMintUri();
    if (!uri) {
      setError("Asset metadata not set. Set NFT_METADATA_BASE_URI or NFT_METADATA_URI in backend.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const mintPriceWei =
        mintPriceOnChain != null
          ? readContractUint256(mintPriceOnChain)
          : config?.priceWei != null && String(config.priceWei) !== ""
            ? BigInt(String(config.priceWei))
            : null;
      if (mintPriceWei == null) {
        setError("Mint price could not be read from the NFT contract. Check your wallet network and try again.");
        setLoading(false);
        return;
      }
      if (tryOpenInsufficientUsdtModal(usdtBalanceRaw, mintPriceWei, { setInsufficientBalanceType, refetchUsdt: refetchUsdtBalance })) {
        setLoading(false);
        return;
      }
      const hashApprove = await writeContractAsync({
        address: usdtAddressNormalized,
        abi: USDT_ABI,
        functionName: "approve",
        args: [nftAddr, mintPriceWei],
      });
      await publicClient.waitForTransactionReceipt({ hash: hashApprove });
      const tokenIdMinted = nextTokenId != null ? Number(nextTokenId) : null;
      const hashMint = await writeContractAsync({
        address: nftAddr,
        abi: NFT_ABI,
        functionName: "mint",
        args: [uri],
      });
      await publicClient.waitForTransactionReceipt({ hash: hashMint });

      const doConfirm = () =>
        fetch(`${API}/mint/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ txHash: hashMint, tokenId: tokenIdMinted }),
        });

      let res = await doConfirm();
      if (res.status === 403) {
        await new Promise((r) => setTimeout(r, 2500));
        res = await doConfirm();
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Confirm failed");
      await refreshUser();
      refetchUsdtBalance?.();
      assignAppPath("/dashboard");
    } catch (e) {
      applyWalletTxError(e, {
        setInsufficientBalanceType,
        setError,
        refetchUsdt: refetchUsdtBalance,
        fallbackMessage: "Mint failed",
      });
    } finally {
      setLoading(false);
      setMintStep(null);
    }
  };

  const displayPrice =
    mintPriceOnChain != null
      ? `${formatUsdtTrim(mintPriceOnChain)} USDT`
      : config.price != null && String(config.price) !== "" && config.mintPriceKnown !== false
        ? `${config.price} USDT`
        : configLoadError
          ? "—"
          : "…";
  const hasMintPrice =
    mintPriceOnChain != null || (config?.priceWei != null && String(config.priceWei) !== "" && config.mintPriceKnown !== false);
  const supplyText = totalMinted != null && config.maxSupply != null
    ? `${Number(totalMinted).toLocaleString()} / ${Number(config.maxSupply).toLocaleString()}`
    : totalMinted != null
      ? `${Number(totalMinted).toLocaleString()} minted`
      : config.totalSupply != null
        ? `${config.totalSupply.toLocaleString()}${config.maxSupply != null ? ` / ${config.maxSupply.toLocaleString()}` : ""}`
        : null;

  const mintBg = (
    <div className="profile-modern__bg" aria-hidden="true">
      <div className="profile-modern__bg-image" />
      <div className="profile-modern__bg-overlay" />
    </div>
  );
  const portalContainer = typeof document !== "undefined" ? document.getElementById("profile-bg-layer") : null;

  return (
    <div className="profile-modern mint-modern">
      <InsufficientBalanceModal
        open={Boolean(insufficientBalanceType)}
        type={insufficientBalanceType}
        onClose={() => setInsufficientBalanceType(null)}
        usdtBalanceFormatted={usdtBalance != null ? usdtBalance.toFixed(2) : null}
        bnbBalanceFormatted={bnbBalanceFormatted}
      />
      {portalReady && portalContainer && createPortal(mintBg, portalContainer)}

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
        <div className="profile-modern__glass mint-modern__glass">
          <span className="profile-modern__step">Step 3 · Mint</span>
          <h1 className="profile-modern__headline">Mint Your Asset</h1>
          <p className="profile-modern__subline">One NFT per wallet · Funds go to Reserve Pool</p>

          {(config.nftName || config.nftSymbol) && (
            <p className="mint-modern__collection">
              {config.nftName && <span>{config.nftName}</span>}
              {config.nftSymbol && <span className="mint-modern__symbol"> ({config.nftSymbol})</span>}
              {supplyText != null && <span className="mint-modern__supply"> · {supplyText}</span>}
            </p>
          )}

          <div className="mint-modern__price-card">
            <div className="mint-modern__price-row">
              <div className="mint-modern__price">{displayPrice}</div>
              <img src="/USDT_BEP20.png" alt="USDT" className="mint-modern__price-icon" />
            </div>
            <p className="mint-modern__rule">{config.rule}</p>
          </div>

          <div className="mint-modern__balance-wrap">
            <div className="mint-modern__balance">
              <img src="/USDT_BEP20.png" alt="" className="mint-modern__balance-icon" aria-hidden="true" />
              <span className="mint-modern__balance-label">Your USDT balance:</span>
              <span className="mint-modern__balance-value">
                {usdtBalanceLoading ? "…" : usdtBalance != null ? <>{usdtBalance.toFixed(2)} USDT <img src="/USDT_BEP20.png" alt="" className="usdt-logo-inline" aria-hidden="true" /></> : "—"}
              </span>
            </div>
          </div>

          <div className="mint-modern__two-steps">
            <span className="mint-modern__two-steps-intro">You&apos;ll sign 2 transactions:</span>
            <span className="mint-modern__two-steps-item">1) Approve USDT</span>
            <span className="mint-modern__two-steps-item">2) Pay (Mint)</span>
          </div>
          {configLoadError ? <p className="profile-modern__error mint-modern__error">{configLoadError}</p> : null}
          {error && <p className="profile-modern__error mint-modern__error">{error}</p>}
          <button
            type="button"
            className="profile-modern__submit mint-modern__submit"
            onClick={handleMint}
            disabled={loading || !hasMintPrice}
          >
            {loading
              ? (mintStep === "approve" ? "1/2 Approving USDT…" : "2/2 Minting…")
              : `Mint Asset · ${displayPrice}`}
          </button>
        </div>
      </main>

      <div className="profile-modern__panel-howto-wrap">
        <div className="profile-modern__panel-howto">
          <h3 className="profile-modern__panel-howto-title">What you get</h3>
          <ul className="profile-modern__panel-howto-list">
            <li>Mint cost: {displayPrice} → Reserve Pool</li>
            <li>Full access to Marketplace: buy, sell, trade</li>
            <li>Referral rewards and dashboard</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
