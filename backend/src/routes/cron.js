/**
 * Cron endpoints – triggered by Vercel Cron (or external cron).
 * Protected by CRON_SECRET (Vercel sends it as Authorization: Bearer <secret>).
 */
import { Router } from "express";
import { runReferralIndexerOnce } from "../services/referralIndexer.js";
import { runMarketplaceActivityIndexerOnce } from "../services/marketplaceActivityIndexer.js";

const router = Router();

function isCronAuthorized(req) {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret) return true; // Allow when no secret (local/dev)
  const auth = String(req.headers.authorization || "").trim();
  if (auth.startsWith("Bearer ")) {
    return auth.slice(7) === secret;
  }
  return false;
}

router.all("/referral-indexer", async (req, res) => {
  if (!isCronAuthorized(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    await runReferralIndexerOnce();
    res.json({ ok: true, message: "Referral indexer run completed" });
  } catch (e) {
    console.error("Cron referral-indexer error:", e?.message || e);
    res.status(500).json({ error: e?.message || "Indexer failed" });
  }
});

router.all("/marketplace-indexer", async (req, res) => {
  if (!isCronAuthorized(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    await runMarketplaceActivityIndexerOnce();
    res.json({ ok: true, message: "Marketplace indexer run completed" });
  } catch (e) {
    console.error("Cron marketplace-indexer error:", e?.message || e);
    res.status(500).json({ error: e?.message || "Indexer failed" });
  }
});

export default router;
