import { useCallback, useEffect, useState } from "react";
import { useWalletClient } from "wagmi";
import { createPublicClient, formatUnits, http, isAddress, parseUnits } from "viem";
import { bsc } from "viem/chains";

const USDT_DECIMALS = Number(import.meta.env.VITE_USDT_DECIMALS || 18) || 18;

const readRpcUrl =
  import.meta.env.VITE_BSC_RPC_URL || "https://bsc-dataseed.binance.org/";

/** Dedicated RPC client for reads — avoids `usePublicClient()` being undefined before the wallet session is ready. */
const readPublicClient = createPublicClient({
  chain: bsc,
  transport: http(readRpcUrl),
});

const CONTRACTS = {
  subscription: (import.meta.env.VITE_SUBSCRIPTION_CONTRACT_ADDRESS || "").trim(),
  nft: (import.meta.env.VITE_NFT_CONTRACT_ADDRESS || "").trim(),
  marketplace: (
    import.meta.env.VITE_MARKETPLACE_AND_RESERVE_POOL_CONTRACT_ADDRESS ||
    import.meta.env.VITE_MARKETPLACE_CONTRACT_ADDRESS ||
    ""
  ).trim(),
  referral: (import.meta.env.VITE_REFERRAL_CONTRACT_ADDRESS || "").trim(),
};

const SUBSCRIPTION_ABI = [
  { type: "function", name: "subscriptionPrice", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "subscriptionReserveAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "subscriptionCreatorAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "subscriptionBotAAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "subscriptionBotBAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "inactivityDays", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "profitThreshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "setSubscriptionPrice", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  {
    type: "function",
    name: "setSubscriptionSplitAmounts",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    outputs: [],
  },
  { type: "function", name: "setInactivityDays", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  { type: "function", name: "setProfitThreshold", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  { type: "function", name: "setBotTrader", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "bool" }], outputs: [] },
];

const REFERRAL_ABI = [
  { type: "function", name: "referralTotalAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "referralWithdrawChunk", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "levelAmounts", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "minDirectReferralsRequired", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "setReferralTotalAmount", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  { type: "function", name: "setReferralWithdrawChunk", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  { type: "function", name: "setAllLevelAmounts", stateMutability: "nonpayable", inputs: [{ type: "uint256[10]" }], outputs: [] },
  {
    type: "function",
    name: "setAllMinDirectReferralRequirements",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256[10]" }],
    outputs: [],
  },
];

const MARKETPLACE_ABI = [
  { type: "function", name: "creatorWallet", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "botAWallet", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "botBWallet", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "listPrice", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "tradingIncomeAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "referralTotalAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "creatorAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "botAAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "botBAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getBalance", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "dynamicMintEnabled", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "dynamicMintStartThreshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "dynamicMintStopThreshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "setCreatorWallet", stateMutability: "nonpayable", inputs: [{ type: "address" }], outputs: [] },
  { type: "function", name: "setBotWallets", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "address" }], outputs: [] },
  {
    type: "function",
    name: "setTradeConfig",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    outputs: [],
  },
  { type: "function", name: "withdrawReserveUSDT", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }, { type: "string" }], outputs: [] },
  { type: "function", name: "setDynamicMintConfig", stateMutability: "nonpayable", inputs: [{ type: "bool" }, { type: "uint256" }, { type: "uint256" }], outputs: [] },
  { type: "function", name: "runDynamicMintIfNeeded", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "setBotTrader", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "bool" }], outputs: [] },
];

