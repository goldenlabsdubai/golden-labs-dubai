import { Router } from "express";
import { getFirestore } from "../config/firebase.js";
import * as AdminPg from "../services/adminPostgres.js";

const router = Router();
const BOT_CONTROL_COLLECTION = "bot_control";
const BOT_STATE_DOC = "bots";

function isAuthorized(req) {
  const expected = (process.env.BOT_CONTROL_API_KEY || "").trim();
  if (!expected) return true;
  const provided = String(req.headers["x-bot-control-key"] || req.query.key || "").trim();
  return Boolean(provided) && provided === expected;
}

router.get("/:id", async (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(401).json({ error: "Unauthorized bot control access" });
    }
    const id = String(req.params.id || "").trim();
    if (!/^[1-5]$/.test(id)) {
      return res.status(400).json({ error: "Invalid bot id" });
    }
    const fromPg = await AdminPg.getBotRunningStatePg();
    if (fromPg !== null) {
      return res.json({
        botId: id,
        running: Boolean(fromPg[id]),
        source: "postgres",
      });
    }
    const db = getFirestore();
    if (!db) {
      return res.json({ botId: id, running: true, source: "default-no-db" });
    }
    const doc = await db.collection(BOT_CONTROL_COLLECTION).doc(BOT_STATE_DOC).get();
    const data = doc.exists ? doc.data() : {};
    const runningByBotId =
      data?.runningByBotId && typeof data.runningByBotId === "object" ? data.runningByBotId : {};
    res.json({
      botId: id,
      running: Boolean(runningByBotId[id]),
      updatedAt: data?.updatedAt || null,
      source: "firestore",
    });
  } catch (e) {
    res.status(500).json({ error: e?.message || "Failed to load bot control state" });
  }
});

export default router;
