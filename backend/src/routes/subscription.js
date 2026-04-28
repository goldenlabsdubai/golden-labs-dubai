import { Router } from "express";
import * as User from "../services/user.js";
import { getOnChainUserStatus } from "../services/onChainUser.js";

const router = Router();

router.get("/config", (_, res) => {
  res.json({
    price: "10",
    priceFormatted: "$10 USDT",
    contractAddress: process.env.SUBSCRIPTION_CONTRACT_ADDRESS || "",
  });
});

router.post("/confirm", async (req, res) => {
  try {
    const user = await User.getUser(req);
    if (!user) return res.status(404).json({ error: "User not found" });
    // Prefer JWT wallet — matches SIWE/session identity and the account that should send subscribe().
    const wallet = (req.wallet || user.wallet || "").toLowerCase();
    if (!wallet) return res.status(400).json({ error: "Wallet required" });
    const status = await getOnChainUserStatus(wallet);
    if (!status.subscriptionKnown) {
      return res.status(503).json({
        error:
          "Subscription status could not be verified on-chain. Check RPC and SUBSCRIPTION_CONTRACT_ADDRESS, then try again.",
      });
    }
    if (!status.hasSubscribed) {
      return res.status(403).json({ error: "Subscribe on-chain first. Complete the subscription transaction in your wallet." });
    }
    await User.updateUser(user.id, { state: "SUBSCRIBED", lastActivity: new Date() });
    const txHash = (req.body && req.body.txHash) ? String(req.body.txHash).trim() : null;
    await User.logActivity(wallet, "subscription", { price: "10000000", ...(txHash ? { txHash } : {}) });
    const updated = await User.getUser(req);
    res.json({
      user: { wallet: updated.wallet, state: updated.state },
      redirect: "mint",
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
