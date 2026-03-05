import { useCallback, useEffect, useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";
import { formatUnits, isAddress, parseUnits } from "viem";

const CONTRACTS = {
  subscription: (import.meta.env.VITE_SUBSCRIPTION_CONTRACT_ADDRESS || "").trim(),
  nft: (import.meta.env.VITE_NFT_CONTRACT_ADDRESS || "").trim(),
  marketplace: (import.meta.env.VITE_MARKETPLACE_CONTRACT_ADDRESS || "").trim(),
  referral: (import.meta.env.VITE_REFERRAL_CONTRACT_ADDRESS || "").trim(),
};

const SUBSCRIPTION_ABI = [
  { type: "function", name: "subscriptionPrice", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "inactivityDays", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "profitThreshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "setSubscriptionPrice", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  { type: "function", name: "setInactivityDays", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  { type: "function", name: "setProfitThreshold", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  { type: "function", name: "setBotTrader", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "bool" }], outputs: [] },
];

const REFERRAL_ABI = [
  { type: "function", name: "referralBpsTotal", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "levelBps", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "setReferralBpsTotal", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  { type: "function", name: "setAllLevelBps", stateMutability: "nonpayable", inputs: [{ type: "uint256[5]" }], outputs: [] },
];

const MARKETPLACE_ABI = [
  { type: "function", name: "creatorWallet", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "CREATOR_BPS", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "FIRST_SALE_PRICE", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "LATER_SALE_PRICE", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "setCreatorWallet", stateMutability: "nonpayable", inputs: [{ type: "address" }], outputs: [] },
  { type: "function", name: "setBotTrader", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "bool" }], outputs: [] },
];

const NFT_ABI = [
  { type: "function", name: "MINT_PRICE", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];

export default function ContractsPage({ connectedWallet }) {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [loading, setLoading] = useState(false);
  const [txPending, setTxPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [state, setState] = useState({
    subscriptionPrice: "",
    inactivityDays: "",
    profitThreshold: "",
    referralBpsTotal: "",
    levelBps: ["", "", "", "", ""],
    creatorWallet: "",
    creatorBps: "",
    firstSalePrice: "",
    laterSalePrice: "",
    mintPrice: "",
  });

  const [form, setForm] = useState({
    subscriptionPrice: "",
    inactivityDays: "",
    profitThreshold: "",
    referralBpsTotal: "",
    levelBps: ["", "", "", "", ""],
    creatorWallet: "",
  });
  const [botWalletInput, setBotWalletInput] = useState("");

  const validateContracts = useCallback(() => {
    if (!isAddress(CONTRACTS.subscription) || !isAddress(CONTRACTS.referral) || !isAddress(CONTRACTS.marketplace) || !isAddress(CONTRACTS.nft)) {
      throw new Error("Set all contract addresses in admin .env");
    }
  }, []);

  const loadData = useCallback(async () => {
    if (!publicClient) return;
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      validateContracts();
      const [subscriptionPrice, inactivityDays, profitThreshold] = await Promise.all([
        publicClient.readContract({ address: CONTRACTS.subscription, abi: SUBSCRIPTION_ABI, functionName: "subscriptionPrice" }),
        publicClient.readContract({ address: CONTRACTS.subscription, abi: SUBSCRIPTION_ABI, functionName: "inactivityDays" }),
        publicClient.readContract({ address: CONTRACTS.subscription, abi: SUBSCRIPTION_ABI, functionName: "profitThreshold" }),
      ]);

      const [referralBpsTotal, l1, l2, l3, l4, l5] = await Promise.all([
        publicClient.readContract({ address: CONTRACTS.referral, abi: REFERRAL_ABI, functionName: "referralBpsTotal" }),
        publicClient.readContract({ address: CONTRACTS.referral, abi: REFERRAL_ABI, functionName: "levelBps", args: [0n] }),
        publicClient.readContract({ address: CONTRACTS.referral, abi: REFERRAL_ABI, functionName: "levelBps", args: [1n] }),
        publicClient.readContract({ address: CONTRACTS.referral, abi: REFERRAL_ABI, functionName: "levelBps", args: [2n] }),
        publicClient.readContract({ address: CONTRACTS.referral, abi: REFERRAL_ABI, functionName: "levelBps", args: [3n] }),
        publicClient.readContract({ address: CONTRACTS.referral, abi: REFERRAL_ABI, functionName: "levelBps", args: [4n] }),
      ]);

      const [creatorWallet, creatorBps, firstSalePrice, laterSalePrice, mintPrice] = await Promise.all([
        publicClient.readContract({ address: CONTRACTS.marketplace, abi: MARKETPLACE_ABI, functionName: "creatorWallet" }),
        publicClient.readContract({ address: CONTRACTS.marketplace, abi: MARKETPLACE_ABI, functionName: "CREATOR_BPS" }),
        publicClient.readContract({ address: CONTRACTS.marketplace, abi: MARKETPLACE_ABI, functionName: "FIRST_SALE_PRICE" }),
        publicClient.readContract({ address: CONTRACTS.marketplace, abi: MARKETPLACE_ABI, functionName: "LATER_SALE_PRICE" }),
        publicClient.readContract({ address: CONTRACTS.nft, abi: NFT_ABI, functionName: "MINT_PRICE" }),
      ]);

      const nextState = {
        subscriptionPrice: formatUnits(subscriptionPrice, 6),
        inactivityDays: String(inactivityDays),
        profitThreshold: formatUnits(profitThreshold, 6),
        referralBpsTotal: String(referralBpsTotal),
        levelBps: [String(l1), String(l2), String(l3), String(l4), String(l5)],
        creatorWallet,
        creatorBps: String(creatorBps),
        firstSalePrice: formatUnits(firstSalePrice, 6),
        laterSalePrice: formatUnits(laterSalePrice, 6),
        mintPrice: formatUnits(mintPrice, 6),
      };
      setState(nextState);
      setForm({
        subscriptionPrice: nextState.subscriptionPrice,
        inactivityDays: nextState.inactivityDays,
        profitThreshold: nextState.profitThreshold,
        referralBpsTotal: nextState.referralBpsTotal,
        levelBps: [...nextState.levelBps],
        creatorWallet: nextState.creatorWallet,
      });
    } catch (e) {
      setError(e?.shortMessage || e?.message || "Failed to read contracts");
    } finally {
      setLoading(false);
    }
  }, [publicClient, validateContracts]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const runTx = async ({ address, abi, functionName, args, message }) => {
    if (!walletClient || !connectedWallet) throw new Error("Connect admin wallet first");
    setTxPending(true);
    setError("");
    setSuccess("");
    try {
      validateContracts();
      const hash = await walletClient.writeContract({
        account: connectedWallet,
        address,
        abi,
        functionName,
        args,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setSuccess(message);
      await loadData();
    } finally {
      setTxPending(false);
    }
  };

  const setBotWhitelist = async (enabled) => {
    if (!walletClient || !connectedWallet) {
      setError("Connect admin wallet first");
      return;
    }
    const botWallet = (botWalletInput || "").trim();
    if (!isAddress(botWallet)) {
      setError("Enter valid bot wallet address");
      return;
    }

    setTxPending(true);
    setError("");
    setSuccess("");
    try {
      validateContracts();
      const txs = [
        { address: CONTRACTS.subscription, abi: SUBSCRIPTION_ABI, fn: "setBotTrader" },
        { address: CONTRACTS.marketplace, abi: MARKETPLACE_ABI, fn: "setBotTrader" },
      ];
      for (const tx of txs) {
        const hash = await walletClient.writeContract({
          account: connectedWallet,
          address: tx.address,
          abi: tx.abi,
          functionName: tx.fn,
          args: [botWallet, enabled],
        });
        await publicClient.waitForTransactionReceipt({ hash });
      }
      setSuccess(`Bot wallet ${enabled ? "added" : "removed"} in Subscription and Marketplace contracts.`);
      setBotWalletInput("");
      await loadData();
    } catch (e) {
      setError(e?.shortMessage || e?.message || "Bot whitelist transaction failed");
    } finally {
      setTxPending(false);
    }
  };

  return (
    <section className="section">
      <div className="section__row">
        <h2 className="section__title">Contracts Setup (Live On-Chain)</h2>
        <button type="button" className="btn btn--ghost" onClick={loadData} disabled={loading || txPending}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <p className="section__empty">Updates here call real contract functions with your connected admin wallet.</p>
      {error && <p className="section__error">{error}</p>}
      {success && <p className="section__success">{success}</p>}

      <div className="form-grid">
        <div className="contract-card">
          <h3 className="section__subtitle">Subscription</h3>
          <p className="section__empty">Address: {CONTRACTS.subscription || "Missing"}</p>
          <label className="form-field">
            <span>Current / New price (USDT)</span>
            <input
              type="text"
              value={form.subscriptionPrice}
              onChange={(e) => setForm((prev) => ({ ...prev, subscriptionPrice: e.target.value }))}
            />
          </label>
          <button
            type="button"
            className="btn btn--success"
            disabled={txPending}
            onClick={() =>
              runTx({
                address: CONTRACTS.subscription,
                abi: SUBSCRIPTION_ABI,
                functionName: "setSubscriptionPrice",
                args: [parseUnits(form.subscriptionPrice || "0", 6)],
                message: "Subscription price updated on-chain.",
              }).catch((e) => setError(e?.shortMessage || e?.message || "Transaction failed"))
            }
          >
            Set Subscription Price
          </button>

          <label className="form-field">
            <span>Current / New inactivity days</span>
            <input
              type="text"
              value={form.inactivityDays}
              onChange={(e) => setForm((prev) => ({ ...prev, inactivityDays: e.target.value }))}
            />
          </label>
          <button
            type="button"
            className="btn btn--success"
            disabled={txPending}
            onClick={() =>
              runTx({
                address: CONTRACTS.subscription,
                abi: SUBSCRIPTION_ABI,
                functionName: "setInactivityDays",
                args: [BigInt(form.inactivityDays || "0")],
                message: "Inactivity days updated on-chain.",
              }).catch((e) => setError(e?.shortMessage || e?.message || "Transaction failed"))
            }
          >
            Set Inactivity Days
          </button>

          <label className="form-field">
            <span>Current / New profit threshold (USDT)</span>
            <input
              type="text"
              value={form.profitThreshold}
              onChange={(e) => setForm((prev) => ({ ...prev, profitThreshold: e.target.value }))}
            />
          </label>
          <button
            type="button"
            className="btn btn--success"
            disabled={txPending}
            onClick={() =>
              runTx({
                address: CONTRACTS.subscription,
                abi: SUBSCRIPTION_ABI,
                functionName: "setProfitThreshold",
                args: [parseUnits(form.profitThreshold || "0", 6)],
                message: "Profit threshold updated on-chain.",
              }).catch((e) => setError(e?.shortMessage || e?.message || "Transaction failed"))
            }
          >
            Set Profit Threshold
          </button>
        </div>

        <div className="contract-card">
          <h3 className="section__subtitle">Referral</h3>
          <p className="section__empty">Address: {CONTRACTS.referral || "Missing"}</p>
          <label className="form-field">
            <span>Total referral bps (current: {state.referralBpsTotal || "-"})</span>
            <input
              type="text"
              value={form.referralBpsTotal}
              onChange={(e) => setForm((prev) => ({ ...prev, referralBpsTotal: e.target.value }))}
            />
          </label>
          <button
            type="button"
            className="btn btn--success"
            disabled={txPending}
            onClick={() =>
              runTx({
                address: CONTRACTS.referral,
                abi: REFERRAL_ABI,
                functionName: "setReferralBpsTotal",
                args: [BigInt(form.referralBpsTotal || "0")],
                message: "Referral total bps updated on-chain.",
              }).catch((e) => setError(e?.shortMessage || e?.message || "Transaction failed"))
            }
          >
            Set Total Referral Bps
          </button>

          <p className="section__empty">L1-L5 bps current: {state.levelBps.join(", ")}</p>
          {form.levelBps.map((value, idx) => (
            <label key={String(idx)} className="form-field">
              <span>L{idx + 1} bps</span>
              <input
                type="text"
                value={value}
                onChange={(e) =>
                  setForm((prev) => {
                    const next = [...prev.levelBps];
                    next[idx] = e.target.value;
                    return { ...prev, levelBps: next };
                  })
                }
              />
            </label>
          ))}
          <button
            type="button"
            className="btn btn--success"
            disabled={txPending}
            onClick={() =>
              runTx({
                address: CONTRACTS.referral,
                abi: REFERRAL_ABI,
                functionName: "setAllLevelBps",
                args: [form.levelBps.map((v) => BigInt(v || "0"))],
                message: "Referral levels updated on-chain.",
              }).catch((e) => setError(e?.shortMessage || e?.message || "Transaction failed"))
            }
          >
            Set L1-L5 Bps
          </button>
        </div>

        <div className="contract-card">
          <h3 className="section__subtitle">Marketplace</h3>
          <p className="section__empty">Address: {CONTRACTS.marketplace || "Missing"}</p>
          <label className="form-field">
            <span>Creator wallet (current)</span>
            <input
              type="text"
              value={form.creatorWallet}
              onChange={(e) => setForm((prev) => ({ ...prev, creatorWallet: e.target.value }))}
            />
          </label>
          <button
            type="button"
            className="btn btn--success"
            disabled={txPending}
            onClick={() =>
              runTx({
                address: CONTRACTS.marketplace,
                abi: MARKETPLACE_ABI,
                functionName: "setCreatorWallet",
                args: [form.creatorWallet],
                message: "Creator wallet updated on-chain.",
              }).catch((e) => setError(e?.shortMessage || e?.message || "Transaction failed"))
            }
          >
            Set Creator Wallet
          </button>
          <p className="section__empty">Creator fee (fixed in contract): {state.creatorBps || "-"} bps</p>
          <p className="section__empty">First sale price (fixed): {state.firstSalePrice || "-"} USDT</p>
          <p className="section__empty">Later sale price (fixed): {state.laterSalePrice || "-"} USDT</p>
        </div>

        <div className="contract-card">
          <h3 className="section__subtitle">NFT</h3>
          <p className="section__empty">Address: {CONTRACTS.nft || "Missing"}</p>
          <p className="section__empty">Mint price (fixed in contract): {state.mintPrice || "-"} USDT</p>
          <p className="section__empty">This value is constant in current contract and cannot be changed without contract update/redeploy.</p>
        </div>

        <div className="contract-card">
          <h3 className="section__subtitle">Bot Whitelist (Bypass)</h3>
          <p className="section__empty">Adds/removes bot wallet in Subscription and Marketplace contracts for bypass flow.</p>
          <label className="form-field">
            <span>Bot wallet address</span>
            <input
              type="text"
              value={botWalletInput}
              onChange={(e) => setBotWalletInput(e.target.value)}
              placeholder="0x..."
            />
          </label>
          <div className="section__actions">
            <button
              type="button"
              className="btn btn--success"
              disabled={txPending}
              onClick={() => setBotWhitelist(true)}
            >
              Add Bot
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={txPending}
              onClick={() => setBotWhitelist(false)}
            >
              Remove Bot
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
