/**
 * Golden Labs Telegram — outbound alerts only.
 *
 * - Platform events arrive via POST /alert from the backend.
 * - Group admins can DM /start to toggle alert types and set media URLs per registered group.
 *
 * - Groups/channels are auto-registered (silent) so alerts have a chat_id; see alert-chats.json.
 *   Optional TELEGRAM_CHAT_ID seeds an extra target.
 *
 * POST /alert: { "kind": "subscription"|"mint"|"maintenance"|"maintenance_resumed"|..., ...fields } or { "message": "..." }
 * Optional: mediaUrl / imageUrl (HTTPS) or env TELEGRAM_ALERT_MEDIA_<KIND> — see .env.example
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const http = require("http");
const TelegramBot = require("node-telegram-bot-api");
const { formatActivityMessage } = require("./alertFormat");
const botSettings = require("./botSettings");
const settingsUi = require("./botSettingsUi");

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

/** Env: one public HTTPS URL per alert kind (image or video). */
const KIND_MEDIA_ENV = {
  user_joined: "TELEGRAM_ALERT_MEDIA_USER_JOINED",
  subscription: "TELEGRAM_ALERT_MEDIA_SUBSCRIPTION",
  mint: "TELEGRAM_ALERT_MEDIA_MINT",
  listed: "TELEGRAM_ALERT_MEDIA_LISTED",
  bought: "TELEGRAM_ALERT_MEDIA_BOUGHT",
  sold: "TELEGRAM_ALERT_MEDIA_SOLD",
  maintenance: "TELEGRAM_ALERT_MEDIA_MAINTENANCE",
};

const PHOTO_VIDEO_CAPTION_MAX = 1024;

function logicalMediaKind(kind) {
  const k = String(kind || "").toLowerCase();
  if (k === "maintenance_resumed") return "maintenance";
  if (k === "sold") return "sold";
  return k;
}

