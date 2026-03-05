import { Router } from "express";
import * as User from "../services/userFirestore.js";
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
    const wallet = (user.wallet || req.wallet || "").toLowerCase();
    if (!wallet) return res.status(400).json({ error: "Wallet required" });
    const { hasSubscribed } = await getOnChainUserStatus(wallet);
    if (!hasSubscribed) {
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
