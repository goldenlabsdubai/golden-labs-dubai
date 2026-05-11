import { Router } from "express";
import * as User from "../services/user.js";
import { getOnChainUserStatus, getSubscriptionPriceFromChain } from "../services/onChainUser.js";
import { isConfiguredBotWallet } from "../services/botService.js";
import { notifyActivity } from "../services/telegramNotify.js";

const router = Router();

router.get("/config", async (_, res) => {
  try {
    const contractAddress = (process.env.SUBSCRIPTION_CONTRACT_ADDRESS || "").trim();
    const fromChain = await getSubscriptionPriceFromChain();
    res.json({
      price: fromChain.price,
      priceFormatted: fromChain.priceFormatted,
      priceWei: fromChain.priceWei,
      contractAddress,
      subscriptionKnown: true,
    });
  } catch (e) {
    console.warn("subscription /config:", e?.message || e);
    res.status(503).json({
      error: e?.message || "Failed to read subscription price from chain",
      contractAddress: (process.env.SUBSCRIPTION_CONTRACT_ADDRESS || "").trim(),
      subscriptionKnown: false,
    });
  }
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
    let priceWeiLog;
    try {
      const subPrice = await getSubscriptionPriceFromChain();
      priceWeiLog = subPrice.priceWei;
    } catch (e) {
      return res.status(503).json({ error: e?.message || "Could not read subscription price from chain for activity log" });
    }
    await User.logActivity(wallet, "subscription", { price: priceWeiLog, ...(txHash ? { txHash } : {}) });
    if (!isConfiguredBotWallet(wallet)) {
      notifyActivity("subscription", { address: wallet, ...(txHash ? { txHash } : {}) }).catch((e) =>
        console.warn("[telegram] subscription alert:", e?.message || e)
      );
    }
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
