/**
 * Telegram Bot - Blockchain Event Alerts
 * Flow: Blockchain Event → Backend Listener → Webhook → Telegram Bot → Group/Channel Alert
 */
require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TOKEN || !CHAT_ID) {
  console.log("Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

async function sendAlert(message) {
  await bot.sendMessage(CHAT_ID, message);
}

bot.on("message", (msg) => {
  console.log("Received:", msg.text);
});

// For backend: POST to /api/telegram/alert with { message } or { event, data }
module.exports = { bot, sendAlert };

console.log("Telegram bot started. Listening for messages.");
