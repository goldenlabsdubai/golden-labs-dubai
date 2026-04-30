import { Router } from "express";
import * as AdminPg from "../services/adminPostgres.js";
import * as BotService from "../services/botService.js";
import * as BotListingQueue from "../services/botListingQueuePg.js";
import { getPool } from "../config/postgres.js";

const router = Router();

function isAuthorized(req) {
  const expected = (process.env.BOT_CONTROL_API_KEY || "").trim();
  if (!expected) return true;
  const provided = String(req.headers["x-bot-control-key"] || req.query.key || "").trim();
  return Boolean(provided) && provided === expected;
}

/** Must be registered before `/:id` so "listing-queue" is not parsed as a bot id. */
router.get("/listing-queue", async (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(401).json({ error: "Unauthorized bot control access" });
    }
    if (!getPool()) {
      return res.status(503).json({ error: "Database not configured", items: [], source: "no-db" });
    }
    const limit = req.query.limit != null ? Number(req.query.limit) : 500;
    const items = await BotListingQueue.getBotListingQueueCandidates({ limit });
    return res.json({ items, source: "postgres" });
  } catch (e) {
    res.status(500).json({ error: e?.message || "Failed to load listing queue" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(401).json({ error: "Unauthorized bot control access" });
    }
    const id = String(req.params.id || "").trim();
    if (!/^[1-5]$/.test(id)) {
      return res.status(400).json({ error: "Invalid bot id" });
    }
    const settings = await BotService.getBotSettings();
    if (!getPool()) {
      return res.status(503).json({ error: "Database not configured", botId: id, running: true, settings, source: "no-db" });
    }
    const fromPg = await AdminPg.getBotRunningStatePg();
    if (fromPg !== null) {
      return res.json({
        botId: id,
        running: Boolean(fromPg[id]),
        settings,
        source: "postgres",
      });
    }
    return res.json({ botId: id, running: true, settings, source: "default" });
  } catch (e) {
    res.status(500).json({ error: e?.message || "Failed to load bot control state" });
  }
});

export default router;
