import { Router } from "express";
import TelegramBot from "node-telegram-bot-api";

const router = Router();
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const bot = TOKEN ? new TelegramBot(TOKEN, { polling: false }) : null;

router.post("/alert", async (req, res) => {
  if (!bot || !CHAT_ID) return res.status(503).json({ error: "Telegram not configured" });
  try {
    const { message, event, data } = req.body || {};
    const msg = message || (event ? `Event: ${event}\n${data ? JSON.stringify(data, null, 2) : ""}` : "No message");
    await bot.sendMessage(CHAT_ID, msg);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
