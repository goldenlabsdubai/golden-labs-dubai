import { Router } from "express";
import { ethers } from "ethers";
import { getReferralRpcUrl, getSharedReferralRpcProvider } from "../config/ethersRpc.js";
import * as User from "../services/user.js";
import { USDT_DECIMALS } from "../constants/usdtDecimals.js";

const router = Router();

const REFERRAL_LEVELS = 10;
/** Default 10 USDT (18 decimals); must match ReferralContract unless changed on-chain */
const REFERRAL_WITHDRAW_CHUNK_WEI = process.env.REFERRAL_WITHDRAW_CHUNK_WEI || "10000000000000000000";

function sumEarningsByLevel(refUser) {
  let s = 0n;
  for (let lvl = 1; lvl <= REFERRAL_LEVELS; lvl++) {
    s += BigInt(refUser[`referralEarningsL${lvl}`] ?? "0");
  }
  return s;
}

/** L1 list + L2 children per parent (for dashboard tree). Auth: viewer only sees own downline. */
router.get("/network", async (req, res) => {
  try {
    const user = await User.getUser(req);
    if (!user?.wallet) return res.status(404).json({ error: "User not found" });
    const graph = await User.getReferralDownlineGraph(user.wallet);
    res.json(graph);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/info", async (_req, res) => {
  const withdrawChunkWei = String(REFERRAL_WITHDRAW_CHUNK_WEI || "10000000000000000000");
  let withdrawChunkUsdt = 10;
  try {
    withdrawChunkUsdt = Number(ethers.formatUnits(withdrawChunkWei, USDT_DECIMALS));
  } catch {
    withdrawChunkUsdt = 10;
  }

  const contractAddress = (process.env.REFERRAL_CONTRACT_ADDRESS || "").trim();
  const rpcUrl = getReferralRpcUrl();

  const base = {
    levels: REFERRAL_LEVELS,
    contractAddress,
    withdrawChunkWei,
    withdrawChunkUsdt,
  };

  if (!contractAddress || !rpcUrl) {
    return res.json({
      ...base,
      rate: "Set REFERRAL_CONTRACT_ADDRESS and RPC (REFERRAL_RPC_URL or RPC_URL) to load referral totals from chain.",
      referralTotalUsdt: null,
      referralTotalAmountWei: null,
      levelTiers: null,
    });
  }

  const abi = [
    "function referralTotalAmount() view returns (uint256)",
    "function levelAmounts(uint256) view returns (uint256)",
    "function minDirectReferralsRequired(uint256) view returns (uint256)",
  ];

  try {
    const provider = getSharedReferralRpcProvider();
    const c = new ethers.Contract(contractAddress, abi, provider);
    const tierReads = [];
    for (let i = 0; i < 10; i++) {
      tierReads.push(c.levelAmounts(i), c.minDirectReferralsRequired(i));
    }
    const [totalAmt, ...flat] = await Promise.all([c.referralTotalAmount(), ...tierReads]);
    const levelTiers = [];
    for (let i = 0; i < 10; i++) {
      const gross = flat[i * 2];
      const minD = flat[i * 2 + 1];
      const minBig = BigInt(minD.toString());
      const grossBig = BigInt(gross.toString());
      const div = i === 0 ? 1n : minBig > 0n ? minBig : 1n;
      const perLevelWei = i === 0 ? grossBig : grossBig / div;
      let perTradeUsdt = "0";
      try {
        perTradeUsdt = ethers.formatUnits(perLevelWei, USDT_DECIMALS).replace(/\.?0+$/, "") || "0";
      } catch {
        perTradeUsdt = "0";
      }
      levelTiers.push({
        level: i + 1,
        minDirectReferrals: Number(div),
        levelAmountWei: grossBig.toString(),
        perTradeUsdt,
      });
    }
    let referralTotalUsdt = "0";
    try {
      referralTotalUsdt =
        ethers.formatUnits(totalAmt, USDT_DECIMALS).replace(/\.?0+$/, "") || "0";
    } catch {
      referralTotalUsdt = "0";
    }
    const rate = `Up to ${referralTotalUsdt} USDT referral budget per trade (referralTotalAmount on-chain); see levelTiers for per-level amounts.`;
    return res.json({
      ...base,
      rate,
      referralTotalAmountWei: totalAmt.toString(),
      referralTotalUsdt,
      levelTiers,
    });
  } catch (e) {
    console.warn("[referral/info] chain read failed:", e?.message || e);
    return res.json({
      ...base,
      rate: "On-chain referral config unavailable (RPC or contract read failed).",
      referralTotalUsdt: null,
      referralTotalAmountWei: null,
      levelTiers: null,
      error: e?.message || String(e),
    });
  }
});

router.get("/stats", async (req, res) => {
  try {
    const user = await User.getUser(req);
    if (!user) return res.status(404).json({ error: "User not found" });

    const wallet = (user.wallet || "").toLowerCase();
    const walletUser = wallet ? await User.getUserByWallet(wallet) : null;
    const refUser = walletUser || user;

    /** On-chain claimable USDT (token decimals). null = RPC/read failed — do not treat as zero (see Dashboard copy). */
    let claimableWei = null;
    const contractAddress = process.env.REFERRAL_CONTRACT_ADDRESS || "";
    const rpcUrl = getReferralRpcUrl();
    if (wallet && contractAddress && rpcUrl) {
      try {
        const provider = getSharedReferralRpcProvider();
        const contract = new ethers.Contract(contractAddress, ["function referralEarnings(address) view returns (uint256)"], provider);
        const amount = await contract.referralEarnings(wallet);
        claimableWei = amount.toString();
      } catch (e) {
        console.warn("[referral/stats] referralEarnings read failed:", e?.message || e);
      }
    }

    // Per-level and lifetime earnings for the dashboard come only from PostgreSQL (referral indexer
    // ingests ReferralPaid(referrer, level, amount) into referral_earnings_l1..l10).
    // Do not fold on-chain claimable into L1 — claimable is one balance for all levels and would
    // duplicate L2+ amounts already indexed under referral_earnings_l2...

    const earningsOut = {};
    for (let lvl = 1; lvl <= REFERRAL_LEVELS; lvl++) {
      earningsOut[`referralEarningsL${lvl}`] = String(refUser[`referralEarningsL${lvl}`] ?? "0");
    }

    const countsOut = {};
    for (let lvl = 1; lvl <= REFERRAL_LEVELS; lvl++) {
      countsOut[`referralCountL${lvl}`] = refUser[`referralCountL${lvl}`] ?? 0;
    }

    const sumL = sumEarningsByLevel(refUser);

    res.json({
      referrer: refUser.referrer ?? user.referrer ?? null,
      totalTrades: refUser.totalTrades ?? 0,
      ...countsOut,
      totalReferrals: refUser.totalReferrals ?? 0,
      ...earningsOut,
      referralEarningsTotal: sumL.toString(),
      claimableOnChain: claimableWei,
      referralWithdrawChunkWei: REFERRAL_WITHDRAW_CHUNK_WEI,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
