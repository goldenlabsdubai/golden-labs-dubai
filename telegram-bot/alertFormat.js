/**
 * Golden Labs Telegram alert copy — HTML for Telegram (links + labels).
 * Explorer base: TELEGRAM_EXPLORER_BASE (default https://bscscan.com).
 */
require("dotenv").config();

function explorerBase() {
  return (process.env.TELEGRAM_EXPLORER_BASE || "https://bscscan.com").trim().replace(/\/$/, "");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function addr(a) {
  if (a == null || a === "") return "";
  const s = String(a).trim().toLowerCase();
  return s.startsWith("0x") ? s : s;
}

function shortAddr(a) {
  const s = addr(a);
  if (!s) return "—";
  if (s.length <= 14) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function linkAddress(a) {
  const s = addr(a);
  if (!s || !s.startsWith("0x")) return escapeHtml(shortAddr(a));
  const url = `${explorerBase()}/address/${s}`;
  return `<a href="${escapeHtml(url)}">${escapeHtml(shortAddr(s))}</a>`;
}

function linkTx(hash) {
  const h = hash ? String(hash).trim().toLowerCase() : "";
  if (!h.startsWith("0x")) return escapeHtml(h || "—");
  const url = `${explorerBase()}/tx/${h}`;
  return `<a href="${escapeHtml(url)}">${escapeHtml(`${h.slice(0, 6)}…${h.slice(-4)}`)}</a>`;
}

function formatUsdtFromWei6(weiStr) {
  try {
    const n = BigInt(weiStr || 0);
    const whole = n / 1000000n;
    const frac = Number(n % 1000000n) / 1e6;
    const num = Number(whole) + frac;
    return `${num.toFixed(2)} USDT`;
  } catch {
    return String(weiStr || "0");
  }
}

/**
 * @param {"user_joined"|"subscription"|"mint"|"listed"|"bought"} kind
 * @param {Record<string, string|null|undefined>} fields
 * @returns {string} Telegram HTML
 */
function formatActivityMessage(kind, fields) {
  const lines = [];
  switch (kind) {
    case "user_joined":
      lines.push("🔔 <b>New user joined</b>");
      lines.push(`👤 <b>Wallet:</b> ${linkAddress(fields.address)}`);
      break;
    case "subscription":
      lines.push("🔔 <b>Subscription</b>");
      lines.push(`👤 <b>Wallet:</b> ${linkAddress(fields.address)}`);
      if (fields.txHash) lines.push(`🔗 <b>TX:</b> ${linkTx(fields.txHash)}`);
      break;
    case "mint":
      lines.push("🔔 <b>NFT minted</b>");
      lines.push(`👤 <b>Wallet:</b> ${linkAddress(fields.address)}`);
      if (fields.tokenId != null && fields.tokenId !== "") {
        lines.push(`🖼 <b>Token ID:</b> ${escapeHtml(String(fields.tokenId))}`);
      }
      if (fields.txHash) lines.push(`🔗 <b>TX:</b> ${linkTx(fields.txHash)}`);
      break;
    case "listed":
      lines.push("🔔 <b>NFT listed</b>");
      lines.push(`🏪 <b>Seller:</b> ${linkAddress(fields.seller)}`);
      lines.push(`🖼 <b>Token ID:</b> ${escapeHtml(fields.tokenId != null ? String(fields.tokenId) : "—")}`);
      lines.push(
        `💵 <b>Price:</b> ${escapeHtml(fields.priceWei != null ? formatUsdtFromWei6(String(fields.priceWei)) : "—")}`
      );
      break;
    case "bought":
      lines.push("🔔 <b>NFT bought</b>");
      lines.push(`🛒 <b>Buyer:</b> ${linkAddress(fields.buyer)}`);
      lines.push(`🏪 <b>Seller:</b> ${linkAddress(fields.seller)}`);
      lines.push(`🖼 <b>Token ID:</b> ${escapeHtml(fields.tokenId != null ? String(fields.tokenId) : "—")}`);
      lines.push(
        `💵 <b>Price:</b> ${escapeHtml(fields.priceWei != null ? formatUsdtFromWei6(String(fields.priceWei)) : "—")}`
      );
      if (fields.txHash) lines.push(`🔗 <b>TX:</b> ${linkTx(fields.txHash)}`);
      break;
    default:
      lines.push("🔔 <b>Activity</b>");
      lines.push(`<pre>${escapeHtml(JSON.stringify(fields))}</pre>`);
  }
  return lines.filter(Boolean).join("\n");
}

module.exports = { formatActivityMessage, addr, formatUsdtFromWei6, escapeHtml, explorerBase };