function resolveAlertMediaUrl(targetChatId, kind, override) {
  const o = (override || "").trim();
  if (/^https?:\/\//i.test(o)) return o;
  const logical = logicalMediaKind(kind);
  if (targetChatId && logical) {
    const per = botSettings.getMediaUrl(targetChatId, logical);
    if (per && /^https?:\/\//i.test(per)) return per;
  }
  const k = logical ? String(logical).toLowerCase() : "";
  const envKey = KIND_MEDIA_ENV[k];
  const fromKind = envKey ? (process.env[envKey] || "").trim() : "";
  if (fromKind) return fromKind;
  if (k === "sold") {
    const fromBought = (process.env.TELEGRAM_ALERT_MEDIA_BOUGHT || "").trim();
    if (fromBought) return fromBought;
  }
  return (process.env.TELEGRAM_ALERT_MEDIA_DEFAULT || "").trim();
}

function isProbablyVideoUrl(url) {
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(url);
}

/**
 * Send image/video with caption when URL works; long captions split into media + text message.
 * @returns {Promise<{ ok: boolean, messageId?: number }>}
 */
async function sendMediaAlert(chatId, mediaUrl, caption, parseMode) {
  const msgOpts = { disable_web_page_preview: true };
  if (parseMode) msgOpts.parse_mode = parseMode;
  const capOpts = parseMode ? { parse_mode: parseMode } : {};
  try {
    if (caption.length > PHOTO_VIDEO_CAPTION_MAX) {
      if (isProbablyVideoUrl(mediaUrl)) {
        await bot.sendVideo(chatId, mediaUrl, {});
      } else {
        await bot.sendPhoto(chatId, mediaUrl, {});
      }
      const textMsg = await bot.sendMessage(chatId, caption, msgOpts);
      return { ok: true, messageId: textMsg.message_id };
    }
    let mediaMsg;
    if (isProbablyVideoUrl(mediaUrl)) {
      mediaMsg = await bot.sendVideo(chatId, mediaUrl, { caption, ...capOpts });
    } else {
      mediaMsg = await bot.sendPhoto(chatId, mediaUrl, { caption, ...capOpts });
    }
    return { ok: true, messageId: mediaMsg.message_id };
  } catch (e) {
    console.warn(`[telegram] media send failed, falling back to text:`, e?.message || e);
    return { ok: false };
  }
}

/**
 * @param {string|undefined} parseMode
 * @param {{ kind?: string, mediaUrl?: string, pin?: boolean }} [extra] kind selects env TELEGRAM_ALERT_MEDIA_<KIND>; mediaUrl overrides
 */
async function sendAlert(message, parseMode, extra = {}) {
  const unique = [...new Set([...alertChatIds].map(String))];
  if (unique.length === 0) {
    throw new Error(
      "No alert chats registered yet. Add the bot to a group with permission to send messages, then send any message in that group (or re-add the bot). Optional: set TELEGRAM_CHAT_ID once to seed."
    );
  }
  const opts = { disable_web_page_preview: true };
  if (parseMode) opts.parse_mode = parseMode;
  const errors = [];
  const pin = Boolean(extra.pin);
  let sent = 0;
  let skippedDisabled = 0;
  for (const id of unique) {
    try {
      if (extra.kind && !botSettings.isAlertEnabled(id, extra.kind)) {
        skippedDisabled++;
        continue;
      }
      const mediaUrl = resolveAlertMediaUrl(id, extra.kind, extra.mediaUrl);
      const useMedia = Boolean(mediaUrl && /^https?:\/\//i.test(mediaUrl));
      /** @type {number|undefined} */
      let messageId;
      if (useMedia) {
        const mediaResult = await sendMediaAlert(id, mediaUrl, message, parseMode);
        if (mediaResult.ok && mediaResult.messageId != null) {
          messageId = mediaResult.messageId;
          console.log(`[telegram] Alert (+media) sent to chat ${id}`);
        }
      }
      if (messageId == null) {
        const sentMsg = await bot.sendMessage(id, message, opts);
        messageId = sentMsg.message_id;
        console.log(`[telegram] Alert sent to chat ${id} (${message.length} chars)`);
      }
      sent++;
      if (pin && messageId != null) {
        try {
          await bot.pinChatMessage(id, messageId, { disable_notification: true });
          console.log(`[telegram] Pinned alert in chat ${id} (msg ${messageId})`);
        } catch (pe) {
          console.warn(`[telegram] pinChatMessage failed for ${id} (needs admin + can_pin_messages):`, pe?.message || pe);
        }
      }
    } catch (e) {
      const body = e?.response?.body;
      console.error(`[telegram] sendMessage failed for ${id}:`, body || e?.message || e);
      errors.push({ id, err: body || e?.message || String(e) });
    }
  }
  if (sent === 0 && unique.length > 0) {
    console.warn(
      `[telegram] Alert reached no chats (kind=${extra.kind || "n/a"}). ` +
        `${skippedDisabled}/${unique.length} skipped (type disabled in bot /start for that group). ` +
        `Enable the toggle or set TELEGRAM_CHAT_ID / alert-chats.json.`
    );
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

function getRegisteredChatIds() {
  return [...alertChatIds].map(String);
}

function matchesCommand(text, commandName) {
  const part = (text || "").trim().split(/\s+/)[0].toLowerCase();
  const cmd = String(commandName).toLowerCase();
  return part === `/${cmd}` || part.startsWith(`/${cmd}@`);
}

bot.on("message", async (msg) => {
  try {
    registerChatFromTelegramMessage(msg.chat);

    const isStart = matchesCommand(msg.text, "start");
    const isSettings = matchesCommand(msg.text, "settings");

    if (msg.chat.type !== "private" && (isStart || isSettings)) {
      try {
        await bot.sendMessage(
          msg.chat.id,
          "To configure alert toggles: open a <b>private chat</b> with me and send /start (you must be a group admin).",
          { parse_mode: "HTML", reply_to_message_id: msg.message_id }
        );
      } catch (e) {
        console.warn("[telegram] group /start reply failed:", e?.message || e);
      }
      return;
    }

    if (msg.chat.type === "private") {
      if (isStart || isSettings) {
        await settingsUi.handleSettingsStart(bot, msg, getRegisteredChatIds);
        return;
      }
      const handled = await settingsUi.handlePrivateText(bot, msg);
      if (handled) return;
    }
  } catch (e) {
    console.error("[telegram] message handler:", e?.message || e);
    try {
      if (msg.chat?.id) {
        await bot.sendMessage(msg.chat.id, "Something went wrong. Try again or check server logs.");
      }
    } catch (_) {
      /* ignore */
    }
  }
});

bot.on("callback_query", async (query) => {
  try {
    await settingsUi.handleSettingsCallback(bot, query, getRegisteredChatIds);
  } catch (e) {
    console.error("[telegram] callback_query:", e?.message || e);
    try {
      await bot.answerCallbackQuery(query.id, { text: "Error — try /start again.", show_alert: true });
    } catch (_) {
      /* ignore */
    }
  }
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
    let parseMode;
    let kindForMedia;
    let mediaOverride = (json.mediaUrl || json.imageUrl || "").trim();

    if (typeof json.message === "string" && json.message) {
      msg = json.message;
    } else if (typeof json.text === "string" && json.text) {
      msg = json.text;
    } else if (typeof json.kind === "string" && json.kind) {
      const { kind, mediaUrl, imageUrl, ...fields } = json;
      kindForMedia = kind;
      const inlineMedia = (mediaUrl || imageUrl || "").trim();
      if (inlineMedia) mediaOverride = inlineMedia;
      msg = formatActivityMessage(kind, fields);
      parseMode = "HTML";
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
    const pinKinds = new Set(["maintenance", "maintenance_resumed"]);
    const shouldPin = json.kind ? pinKinds.has(String(json.kind)) : false;
    console.log("[bridge] /alert → forwarding to Telegram…");
    await sendAlert(msg, parseMode, { kind: kindForMedia, mediaUrl: mediaOverride || undefined, pin: shouldPin });
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
    "[telegram] Group admins: DM /start to configure per-group alert toggles + media. Bridge unchanged."
  );
});

module.exports = { bot, sendAlert };
