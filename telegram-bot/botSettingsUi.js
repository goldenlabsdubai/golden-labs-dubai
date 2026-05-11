/**
 * DM /start + inline keyboards: per-group alert toggles and media URL prompts.
 * Only Telegram group/channel admins (creator or administrator) for registered chats.
 */
const settings = require("./botSettings");

/** Escape text for Telegram HTML parse_mode. */
function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** @type {Map<number, { groupChatId: string, kind: string, expires: number }>} */
const pendingMediaUrl = new Map();

function clearExpiredPending() {
  const now = Date.now();
  for (const [uid, p] of pendingMediaUrl) {
    if (p.expires < now) pendingMediaUrl.delete(uid);
  }
}

async function isUserAdminOfChat(bot, groupChatId, userId) {
  try {
    const member = await bot.getChatMember(groupChatId, userId);
    const s = member.status;
    return s === "creator" || s === "administrator";
  } catch {
    return false;
  }
}

async function listAdminGroups(bot, userId, registeredIds) {
  const allowed = [];
  for (const cid of registeredIds) {
    if (await isUserAdminOfChat(bot, cid, userId)) {
      allowed.push(cid);
    }
  }
  return allowed;
}

async function groupPickerKeyboard(bot, registeredIds, userId) {
  const allowed = await listAdminGroups(bot, userId, registeredIds);
  const rows = [];
  for (const cid of allowed) {
    let title = String(cid);
    try {
      const ch = await bot.getChat(cid);
      title = ch.title || ch.username || title;
    } catch (_) {}
    const label = title.length > 28 ? `${title.slice(0, 25)}…` : title;
    rows.push([{ text: `📢 ${label}`, callback_data: `g|${cid}` }]);
  }
  return { allowed, keyboard: rows.length ? { inline_keyboard: rows } : null };
}

function groupMainKeyboard(chatId) {
  const id = String(chatId);
  const rows = [];
  for (const kind of settings.KINDS) {
    const on = settings.isAlertEnabled(id, kind);
    const label = settings.KIND_LABELS[kind] || kind;
    rows.push([
      {
        text: `${on ? "✅" : "⛔️"} ${label}`,
        callback_data: `t|${id}|${kind}`,
      },
    ]);
  }
  rows.push([{ text: "🖼 Set media (by type)…", callback_data: `med|${id}` }]);
  rows.push([{ text: "« All groups", callback_data: "home" }]);
  return { inline_keyboard: rows };
}

function mediaPickKeyboard(chatId) {
  const id = String(chatId);
  const rows = [];
  for (const kind of settings.KINDS) {
    const has = settings.getMediaUrl(id, kind) ? " ✓" : "";
    const label = settings.KIND_LABELS[kind] || kind;
    rows.push([{ text: `📎 ${label}${has}`, callback_data: `u|${id}|${kind}` }]);
  }
  rows.push([{ text: "« Back to toggles", callback_data: `g|${id}` }]);
  return { inline_keyboard: rows };
}

async function safeEdit(bot, chatId, messageId, text, replyMarkup, parseMode) {
  const opts = {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup,
  };
  if (parseMode) opts.parse_mode = parseMode;
  try {
    await bot.editMessageText(text, opts);
  } catch (e) {
    if (String(e?.message || "").includes("message is not modified")) return;
    await bot.sendMessage(chatId, text, {
      reply_markup: replyMarkup,
      ...(parseMode ? { parse_mode: parseMode } : {}),
    });
  }
}

/**
 * @param {import('node-telegram-bot-api')} bot
 * @param {() => string[]} getRegisteredChatIds
 */
async function handleSettingsStart(bot, msg, getRegisteredChatIds) {
  if (msg.chat.type !== "private") {
    await bot.sendMessage(
      msg.chat.id,
      "Open a private chat with this bot and send /start to configure alerts (group admins only)."
    );
    return true;
  }
  const userId = msg.from.id;
  const registered = getRegisteredChatIds();
  const { allowed, keyboard } = await groupPickerKeyboard(bot, registered, userId);

  if (registered.length === 0) {
    await bot.sendMessage(
      msg.chat.id,
      "No groups are registered for alerts yet.\n\n" +
        "1) Add this bot to your group or channel\n" +
        "2) Promote it to <b>admin</b> (must be able to post)\n" +
        "3) Send any message <i>in that group</i> so it registers\n" +
        "4) Send /start here again",
      { parse_mode: "HTML" }
    );
    return true;
  }

  if (allowed.length === 0) {
    await bot.sendMessage(
      msg.chat.id,
      "You are not a Telegram <b>admin</b> of any registered group/channel.\n\n" +
        "Ask an admin to promote you, or use an account that manages the announcement group. " +
        "Registered chat ids: <code>" +
        escHtml(registered.slice(0, 8).join(", ")) +
        (registered.length > 8 ? "…" : "") +
        "</code>",
      { parse_mode: "HTML" }
    );
    return true;
  }

  if (allowed.length === 1) {
    const groupChatId = allowed[0];
    let title = String(groupChatId);
    try {
      const ch = await bot.getChat(groupChatId);
      title = ch.title || ch.username || title;
    } catch (_) {}
    await bot.sendMessage(
      msg.chat.id,
      `Settings for: ${escHtml(title)}\n\nTap to turn alert types ON/OFF. Use “Set media” to attach image/video URLs.`,
      { parse_mode: "HTML", reply_markup: groupMainKeyboard(groupChatId) }
    );
    return true;
  }

  await bot.sendMessage(msg.chat.id, "Select a group to configure:", { reply_markup: keyboard });
  return true;
}

