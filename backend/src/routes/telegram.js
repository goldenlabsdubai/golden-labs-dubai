import { Router } from "express";
import { sendTelegramText, isTelegramSendConfigured } from "../services/telegramNotify.js";

const router = Router();

router.post("/alert", async (req, res) => {
  if (!isTelegramSendConfigured()) return res.status(503).json({ error: "Telegram not configured" });
  try {
    const { message, event, data } = req.body || {};
    const msg = message || (event ? `Event: ${event}\n${data ? JSON.stringify(data, null, 2) : ""}` : "No message");
    await sendTelegramText(msg, { throwOnError: true });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
