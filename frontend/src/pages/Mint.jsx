import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { useAccount, useBalance, useDisconnect, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { formatEther, formatUnits, parseUnits } from "viem";
import { useAuth } from "../hooks/useAuth";
import { useWalletConnect } from "../hooks/useWalletConnect";
import { API, ASSET_IMAGE } from "../config";
import { detectInsufficientBalanceType, getTransactionErrorMessage } from "../utils/transactionError";
import InsufficientBalanceModal from "../components/InsufficientBalanceModal";

const USDT_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
];
const NFT_ABI = [
  { name: "mint", type: "function", stateMutability: "nonpayable", inputs: [{ name: "uri", type: "string" }], outputs: [] },
  { name: "nextTokenId", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "totalMinted", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];

const MINT_PRICE_USDT = parseUnits("10", 6);
const EXPLORER_BY_CHAIN = {
  1: "https://etherscan.io",
  56: "https://bscscan.com",
  97: "https://testnet.bscscan.com",
  137: "https://polygonscan.com",
  8453: "https://basescan.org",
};

export default function Mint() {
  const { token, refreshUser, user } = useAuth();
  const navigate = useNavigate();
  const { openModal, isConnected, address } = useWalletConnect();
  const { chainId } = useAccount();
  const { data: balanceData } = useBalance({ address: address ?? undefined });
  const { disconnect: disconnectWallet } = useDisconnect();
  const [loading, setLoading] = useState(false);
  const [mintStep, setMintStep] = useState(null);
  const [error, setError] = useState("");
  const [insufficientBalanceType, setInsufficientBalanceType] = useState(null);
  const [config, setConfig] = useState({
    priceFormatted: "10 USDT",
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
  const [copied, setCopied] = useState(false);
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
  });
  const { data: totalMinted } = useReadContract({
    address: nftAddressNormalized || undefined,
    abi: NFT_ABI,
    functionName: "totalMinted",
  });
  const { data: usdtBalanceRaw, isLoading: usdtBalanceLoading, refetch: refetchUsdtBalance } = useReadContract({
    address: usdtAddressNormalized || undefined,
    abi: USDT_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    ...(chainId != null && { chainId }),
  });
  const usdtBalance = usdtBalanceRaw != null ? Number(formatUnits(usdtBalanceRaw, 6)) : null;
  const bnbBalanceFormatted = balanceData?.value != null ? Number(formatEther(balanceData.value)).toFixed(4) : null;

  useEffect(() => setPortalReady(true), []);
  useEffect(() => {
    fetch(`${API}/mint/config`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((c) => setConfig((prev) => ({ ...prev, ...c })))
      .catch(() => {});
  }, [token]);

  // Already minted → go to dashboard (don't stay on mint page)
  useEffect(() => {
    if (user?.state === "MINTED" || user?.state === "ACTIVE_TRADER") {
      navigate("/dashboard", { replace: true });
    }
  }, [user?.state, navigate]);

  const displayAddress = address || (token && user?.wallet ? user.wallet : null) || null;
  const explorerUrl = chainId && EXPLORER_BY_CHAIN[chainId] && displayAddress
    ? `${EXPLORER_BY_CHAIN[chainId]}/address/${displayAddress}`
    : null;

  const handleConnect = () => { if (openModal) openModal(); };
  const handleDisconnect = () => {
    setAddressMenuOpen(false);
    disconnectWallet();
    navigate("/", { replace: true });
  };
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
      const hashApprove = await writeContractAsync({
        address: usdtAddressNormalized,
        abi: USDT_ABI,
        functionName: "approve",
        args: [nftAddr, MINT_PRICE_USDT],
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
      navigate("/dashboard");
    } catch (e) {
      const insufficientType = detectInsufficientBalanceType(e);
      if (insufficientType) {
        setInsufficientBalanceType(insufficientType);
        if (insufficientType === "usdt") refetchUsdtBalance?.();
        setError("");
      } else {
        setError(getTransactionErrorMessage(e, "Mint failed"));
      }
    } finally {
      setLoading(false);
      setMintStep(null);
    }
  };

  const displayPrice = (config.priceFormatted || "10 USDT").replace(/^\$+\s*/, "").trim() || "10 USDT";
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
        <Link to="/" className="landing-v2__logo">Golden Labs</Link>
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
          {error && <p className="profile-modern__error mint-modern__error">{error}</p>}
          <button
            type="button"
            className="profile-modern__submit mint-modern__submit"
            onClick={handleMint}
            disabled={loading}
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
            <li>Mint cost: 10 USDT → Reserve Pool</li>
            <li>Full access to Marketplace: buy, sell, trade</li>
            <li>Referral rewards and dashboard</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