/**
 * @param {import('node-telegram-bot-api')} bot
 * @param {import('node-telegram-bot-api').CallbackQuery} query
 * @param {() => string[]} getRegisteredChatIds
 */
async function handleSettingsCallback(bot, query, getRegisteredChatIds) {
  const data = (query.data || "").trim();
  const msg = query.message;
  const fromId = query.from?.id;
  if (!msg || !fromId) {
    await bot.answerCallbackQuery(query.id);
    return;
  }
  const chatId = msg.chat.id;
  const parts = data.split("|");
  const action = parts[0];

  if (action === "home") {
    const registered = getRegisteredChatIds();
    const { keyboard } = await groupPickerKeyboard(bot, registered, fromId);
    if (!keyboard) {
      await bot.answerCallbackQuery(query.id, { text: "No eligible groups" });
      return;
    }
    await safeEdit(bot, chatId, msg.message_id, "Select a group to configure:", keyboard);
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (action === "g") {
    const groupChatId = parts[1];
    if (!groupChatId || !(await isUserAdminOfChat(bot, groupChatId, fromId))) {
      await bot.answerCallbackQuery(query.id, { text: "Not allowed", show_alert: true });
      return;
    }
    const title = await (async () => {
      try {
        const ch = await bot.getChat(groupChatId);
        return ch.title || ch.username || groupChatId;
      } catch {
        return groupChatId;
      }
    })();
    await safeEdit(
      bot,
      chatId,
      msg.message_id,
      `Settings for: ${escHtml(title)}\n\nTap to turn alert types ON/OFF. Use “Set media” to attach image/video URLs.`,
      groupMainKeyboard(groupChatId),
      "HTML"
    );
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (action === "t") {
    const groupChatId = parts[1];
    const kind = parts[2];
    if (!groupChatId || !kind || !(await isUserAdminOfChat(bot, groupChatId, fromId))) {
      await bot.answerCallbackQuery(query.id, { text: "Not allowed", show_alert: true });
      return;
    }
    const cur = settings.isAlertEnabled(groupChatId, kind);
    settings.setAlertEnabled(groupChatId, kind, !cur);
    const title = await (async () => {
      try {
        const ch = await bot.getChat(groupChatId);
        return ch.title || ch.username || groupChatId;
      } catch {
        return groupChatId;
      }
    })();
    await safeEdit(
      bot,
      chatId,
      msg.message_id,
      `Settings for: ${escHtml(title)}\n\nTap to turn alert types ON/OFF. Use “Set media” to attach image/video URLs.`,
      groupMainKeyboard(groupChatId),
      "HTML"
    );
    await bot.answerCallbackQuery(query.id, { text: !cur ? "Enabled" : "Disabled" });
    return;
  }

  if (action === "med") {
    const groupChatId = parts[1];
    if (!groupChatId || !(await isUserAdminOfChat(bot, groupChatId, fromId))) {
      await bot.answerCallbackQuery(query.id, { text: "Not allowed", show_alert: true });
      return;
    }
    await safeEdit(
      bot,
      chatId,
      msg.message_id,
      "Pick an alert type, then send an <b>HTTPS</b> image or video URL in this chat.\n\nUse /cancel to abort.",
      mediaPickKeyboard(groupChatId),
      "HTML"
    );
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (action === "u") {
    const groupChatId = parts[1];
    const kind = parts[2];
    if (!groupChatId || !kind || !(await isUserAdminOfChat(bot, groupChatId, fromId))) {
      await bot.answerCallbackQuery(query.id, { text: "Not allowed", show_alert: true });
      return;
    }
    pendingMediaUrl.set(fromId, {
      groupChatId,
      kind,
      expires: Date.now() + 10 * 60 * 1000,
    });
    const label = settings.KIND_LABELS[kind] || kind;
    await bot.sendMessage(
      chatId,
      `Send a public <b>HTTPS</b> URL for media on <b>${escHtml(label)}</b> alerts in that group (image, or .mp4/.webm/.mov).\n\n/cancel to abort.`,
      { parse_mode: "HTML" }
    );
    await bot.answerCallbackQuery(query.id);
    return;
  }

  await bot.answerCallbackQuery(query.id);
}

/**
 * @returns {boolean} true if message was handled
 */
async function handlePrivateText(bot, msg) {
  if (msg.chat.type !== "private") return false;
  const text = (msg.text || "").trim();
  const userId = msg.from.id;

  if (text === "/cancel") {
    if (pendingMediaUrl.delete(userId)) {
      await bot.sendMessage(msg.chat.id, "Cancelled.");
      return true;
    }
  }

  clearExpiredPending();
  const pend = pendingMediaUrl.get(userId);
  if (!pend) return false;
  if (!(await isUserAdminOfChat(bot, pend.groupChatId, userId))) {
    pendingMediaUrl.delete(userId);
    return false;
  }

  if (!/^https:\/\//i.test(text)) {
    await bot.sendMessage(msg.chat.id, "Send a valid <b>https://</b> URL, or /cancel.", { parse_mode: "HTML" });
    return true;
  }

  settings.setMediaUrl(pend.groupChatId, pend.kind, text);
  pendingMediaUrl.delete(userId);
  const label = settings.KIND_LABELS[pend.kind] || pend.kind;
  await bot.sendMessage(
    msg.chat.id,
    `Saved media URL for <b>${escHtml(label)}</b> in that group.`,
    { parse_mode: "HTML" }
  );
  return true;
}

module.exports = {
  handleSettingsStart,
  handleSettingsCallback,
  handlePrivateText,
};
