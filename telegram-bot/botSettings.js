/**
 * Per-group alert settings (toggles + media URLs). Persisted to bot-settings.json.
 */
const fs = require("fs");
const path = require("path");

const SETTINGS_FILE = path.join(__dirname, "bot-settings.json");

/** @type {Record<string, { alerts?: Record<string, boolean>, media?: Record<string, string> }>} */
let cache = {};

const KINDS = ["user_joined", "subscription", "mint", "listed", "bought", "maintenance"];

const KIND_LABELS = {
  user_joined: "New user",
  subscription: "Subscription",
  mint: "Mint",
  listed: "Listed",
  bought: "Bought / buy",
  maintenance: "Maintenance",
};

function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    const j = JSON.parse(raw);
    cache = j && typeof j === "object" ? j : {};
  } catch {
    cache = {};
  }
}

function saveSettings() {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(cache, null, 2), "utf8");
}

function getChatSettings(chatId) {
  const id = String(chatId);
  if (!cache[id]) {
    cache[id] = {
      alerts: {},
      media: {},
    };
  }
  if (!cache[id].alerts) cache[id].alerts = {};
  if (!cache[id].media) cache[id].media = {};
  return cache[id];
}

/** maintenance_resumed shares the "Maintenance" toggle with scheduled maintenance. */
function gateKindForAlert(kind) {
  const k = String(kind || "").toLowerCase();
  return k === "maintenance_resumed" ? "maintenance" : k;
}

function isAlertEnabled(chatId, kind) {
  const gate = gateKindForAlert(kind);
  if (!KINDS.includes(gate)) return true;
  const a = getChatSettings(chatId).alerts[gate];
  return a !== false;
}

function setAlertEnabled(chatId, kind, enabled) {
  const k = String(kind || "").toLowerCase();
  if (!KINDS.includes(k)) return;
  const s = getChatSettings(chatId);
  s.alerts[k] = Boolean(enabled);
  saveSettings();
}

function getMediaUrl(chatId, kind) {
  const k = String(kind || "").toLowerCase();
  const m = getChatSettings(chatId).media[k];
  return (m && String(m).trim()) || "";
}

function setMediaUrl(chatId, kind, url) {
  const k = String(kind || "").toLowerCase();
  if (!KINDS.includes(k)) return;
  const s = getChatSettings(chatId);
  s.media[k] = String(url || "").trim();
  saveSettings();
}

loadSettings();

module.exports = {
  KINDS,
  KIND_LABELS,
  gateKindForAlert,
  loadSettings,
  isAlertEnabled,
  setAlertEnabled,
  getMediaUrl,
  setMediaUrl,
  getChatSettings,
};
