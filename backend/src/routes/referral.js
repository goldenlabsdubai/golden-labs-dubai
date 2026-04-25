import { Router } from "express";
import { ethers } from "ethers";
import * as User from "../services/user.js";

const router = Router();

const REFERRAL_LEVELS = 10;
/** Default 10 USDT (6 decimals); must match ReferralContract unless changed on-chain */
const REFERRAL_WITHDRAW_CHUNK_WEI = process.env.REFERRAL_WITHDRAW_CHUNK_WEI || "10000000";

function sumEarningsByLevel(refUser) {
  let s = 0n;
  for (let lvl = 1; lvl <= REFERRAL_LEVELS; lvl++) {
    s += BigInt(refUser[`referralEarningsL${lvl}`] ?? "0");
  }
  return s;
}

function allLevelsZero(refUser) {
  for (let lvl = 1; lvl <= REFERRAL_LEVELS; lvl++) {
    if (BigInt(refUser[`referralEarningsL${lvl}`] ?? "0") !== 0n) return false;
  }
  return true;
}

function onlyL1Referrals(refUser) {
  if ((refUser.referralCountL1 ?? 0) <= 0) return false;
  for (let lvl = 2; lvl <= REFERRAL_LEVELS; lvl++) {
    if ((refUser[`referralCountL${lvl}`] ?? 0) !== 0) return false;
  }
  return true;
}

function upperLevelsZero(refUser) {
  for (let lvl = 2; lvl <= REFERRAL_LEVELS; lvl++) {
    if (BigInt(refUser[`referralEarningsL${lvl}`] ?? "0") !== 0n) return false;
  }
  return true;
}

router.get("/info", (_, res) => {
  const withdrawChunkWei = String(REFERRAL_WITHDRAW_CHUNK_WEI || "10000000");
  let withdrawChunkUsdt = 10;
  try {
    withdrawChunkUsdt = Number(withdrawChunkWei) / 1e6;
  } catch {
    withdrawChunkUsdt = 10;
  }
  res.json({
    rate: "fixed $2 / trade (marketplace referralTotalAmount; on-chain config)",
    levels: REFERRAL_LEVELS,
    contractAddress: process.env.REFERRAL_CONTRACT_ADDRESS || "",
    withdrawChunkWei,
    withdrawChunkUsdt,
  });
});

router.get("/stats", async (req, res) => {
  try {
    const user = await User.getUser(req);
    if (!user) return res.status(404).json({ error: "User not found" });

    const wallet = (user.wallet || "").toLowerCase();
    const walletUser = wallet ? await User.getUserByWallet(wallet) : null;
    const refUser = walletUser || user;

    let claimable = "0";
    const contractAddress = process.env.REFERRAL_CONTRACT_ADDRESS || "";
    const rpcUrl = process.env.RPC_URL || "";
    if (wallet && contractAddress && rpcUrl) {
      try {
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const contract = new ethers.Contract(contractAddress, ["function referralEarnings(address) view returns (uint256)"], provider);
        const amount = await contract.referralEarnings(wallet);
        claimable = amount.toString();
      } catch (_) {}
    }

    const totalFromDb = refUser.referralEarningsTotal ?? "0";
    const claimableNum = BigInt(claimable);
    const totalNum = BigInt(totalFromDb);
    const hasL1 = (refUser.referralCountL1 ?? 0) >= 1;
    const allLevelsZeroFlag = allLevelsZero(refUser);
    const attributeClaimableToL1 = claimableNum > 0n && totalNum === 0n && hasL1 && allLevelsZeroFlag;

    if (wallet && claimableNum > totalNum) {
      await User.setReferralEarningsTotalAtLeast(wallet, claimable);
      const updated = await User.getUserByWallet(wallet);
      if (updated) refUser.referralEarningsTotal = updated.referralEarningsTotal ?? "0";
    }
    if (attributeClaimableToL1 && wallet) {
      await User.setReferralEarningsL1AtLeast(wallet, claimable);
      const updated = await User.getUserByWallet(wallet);
      if (updated) {
        refUser.referralEarningsTotal = updated.referralEarningsTotal ?? "0";
        for (let lvl = 1; lvl <= REFERRAL_LEVELS; lvl++) {
          refUser[`referralEarningsL${lvl}`] = updated[`referralEarningsL${lvl}`] ?? "0";
        }
      }
    }

    const totalFromDbAfterPersist = refUser.referralEarningsTotal ?? "0";
    const lifetimeTotal = totalFromDbAfterPersist;

    const l1Big = BigInt(refUser.referralEarningsL1 ?? "0");

    if (wallet && onlyL1Referrals(refUser) && upperLevelsZero(refUser) && claimableNum > l1Big) {
      await User.setReferralEarningsL1AtLeast(wallet, claimable);
      const updated = await User.getUserByWallet(wallet);
      if (updated) {
        for (let lvl = 1; lvl <= REFERRAL_LEVELS; lvl++) {
          refUser[`referralEarningsL${lvl}`] = updated[`referralEarningsL${lvl}`] ?? "0";
        }
      }
    }

    // Lifetime total can exceed sum(L1..L10) when total was synced from chain but L1 was not
    // (setReferralEarningsL1AtLeast only runs for onlyL1Referrals — false if any L2+ ref counts exist).
    const sumLevels = sumEarningsByLevel(refUser);
    const lifetimeBig = BigInt(refUser.referralEarningsTotal ?? "0");
    if (wallet && lifetimeBig > sumLevels && upperLevelsZero(refUser)) {
      const delta = (lifetimeBig - sumLevels).toString();
      await User.incrementReferralEarningsLevelOnly(wallet, 1, delta);
      const updated = await User.getUserByWallet(wallet);
      if (updated) {
        refUser.referralEarningsTotal = updated.referralEarningsTotal ?? "0";
        for (let lvl = 1; lvl <= REFERRAL_LEVELS; lvl++) {
          refUser[`referralEarningsL${lvl}`] = updated[`referralEarningsL${lvl}`] ?? "0";
        }
      }
    }

    const earningsOut = {};
    for (let lvl = 1; lvl <= REFERRAL_LEVELS; lvl++) {
      earningsOut[`referralEarningsL${lvl}`] = String(refUser[`referralEarningsL${lvl}`] ?? "0");
    }

    const countsOut = {};
    for (let lvl = 1; lvl <= REFERRAL_LEVELS; lvl++) {
      countsOut[`referralCountL${lvl}`] = refUser[`referralCountL${lvl}`] ?? 0;
    }

    const sumL = sumEarningsByLevel(refUser);
    const lifetimeCard = sumL > BigInt(lifetimeTotal) ? sumL.toString() : lifetimeTotal;

    res.json({
      referrer: refUser.referrer ?? user.referrer ?? null,
      totalTrades: refUser.totalTrades ?? 0,
      ...countsOut,
      totalReferrals: refUser.totalReferrals ?? 0,
      ...earningsOut,
      referralEarningsTotal: String(lifetimeCard),
      claimableOnChain: claimable,
      referralWithdrawChunkWei: REFERRAL_WITHDRAW_CHUNK_WEI,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
