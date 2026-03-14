import { Router } from "express";
import { ethers } from "ethers";
import * as User from "../services/user.js";

const router = Router();

router.get("/info", (_, res) => {
  res.json({
    rate: "2%",
    contractAddress: process.env.REFERRAL_CONTRACT_ADDRESS || ""
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
    const allLevelsZero =
      (refUser.referralEarningsL1 ?? "0") === "0" &&
      (refUser.referralEarningsL2 ?? "0") === "0" &&
      (refUser.referralEarningsL3 ?? "0") === "0" &&
      (refUser.referralEarningsL4 ?? "0") === "0" &&
      (refUser.referralEarningsL5 ?? "0") === "0";
    const attributeClaimableToL1 = claimableNum > 0n && totalNum === 0n && hasL1 && allLevelsZero;

    if (wallet && claimableNum > totalNum) {
      await User.setReferralEarningsTotalAtLeast(wallet, claimable);
      const updated = await User.getUserByWallet(wallet);
      if (updated) refUser.referralEarningsTotal = updated.referralEarningsTotal ?? "0";
    }
    // Do NOT add claimable to DB when totalFromDb > claimable (user withdrew). Lifetime = max we've ever seen, never decrease.
    if (attributeClaimableToL1 && wallet) {
      await User.setReferralEarningsL1AtLeast(wallet, claimable);
      const updated = await User.getUserByWallet(wallet);
      if (updated) {
        refUser.referralEarningsTotal = updated.referralEarningsTotal ?? "0";
        refUser.referralEarningsL1 = updated.referralEarningsL1 ?? "0";
        refUser.referralEarningsL2 = updated.referralEarningsL2 ?? "0";
        refUser.referralEarningsL3 = updated.referralEarningsL3 ?? "0";
        refUser.referralEarningsL4 = updated.referralEarningsL4 ?? "0";
        refUser.referralEarningsL5 = updated.referralEarningsL5 ?? "0";
      }
    }

    const totalFromDbAfterPersist = refUser.referralEarningsTotal ?? "0";
    // Lifetime = total ever earned (L1..L5, claimed + unclaimed). We only ever bump DB when claimable > DB; never add on withdraw.
    const lifetimeTotal = totalFromDbAfterPersist;

    const l1FromDb = refUser.referralEarningsL1 ?? "0";
    const l2FromDb = refUser.referralEarningsL2 ?? "0";
    const l3FromDb = refUser.referralEarningsL3 ?? "0";
    const l4FromDb = refUser.referralEarningsL4 ?? "0";
    const l5FromDb = refUser.referralEarningsL5 ?? "0";
    const l1Big = BigInt(l1FromDb);
    const l2Big = BigInt(l2FromDb);
    const l3Big = BigInt(l3FromDb);
    const l4Big = BigInt(l4FromDb);
    const l5Big = BigInt(l5FromDb);

    // If this wallet only has L1 referrals and levels are stored from fallback path,
    // keep L1 aligned with current on-chain claimable when it grows.
    const hasOnlyL1Referrals =
      (refUser.referralCountL1 ?? 0) > 0 &&
      (refUser.referralCountL2 ?? 0) === 0 &&
      (refUser.referralCountL3 ?? 0) === 0 &&
      (refUser.referralCountL4 ?? 0) === 0 &&
      (refUser.referralCountL5 ?? 0) === 0;
    const allUpperLevelsZero = l2Big === 0n && l3Big === 0n && l4Big === 0n && l5Big === 0n;
    if (wallet && hasOnlyL1Referrals && allUpperLevelsZero && claimableNum > l1Big) {
      await User.setReferralEarningsL1AtLeast(wallet, claimable);
      const updated = await User.getUserByWallet(wallet);
      if (updated) {
        refUser.referralEarningsL1 = updated.referralEarningsL1 ?? "0";
        refUser.referralEarningsL2 = updated.referralEarningsL2 ?? "0";
        refUser.referralEarningsL3 = updated.referralEarningsL3 ?? "0";
        refUser.referralEarningsL4 = updated.referralEarningsL4 ?? "0";
        refUser.referralEarningsL5 = updated.referralEarningsL5 ?? "0";
      }
    }

    const referralEarningsL1 = refUser.referralEarningsL1 ?? "0";
    const referralEarningsL2 = refUser.referralEarningsL2 ?? "0";
    const referralEarningsL3 = refUser.referralEarningsL3 ?? "0";
    const referralEarningsL4 = refUser.referralEarningsL4 ?? "0";
    const referralEarningsL5 = refUser.referralEarningsL5 ?? "0";

    const sumL1L5 =
      BigInt(referralEarningsL1 ?? "0") +
      BigInt(referralEarningsL2 ?? "0") +
      BigInt(referralEarningsL3 ?? "0") +
      BigInt(referralEarningsL4 ?? "0") +
      BigInt(referralEarningsL5 ?? "0");
    const lifetimeCard = sumL1L5 > BigInt(lifetimeTotal) ? sumL1L5.toString() : lifetimeTotal;

    res.json({
      referrer: refUser.referrer ?? user.referrer ?? null,
      referralCountL1: refUser.referralCountL1 ?? 0,
      referralCountL2: refUser.referralCountL2 ?? 0,
      referralCountL3: refUser.referralCountL3 ?? 0,
      referralCountL4: refUser.referralCountL4 ?? 0,
      referralCountL5: refUser.referralCountL5 ?? 0,
      totalReferrals: refUser.totalReferrals ?? 0,
      referralEarningsL1: String(referralEarningsL1 ?? "0"),
      referralEarningsL2: String(referralEarningsL2 ?? "0"),
      referralEarningsL3: String(referralEarningsL3 ?? "0"),
      referralEarningsL4: String(referralEarningsL4 ?? "0"),
      referralEarningsL5: String(referralEarningsL5 ?? "0"),
      referralEarningsTotal: String(lifetimeCard),
      claimableOnChain: claimable,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
