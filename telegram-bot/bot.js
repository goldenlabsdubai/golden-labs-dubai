/**
 * Golden Labs Telegram — outbound alerts only.
 *
 * - Platform events (subscription, mint, listed, bought, user_joined, …) arrive via POST /alert
 *   from the backend; the bot posts those to registered groups. It does not reply to users,
 *   commands, or DMs — no sendMessage except from sendAlert() (bridge).
 *
 * - Groups/channels are auto-registered (silent) so alerts have a chat_id; see alert-chats.json.
 *   Optional TELEGRAM_CHAT_ID seeds an extra target.
 *
 * POST /alert: { "kind": "subscription"|"mint"|..., ...fields } or { "message": "..." }
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const http = require("http");
const TelegramBot = require("node-telegram-bot-api");
const { formatActivityMessage } = require("./alertFormat");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPTIONAL_SEED_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || "").trim();
const BRIDGE_PORT = Number(process.env.TELEGRAM_ALERT_BRIDGE_PORT || 3847);
const BRIDGE_SECRET = (process.env.TELEGRAM_BRIDGE_SECRET || "").trim();
const MAX_BODY = 65536;
const ALERT_CHATS_FILE = path.join(__dirname, "alert-chats.json");

/** @type {Set<string>} */
let alertChatIds = new Set();

function loadAlertChats() {
  try {
    const raw = fs.readFileSync(ALERT_CHATS_FILE, "utf8");
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      alertChatIds = new Set(arr.map((x) => String(x)));
    }
  } catch {
    alertChatIds = new Set();
  }
}

function saveAlertChats() {
  fs.writeFileSync(ALERT_CHATS_FILE, JSON.stringify([...alertChatIds], null, 0), "utf8");
}

function registerAlertChat(chatId) {
  if (chatId == null || chatId === "") return;
  const id = String(chatId);
  if (!alertChatIds.has(id)) {
    alertChatIds.add(id);
    saveAlertChats();
    console.log(`[telegram] Registered alert chat: ${id} (total ${alertChatIds.size})`);
  }
}

function unregisterAlertChat(chatId) {
  if (chatId == null || chatId === "") return;
  const id = String(chatId);
  if (alertChatIds.delete(id)) {
    saveAlertChats();
    console.log(`[telegram] Unregistered alert chat: ${id} (total ${alertChatIds.size})`);
  }
}

if (!TOKEN) {
  console.error("Set TELEGRAM_BOT_TOKEN in .env");
  process.exit(1);
}

loadAlertChats();
if (OPTIONAL_SEED_CHAT_ID) {
  registerAlertChat(OPTIONAL_SEED_CHAT_ID);
}

const bot = new TelegramBot(TOKEN, { polling: true });

async function sendAlert(message) {
  const unique = [...new Set([...alertChatIds].map(String))];
  if (unique.length === 0) {
    throw new Error(
      "No alert chats registered yet. Add the bot to a group with permission to send messages, then send any message in that group (or re-add the bot). Optional: set TELEGRAM_CHAT_ID once to seed."
    );
  }
  const errors = [];
  for (const id of unique) {
    try {
      await bot.sendMessage(id, message, { disable_web_page_preview: true });
      console.log(`[telegram] Alert sent to chat ${id} (${message.length} chars)`);
    } catch (e) {
      const body = e?.response?.body;
      console.error(`[telegram] sendMessage failed for ${id}:`, body || e?.message || e);
      errors.push({ id, err: body || e?.message || String(e) });
    }
  }
  if (errors.length === unique.length) {
    throw new Error(errors.map((e) => `${e.id}: ${e.err}`).join("; "));
  }
}

function registerChatFromTelegramMessage(chat) {
  if (!chat?.id) return;
  const t = chat.type;
  if (t === "group" || t === "supergroup" || t === "channel") {
    registerAlertChat(chat.id);
  }
}

// Inbound messages: only discover group/channel id for outbound alerts — never reply.
bot.on("message", (msg) => {
  registerChatFromTelegramMessage(msg.chat);
});

bot.on("my_chat_member", (ev) => {
  const chat = ev.chat;
  const status = ev.new_chat_member?.status;
  if (status === "administrator" || status === "member" || status === "restricted") {
    registerChatFromTelegramMessage(chat);
  } else if (status === "left" || status === "kicked") {
    if (chat?.id != null) unregisterAlertChat(chat.id);
  }
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let len = 0;
    req.on("data", (chunk) => {
      len += chunk.length;
      if (len > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "telegram-alert-bridge",
        alertChatCount: alertChatIds.size,
      })
    );
    return;
  }

  if (req.method !== "POST" || req.url !== "/alert") {
    res.writeHead(404);
    res.end();
    return;
  }

  if (BRIDGE_SECRET) {
    const h = (req.headers["x-telegram-bridge-secret"] || "").trim();
    if (h !== BRIDGE_SECRET) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("forbidden");
      return;
    }
  }

  try {
    const raw = await readBody(req);
    const json = raw ? JSON.parse(raw) : {};

    let msg = "";
    if (typeof json.message === "string" && json.message) {
      msg = json.message;
    } else if (typeof json.text === "string" && json.text) {
      msg = json.text;
    } else if (typeof json.kind === "string" && json.kind) {
      const { kind, ...fields } = json;
      msg = formatActivityMessage(kind, fields);
    }

    if (!msg) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: 'Send { "kind": "subscription"|"mint"|... , ...fields } or { "message": "..." }',
        })
      );
      return;
    }
    console.log("[bridge] /alert → forwarding to Telegram…");
    await sendAlert(msg);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    console.error("Bridge /alert error:", e?.message || e);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(e?.message || e) }));
  }
});

server.listen(BRIDGE_PORT, "127.0.0.1", () => {
  console.log(
    `Telegram bot running. Bridge: POST http://127.0.0.1:${BRIDGE_PORT}/alert  health: GET /health` +
      (BRIDGE_SECRET ? " (secret required)" : "") +
      `  registered chats: ${alertChatIds.size}`
  );
  console.log(
    "[telegram] Alerts-only bot: add to group (Send Messages), one message there registers chat. No replies to users."
  );
});

module.exports = { bot, sendAlert };
