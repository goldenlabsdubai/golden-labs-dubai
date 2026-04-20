/**
 * Golden Labs Telegram app (PM2) — token, formatting, and sending live here only.
 * Backend only POSTs JSON to /alert (no Telegram SDK on the server).
 *
 * POST /alert body:
 *   { "kind": "subscription", "address": "0x...", "txHash": "..." }  → formatted here
 *   { "message": "raw text" }  → sent as-is (e.g. /api/telegram/alert)
 */
require("dotenv").config();
const http = require("http");
const TelegramBot = require("node-telegram-bot-api");
const { formatActivityMessage } = require("./alertFormat");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const BRIDGE_PORT = Number(process.env.TELEGRAM_ALERT_BRIDGE_PORT || 3847);
const BRIDGE_SECRET = (process.env.TELEGRAM_BRIDGE_SECRET || "").trim();
const MAX_BODY = 65536;

if (!TOKEN || !CHAT_ID) {
  console.error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

async function sendAlert(message) {
  await bot.sendMessage(CHAT_ID, message);
}

bot.on("message", (msg) => {
  console.log("Received:", msg.text);
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
    res.end(JSON.stringify({ ok: true, service: "telegram-alert-bridge" }));
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
      (BRIDGE_SECRET ? " (secret required)" : "")
  );
});

module.exports = { bot, sendAlert };