const NFT_ABI = [
  { type: "function", name: "mintPrice", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxWalletHoldings", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "dynamicMintBatchSize", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "setMintPrice", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  { type: "function", name: "setMaxWalletHoldings", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  { type: "function", name: "setDynamicMintBatchSize", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
];

export default function ContractsPage({ connectedWallet }) {
  const { data: walletClient } = useWalletClient();

  const [loading, setLoading] = useState(false);
  const [txPending, setTxPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [state, setState] = useState({
    subscriptionPrice: "",
    subscriptionReserveAmount: "",
    subscriptionCreatorAmount: "",
    subscriptionBotAAmount: "",
    subscriptionBotBAmount: "",
    inactivityDays: "",
    profitThreshold: "",
    referralTotalAmountOnChain: "",
    referralWithdrawChunkOnChain: "",
    levelAmounts: ["", "", "", "", "", "", "", "", "", ""],
    minDirectReferralsOnChain: ["", "", "", "", "", "", "", "", "", ""],
    creatorWallet: "",
    botAWallet: "",
    botBWallet: "",
    listPrice: "",
    tradingIncomeAmount: "",
    referralTotalAmount: "",
    creatorAmount: "",
    botAAmount: "",
    botBAmount: "",
    reserveBalance: "",
    dynamicMintEnabled: false,
    dynamicMintStartThreshold: "",
    dynamicMintStopThreshold: "",
    mintPrice: "",
    maxWalletHoldings: "",
    dynamicMintBatchSize: "",
  });

  const [form, setForm] = useState({
    subscriptionPrice: "",
    subscriptionReserveAmount: "",
    subscriptionCreatorAmount: "",
    subscriptionBotAAmount: "",
    subscriptionBotBAmount: "",
    inactivityDays: "",
    profitThreshold: "",
    referralTotalAmountOnChain: "",
    referralWithdrawChunk: "",
    levelAmounts: ["", "", "", "", "", "", "", "", "", ""],
    minDirectReferrals: ["", "", "", "", "", "", "", "", "", ""],
    creatorWallet: "",
    botAWallet: "",
    botBWallet: "",
    listPrice: "",
    tradingIncomeAmount: "",
    referralTotalAmount: "",
    creatorAmount: "",
    botAAmount: "",
    botBAmount: "",
    reserveWithdrawTo: "",
    reserveWithdrawAmount: "",
    reserveWithdrawReason: "reserve_admin_withdraw",
    dynamicMintEnabled: false,
    dynamicMintStartThreshold: "",
    dynamicMintStopThreshold: "",
    mintPrice: "",
    maxWalletHoldings: "",
    dynamicMintBatchSize: "",
  });
  const [botWalletInput, setBotWalletInput] = useState("");

  const validateContracts = useCallback(() => {
    if (!isAddress(CONTRACTS.subscription) || !isAddress(CONTRACTS.referral) || !isAddress(CONTRACTS.marketplace) || !isAddress(CONTRACTS.nft)) {
      throw new Error("Set all contract addresses in admin .env");
    }
  }, []);

  const loadData = useCallback(async () => {
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      validateContracts();
      const [subscriptionPrice, subscriptionReserveAmount, subscriptionCreatorAmount, subscriptionBotAAmount, subscriptionBotBAmount, inactivityDays, profitThreshold] = await Promise.all([
        readPublicClient.readContract({ address: CONTRACTS.subscription, abi: SUBSCRIPTION_ABI, functionName: "subscriptionPrice" }),
        readPublicClient.readContract({ address: CONTRACTS.subscription, abi: SUBSCRIPTION_ABI, functionName: "subscriptionReserveAmount" }),
        readPublicClient.readContract({ address: CONTRACTS.subscription, abi: SUBSCRIPTION_ABI, functionName: "subscriptionCreatorAmount" }),
        readPublicClient.readContract({ address: CONTRACTS.subscription, abi: SUBSCRIPTION_ABI, functionName: "subscriptionBotAAmount" }),
        readPublicClient.readContract({ address: CONTRACTS.subscription, abi: SUBSCRIPTION_ABI, functionName: "subscriptionBotBAmount" }),
        readPublicClient.readContract({ address: CONTRACTS.subscription, abi: SUBSCRIPTION_ABI, functionName: "inactivityDays" }),
        readPublicClient.readContract({ address: CONTRACTS.subscription, abi: SUBSCRIPTION_ABI, functionName: "profitThreshold" }),
      ]);

      const referralReads = [
        readPublicClient.readContract({ address: CONTRACTS.referral, abi: REFERRAL_ABI, functionName: "referralTotalAmount" }),
        readPublicClient.readContract({ address: CONTRACTS.referral, abi: REFERRAL_ABI, functionName: "referralWithdrawChunk" }),
      ];
      for (let i = 0; i < 10; i++) {
        referralReads.push(
          readPublicClient.readContract({ address: CONTRACTS.referral, abi: REFERRAL_ABI, functionName: "levelAmounts", args: [BigInt(i)] })
        );
      }
      for (let i = 0; i < 10; i++) {
        referralReads.push(
          readPublicClient.readContract({
            address: CONTRACTS.referral,
            abi: REFERRAL_ABI,
            functionName: "minDirectReferralsRequired",
            args: [BigInt(i)],
          })
        );
      }
      const referralResults = await Promise.all(referralReads);
      const referralTotalAmountOnChain = referralResults[0];
      const referralWithdrawChunkOnChainRaw = referralResults[1];
      const levelAmountNums = referralResults.slice(2, 12);
      const minDirectNums = referralResults.slice(12, 22);

      const [creatorWallet, botAWallet, botBWallet, listPrice, tradingIncomeAmount, referralTotalAmount, creatorAmount, botAAmount, botBAmount, reserveBalance, dynamicMintEnabled, dynamicMintStartThreshold, dynamicMintStopThreshold, mintPrice, maxWalletHoldings, dynamicMintBatchSize] = await Promise.all([
        readPublicClient.readContract({ address: CONTRACTS.marketplace, abi: MARKETPLACE_ABI, functionName: "creatorWallet" }),
        readPublicClient.readContract({ address: CONTRACTS.marketplace, abi: MARKETPLACE_ABI, functionName: "botAWallet" }),
        readPublicClient.readContract({ address: CONTRACTS.marketplace, abi: MARKETPLACE_ABI, functionName: "botBWallet" }),
        readPublicClient.readContract({ address: CONTRACTS.marketplace, abi: MARKETPLACE_ABI, functionName: "listPrice" }),
        readPublicClient.readContract({ address: CONTRACTS.marketplace, abi: MARKETPLACE_ABI, functionName: "tradingIncomeAmount" }),
        readPublicClient.readContract({ address: CONTRACTS.marketplace, abi: MARKETPLACE_ABI, functionName: "referralTotalAmount" }),
        readPublicClient.readContract({ address: CONTRACTS.marketplace, abi: MARKETPLACE_ABI, functionName: "creatorAmount" }),
        readPublicClient.readContract({ address: CONTRACTS.marketplace, abi: MARKETPLACE_ABI, functionName: "botAAmount" }),
        readPublicClient.readContract({ address: CONTRACTS.marketplace, abi: MARKETPLACE_ABI, functionName: "botBAmount" }),
        readPublicClient.readContract({ address: CONTRACTS.marketplace, abi: MARKETPLACE_ABI, functionName: "getBalance" }),
        readPublicClient.readContract({ address: CONTRACTS.marketplace, abi: MARKETPLACE_ABI, functionName: "dynamicMintEnabled" }),
        readPublicClient.readContract({ address: CONTRACTS.marketplace, abi: MARKETPLACE_ABI, functionName: "dynamicMintStartThreshold" }),
        readPublicClient.readContract({ address: CONTRACTS.marketplace, abi: MARKETPLACE_ABI, functionName: "dynamicMintStopThreshold" }),
        readPublicClient.readContract({ address: CONTRACTS.nft, abi: NFT_ABI, functionName: "mintPrice" }),
        readPublicClient.readContract({ address: CONTRACTS.nft, abi: NFT_ABI, functionName: "maxWalletHoldings" }),
        readPublicClient.readContract({ address: CONTRACTS.nft, abi: NFT_ABI, functionName: "dynamicMintBatchSize" }),
      ]);

      const nextState = {
        subscriptionPrice: formatUnits(subscriptionPrice, USDT_DECIMALS),
        subscriptionReserveAmount: formatUnits(subscriptionReserveAmount, USDT_DECIMALS),
        subscriptionCreatorAmount: formatUnits(subscriptionCreatorAmount, USDT_DECIMALS),
        subscriptionBotAAmount: formatUnits(subscriptionBotAAmount, USDT_DECIMALS),
        subscriptionBotBAmount: formatUnits(subscriptionBotBAmount, USDT_DECIMALS),
        inactivityDays: String(inactivityDays),
        profitThreshold: formatUnits(profitThreshold, USDT_DECIMALS),
        referralTotalAmountOnChain: formatUnits(referralTotalAmountOnChain, USDT_DECIMALS),
        referralWithdrawChunkOnChain: formatUnits(referralWithdrawChunkOnChainRaw, USDT_DECIMALS),
        levelAmounts: levelAmountNums.map((x) => formatUnits(x, USDT_DECIMALS)),
        minDirectReferralsOnChain: minDirectNums.map((x) => String(x)),
        creatorWallet,
        botAWallet,
        botBWallet,
        listPrice: formatUnits(listPrice, USDT_DECIMALS),
        tradingIncomeAmount: formatUnits(tradingIncomeAmount, USDT_DECIMALS),
        referralTotalAmount: formatUnits(referralTotalAmount, USDT_DECIMALS),
        creatorAmount: formatUnits(creatorAmount, USDT_DECIMALS),
        botAAmount: formatUnits(botAAmount, USDT_DECIMALS),
        botBAmount: formatUnits(botBAmount, USDT_DECIMALS),
        reserveBalance: formatUnits(reserveBalance, USDT_DECIMALS),
        dynamicMintEnabled,
        dynamicMintStartThreshold: formatUnits(dynamicMintStartThreshold, USDT_DECIMALS),
        dynamicMintStopThreshold: formatUnits(dynamicMintStopThreshold, USDT_DECIMALS),
        mintPrice: formatUnits(mintPrice, USDT_DECIMALS),
        maxWalletHoldings: String(maxWalletHoldings),
        dynamicMintBatchSize: String(dynamicMintBatchSize),
      };
      setState(nextState);
      setForm({
        subscriptionPrice: nextState.subscriptionPrice,
        subscriptionReserveAmount: nextState.subscriptionReserveAmount,
        subscriptionCreatorAmount: nextState.subscriptionCreatorAmount,
        subscriptionBotAAmount: nextState.subscriptionBotAAmount,
        subscriptionBotBAmount: nextState.subscriptionBotBAmount,
        inactivityDays: nextState.inactivityDays,
        profitThreshold: nextState.profitThreshold,
        referralTotalAmountOnChain: nextState.referralTotalAmountOnChain,
        referralWithdrawChunk: nextState.referralWithdrawChunkOnChain,
        levelAmounts: [...nextState.levelAmounts],
        minDirectReferrals: [...nextState.minDirectReferralsOnChain],
        creatorWallet: nextState.creatorWallet,
        botAWallet: nextState.botAWallet,
        botBWallet: nextState.botBWallet,
        listPrice: nextState.listPrice,
        tradingIncomeAmount: nextState.tradingIncomeAmount,
        referralTotalAmount: nextState.referralTotalAmount,
        creatorAmount: nextState.creatorAmount,
        botAAmount: nextState.botAAmount,
        botBAmount: nextState.botBAmount,
        reserveWithdrawTo: nextState.creatorWallet,
        reserveWithdrawAmount: "",
        reserveWithdrawReason: "reserve_admin_withdraw",
        dynamicMintEnabled: Boolean(nextState.dynamicMintEnabled),
        dynamicMintStartThreshold: nextState.dynamicMintStartThreshold,
        dynamicMintStopThreshold: nextState.dynamicMintStopThreshold,
        mintPrice: nextState.mintPrice,
        maxWalletHoldings: nextState.maxWalletHoldings,
        dynamicMintBatchSize: nextState.dynamicMintBatchSize,
      });
    } catch (e) {
      setError(e?.shortMessage || e?.message || "Failed to read contracts");
    } finally {
      setLoading(false);
    }
  }, [validateContracts]);

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
      await readPublicClient.waitForTransactionReceipt({ hash });
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
        await readPublicClient.waitForTransactionReceipt({ hash });
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

      <p className="section__empty">
        Live values are read via RPC on {bsc.name} (chain 56). Match <code>VITE_*_CONTRACT_*</code> addresses to your deployment; connect your wallet to BNB Smart Chain before sending transactions.
      </p>
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
                args: [parseUnits(form.subscriptionPrice || "0", USDT_DECIMALS)],
                message: "Subscription price updated on-chain.",
              }).catch((e) => setError(e?.shortMessage || e?.message || "Transaction failed"))
            }
          >
            Set Subscription Price
          </button>

          <p className="section__empty">
            Split now (USDT): reserve {state.subscriptionReserveAmount || "-"}, creator {state.subscriptionCreatorAmount || "-"}, botA {state.subscriptionBotAAmount || "-"}, botB {state.subscriptionBotBAmount || "-"}
          </p>
          <label className="form-field">
            <span>Reserve amount (USDT)</span>
            <input
              type="text"
              value={form.subscriptionReserveAmount}
              onChange={(e) => setForm((prev) => ({ ...prev, subscriptionReserveAmount: e.target.value }))}
            />
          </label>
          <label className="form-field">
            <span>Creator amount (USDT)</span>
            <input
              type="text"
              value={form.subscriptionCreatorAmount}
              onChange={(e) => setForm((prev) => ({ ...prev, subscriptionCreatorAmount: e.target.value }))}
            />
          </label>
          <label className="form-field">
            <span>Bot A amount (USDT)</span>
            <input
              type="text"
              value={form.subscriptionBotAAmount}
              onChange={(e) => setForm((prev) => ({ ...prev, subscriptionBotAAmount: e.target.value }))}
            />
          </label>
          <label className="form-field">
            <span>Bot B amount (USDT)</span>
            <input
              type="text"
              value={form.subscriptionBotBAmount}
              onChange={(e) => setForm((prev) => ({ ...prev, subscriptionBotBAmount: e.target.value }))}
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
                functionName: "setSubscriptionSplitAmounts",
                args: [
                  parseUnits(form.subscriptionReserveAmount || "0", USDT_DECIMALS),
                  parseUnits(form.subscriptionCreatorAmount || "0", USDT_DECIMALS),
                  parseUnits(form.subscriptionBotAAmount || "0", USDT_DECIMALS),
                  parseUnits(form.subscriptionBotBAmount || "0", USDT_DECIMALS),
                ],
                message: "Subscription split amounts updated on-chain.",
              }).catch((e) => setError(e?.shortMessage || e?.message || "Transaction failed"))
            }
          >
            Set Subscription Split Amounts
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
                args: [parseUnits(form.profitThreshold || "0", USDT_DECIMALS)],
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
            <span>Total referral amount per trade (USDT) (current: {state.referralTotalAmountOnChain || "-"})</span>
            <input
              type="text"
              value={form.referralTotalAmountOnChain}
              onChange={(e) => setForm((prev) => ({ ...prev, referralTotalAmountOnChain: e.target.value }))}
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
                functionName: "setReferralTotalAmount",
                args: [parseUnits(form.referralTotalAmountOnChain || "0", USDT_DECIMALS)],
                message: "Referral total amount updated on-chain.",
              }).catch((e) => setError(e?.shortMessage || e?.message || "Transaction failed"))
            }
          >
            Set Total Referral Amount
          </button>

          <label className="form-field">
            <span>
              Referral withdraw chunk (USDT per claim; users need ≥ this claimable; each tx pays exactly this amount) (current:{" "}
              {state.referralWithdrawChunkOnChain || "-"})
            </span>
            <input
              type="text"
              value={form.referralWithdrawChunk}
              onChange={(e) => setForm((prev) => ({ ...prev, referralWithdrawChunk: e.target.value }))}
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
                functionName: "setReferralWithdrawChunk",
                args: [parseUnits(form.referralWithdrawChunk || "0", USDT_DECIMALS)],
                message: "Referral withdraw chunk updated on-chain.",
              }).catch((e) => setError(e?.shortMessage || e?.message || "Transaction failed"))
            }
          >
            Set Withdraw Chunk
          </button>

          <p className="section__empty">L1-L10 amounts current (USDT): {state.levelAmounts.join(", ")}</p>
          {form.levelAmounts.map((value, idx) => (
            <label key={String(idx)} className="form-field">
              <span>L{idx + 1} amount (USDT)</span>
              <input
                type="text"
                value={value}
                onChange={(e) =>
                  setForm((prev) => {
                    const next = [...prev.levelAmounts];
                    next[idx] = e.target.value;
                    return { ...prev, levelAmounts: next };
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
                functionName: "setAllLevelAmounts",
                args: [form.levelAmounts.map((v) => parseUnits(v || "0", USDT_DECIMALS))],
                message: "Referral level amounts updated on-chain.",
              }).catch((e) => setError(e?.shortMessage || e?.message || "Transaction failed"))
            }
          >
            Set L1-L10 Amounts
          </button>

          <p className="section__empty" style={{ marginTop: "1rem" }}>
            Min direct referrals (on <code>minDirectPass</code> per level — L1 uses P0; L2+ uses the hop below payee): current{" "}
            {state.minDirectReferralsOnChain.join(", ") || "—"}
          </p>
          {form.minDirectReferrals.map((value, idx) => (
            <label key={`minref-${String(idx)}`} className="form-field">
              <span>L{idx + 1} min directs required</span>
              <input
                type="text"
                inputMode="numeric"
                value={value}
                onChange={(e) =>
                  setForm((prev) => {
                    const next = [...prev.minDirectReferrals];
                    next[idx] = e.target.value;
                    return { ...prev, minDirectReferrals: next };
                  })
                }
              />
            </label>
          ))}
          <button
            type="button"
            className="btn btn--success"
            disabled={txPending}
            onClick={() => {
              try {
                const args = form.minDirectReferrals.map((v, idx) => {
                  const n = parseInt(String(v).trim(), 10);
                  if (!Number.isFinite(n) || n < 1 || n > 16) {
                    throw new Error(`L${idx + 1}: enter a whole number from 1 to 16 (on-chain seat band)`);
                  }
                  return BigInt(n);
                });
                return runTx({
                  address: CONTRACTS.referral,
                  abi: REFERRAL_ABI,
                  functionName: "setAllMinDirectReferralRequirements",
                  args: [args],
                  message: "Referral min direct requirements (L1–L10) updated on-chain.",
                }).catch((e) => setError(e?.shortMessage || e?.message || "Transaction failed"));
              } catch (e) {
                setError(e?.message || "Invalid min directs");
              }
            }}
          >
            Set L1–L10 min direct requirements
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
          <label className="form-field">
            <span>Bot A wallet</span>
            <input
              type="text"
              value={form.botAWallet}
              onChange={(e) => setForm((prev) => ({ ...prev, botAWallet: e.target.value }))}
            />
          </label>
          <label className="form-field">
            <span>Bot B wallet</span>
            <input
              type="text"
              value={form.botBWallet}
              onChange={(e) => setForm((prev) => ({ ...prev, botBWallet: e.target.value }))}
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
                functionName: "setBotWallets",
                args: [form.botAWallet, form.botBWallet],
                message: "Marketplace bot wallets updated on-chain.",
              }).catch((e) => setError(e?.shortMessage || e?.message || "Transaction failed"))
            }
          >
            Set Bot Wallets
          </button>
          <p className="section__empty">
            Trade config now (USDT): list {state.listPrice || "-"}, tradeIncome {state.tradingIncomeAmount || "-"}, referral {state.referralTotalAmount || "-"}, creator {state.creatorAmount || "-"}, botA {state.botAAmount || "-"}, botB {state.botBAmount || "-"}
          </p>
          <label className="form-field">
            <span>List price (USDT)</span>
            <input
              type="text"
              value={form.listPrice}
              onChange={(e) => setForm((prev) => ({ ...prev, listPrice: e.target.value }))}
            />
          </label>
          <label className="form-field">
            <span>Trading income amount (USDT)</span>
            <input
              type="text"
              value={form.tradingIncomeAmount}
              onChange={(e) => setForm((prev) => ({ ...prev, tradingIncomeAmount: e.target.value }))}
            />
          </label>
          <label className="form-field">
            <span>Referral total amount (USDT)</span>
            <input
              type="text"
              value={form.referralTotalAmount}
              onChange={(e) => setForm((prev) => ({ ...prev, referralTotalAmount: e.target.value }))}
            />
          </label>
          <label className="form-field">
            <span>Creator amount (USDT)</span>
            <input
              type="text"
              value={form.creatorAmount}
              onChange={(e) => setForm((prev) => ({ ...prev, creatorAmount: e.target.value }))}
            />
          </label>
          <label className="form-field">
            <span>Bot A amount (USDT)</span>
            <input
              type="text"
              value={form.botAAmount}
              onChange={(e) => setForm((prev) => ({ ...prev, botAAmount: e.target.value }))}
            />
          </label>
          <label className="form-field">
            <span>Bot B amount (USDT)</span>
            <input
              type="text"
              value={form.botBAmount}
              onChange={(e) => setForm((prev) => ({ ...prev, botBAmount: e.target.value }))}
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
                functionName: "setTradeConfig",
                args: [
                  parseUnits(form.listPrice || "0", USDT_DECIMALS),
                  parseUnits(form.tradingIncomeAmount || "0", USDT_DECIMALS),
                  parseUnits(form.referralTotalAmount || "0", USDT_DECIMALS),
                  parseUnits(form.creatorAmount || "0", USDT_DECIMALS),
                  parseUnits(form.botAAmount || "0", USDT_DECIMALS),
                  parseUnits(form.botBAmount || "0", USDT_DECIMALS),
                ],
                message: "Marketplace trade config updated on-chain.",
              }).catch((e) => setError(e?.shortMessage || e?.message || "Transaction failed"))
            }
          >
            Set Trade Config
          </button>
          <p className="section__empty">
            Dynamic mint engine: {state.dynamicMintEnabled ? "enabled" : "disabled"} | start {state.dynamicMintStartThreshold || "-"} USDT | stop {state.dynamicMintStopThreshold || "-"} USDT
          </p>
          <label className="form-field">
            <span>Dynamic mint enabled</span>
            <select
              value={form.dynamicMintEnabled ? "true" : "false"}
              onChange={(e) => setForm((prev) => ({ ...prev, dynamicMintEnabled: e.target.value === "true" }))}
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </label>
          <label className="form-field">
            <span>Dynamic mint start threshold (USDT)</span>
            <input
              type="text"
              value={form.dynamicMintStartThreshold}
              onChange={(e) => setForm((prev) => ({ ...prev, dynamicMintStartThreshold: e.target.value }))}
            />
          </label>
          <label className="form-field">
            <span>Dynamic mint stop threshold (USDT)</span>
            <input
              type="text"
              value={form.dynamicMintStopThreshold}
              onChange={(e) => setForm((prev) => ({ ...prev, dynamicMintStopThreshold: e.target.value }))}
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
                functionName: "setDynamicMintConfig",
                args: [
                  form.dynamicMintEnabled,
                  parseUnits(form.dynamicMintStartThreshold || "0", USDT_DECIMALS),
                  parseUnits(form.dynamicMintStopThreshold || "0", USDT_DECIMALS),
                ],
                message: "Dynamic mint config updated on-chain.",
              }).catch((e) => setError(e?.shortMessage || e?.message || "Transaction failed"))
            }
          >
            Set Dynamic Mint Config
          </button>
          <button
            type="button"
            className="btn btn--success"
            disabled={txPending}
            onClick={() =>
              runTx({
                address: CONTRACTS.marketplace,
                abi: MARKETPLACE_ABI,
                functionName: "runDynamicMintIfNeeded",
                args: [],
                message: "Manual dynamic mint trigger attempted on-chain.",
              }).catch((e) => setError(e?.shortMessage || e?.message || "Transaction failed"))
            }
          >
            Run Dynamic Mint If Needed
          </button>
          <p className="section__empty">Merged reserve balance: {state.reserveBalance || "-"} USDT</p>
          <label className="form-field">
            <span>Reserve withdraw to</span>
            <input
              type="text"
              value={form.reserveWithdrawTo}
              onChange={(e) => setForm((prev) => ({ ...prev, reserveWithdrawTo: e.target.value }))}
            />
          </label>
          <label className="form-field">
            <span>Reserve withdraw amount (USDT)</span>
            <input
              type="text"
              value={form.reserveWithdrawAmount}
              onChange={(e) => setForm((prev) => ({ ...prev, reserveWithdrawAmount: e.target.value }))}
            />
          </label>
          <label className="form-field">
            <span>Reserve withdraw reason</span>
            <input
              type="text"
              value={form.reserveWithdrawReason}
              onChange={(e) => setForm((prev) => ({ ...prev, reserveWithdrawReason: e.target.value }))}
            />
          </label>
          <button
            type="button"
            className="btn btn--danger"
            disabled={txPending}
            onClick={() =>
              runTx({
                address: CONTRACTS.marketplace,
                abi: MARKETPLACE_ABI,
                functionName: "withdrawReserveUSDT",
                args: [
                  form.reserveWithdrawTo,
                  parseUnits(form.reserveWithdrawAmount || "0", USDT_DECIMALS),
                  form.reserveWithdrawReason || "reserve_admin_withdraw",
                ],
                message: "Reserve USDT withdrawn from merged marketplace.",
              }).catch((e) => setError(e?.shortMessage || e?.message || "Transaction failed"))
            }
          >
            Withdraw Reserve USDT
          </button>
        </div>

        <div className="contract-card">
          <h3 className="section__subtitle">NFT</h3>
          <p className="section__empty">Address: {CONTRACTS.nft || "Missing"}</p>
          <p className="section__empty">Mint price (USDT): {state.mintPrice || "-"}</p>
          <label className="form-field">
            <span>Set mint price (USDT)</span>
            <input
              type="text"
              value={form.mintPrice}
              onChange={(e) => setForm((prev) => ({ ...prev, mintPrice: e.target.value }))}
            />
          </label>
          <button
            type="button"
            className="btn btn--success"
            disabled={txPending}
            onClick={() =>
              runTx({
                address: CONTRACTS.nft,
                abi: NFT_ABI,
                functionName: "setMintPrice",
                args: [parseUnits(form.mintPrice || "0", USDT_DECIMALS)],
                message: "NFT mint price updated on-chain.",
              }).catch((e) => setError(e?.shortMessage || e?.message || "Transaction failed"))
            }
          >
            Set Mint Price
          </button>
          <p className="section__empty">Max wallet holdings: {state.maxWalletHoldings || "-"}</p>
          <p className="section__empty">Dynamic mint batch size: {state.dynamicMintBatchSize || "-"}</p>
          <label className="form-field">
            <span>Set max wallet holdings</span>
            <input
              type="text"
              value={form.maxWalletHoldings}
              onChange={(e) => setForm((prev) => ({ ...prev, maxWalletHoldings: e.target.value }))}
            />
          </label>
          <button
            type="button"
            className="btn btn--success"
            disabled={txPending}
            onClick={() =>
              runTx({
                address: CONTRACTS.nft,
                abi: NFT_ABI,
                functionName: "setMaxWalletHoldings",
                args: [BigInt(form.maxWalletHoldings || "0")],
                message: "NFT max wallet holdings updated on-chain.",
              }).catch((e) => setError(e?.shortMessage || e?.message || "Transaction failed"))
            }
          >
            Set Max Wallet Holdings
          </button>
          <label className="form-field">
            <span>Set dynamic mint batch size</span>
            <input
              type="text"
              value={form.dynamicMintBatchSize}
              onChange={(e) => setForm((prev) => ({ ...prev, dynamicMintBatchSize: e.target.value }))}
            />
          </label>
          <button
            type="button"
            className="btn btn--success"
            disabled={txPending}
            onClick={() =>
              runTx({
                address: CONTRACTS.nft,
                abi: NFT_ABI,
                functionName: "setDynamicMintBatchSize",
                args: [BigInt(form.dynamicMintBatchSize || "0")],
                message: "NFT dynamic mint batch size updated on-chain.",
              }).catch((e) => setError(e?.shortMessage || e?.message || "Transaction failed"))
            }
          >
            Set Dynamic Mint Batch Size
          </button>
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
