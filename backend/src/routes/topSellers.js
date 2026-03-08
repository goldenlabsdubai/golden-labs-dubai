/**
 * Top sellers / leaderboard – live data from Firestore.
 * GET /api/top-sellers – no auth, returns top 10 by totalTrades (desc).
 * POST /api/top-sellers/record-trade – auth required, increments current user's trades (call from marketplace buy/sell when trade completes).
 */
import { Router } from "express";
import { getTopSellers, incrementUserTrades } from "../services/userFirestore.js";
import { authMiddleware } from "../middleware/auth.js";
import { avatarToAbsoluteUrl } from "./publicUser.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    res.set("Pragma", "no-cache");
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 20);
    const list = await getTopSellers(limit);
    const topSellers = list.map((u) => ({
      ...u,
      avatar: avatarToAbsoluteUrl(u.avatar) ?? u.avatar,
    }));
    res.json({ topSellers });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/record-trade", authMiddleware, async (req, res) => {
  try {
    if (!req.wallet) return res.status(401).json({ error: "Wallet required" });
    const total = await incrementUserTrades(req.wallet);
    res.json({ totalTrades: total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
