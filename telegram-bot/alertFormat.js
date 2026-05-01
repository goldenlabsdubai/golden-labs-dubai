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

/** Full TX page with custom anchor text (e.g. “View on BscScan”). */
function linkTxWithLabel(hash, anchorText) {
  const h = hash ? String(hash).trim().toLowerCase() : "";
  const label = String(anchorText || "View").trim() || "View";
  if (!h.startsWith("0x")) return escapeHtml(label);
  const url = `${explorerBase()}/tx/${h}`;
  return `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
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

function goldenLabsSiteUrl() {
  let raw = (process.env.TELEGRAM_GOLDEN_LABS_URL || "https://goldenlabs.finance").trim().replace(/\/$/, "");
  if (!raw) raw = "https://goldenlabs.finance";
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/** @param {string} [emoji="✨"] */
function poweredByGoldenLabsLine(emoji = "✨") {
  const e = String(emoji || "✨").trim() || "✨";
  const url = goldenLabsSiteUrl();
  return `${e} <b>Powered by <a href="${escapeHtml(url)}">Golden Labs</a></b>`;
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
      lines.push("🚀 <b>WELCOME TO GOLDEN LABS</b>");
      lines.push("");
      lines.push("🟢 <b>A new user has joined the ecosystem!</b>");
      lines.push("");
      lines.push(`👤 <b>Wallet:</b> ${linkAddress(fields.address)}`);
      lines.push("");
      lines.push("━━━━━━━━━━━━━━━");
      lines.push("🔥 <b>The journey begins — explore, trade, and grow with us!</b>");
      lines.push("");
      lines.push(poweredByGoldenLabsLine());
      break;
    case "subscription": {
      const subTxLabel = (process.env.TELEGRAM_SUBSCRIPTION_TX_LABEL || "View Transaction").trim();
      lines.push("🚀 <b>NEW SUBSCRIPTION</b>");
      lines.push("");
      lines.push("🟢 <b>A user has successfully subscribed to Golden Labs services</b>");
      lines.push("");
      lines.push(`👤 <b>Wallet:</b> ${linkAddress(fields.address)}`);
      lines.push("");
      if (fields.txHash) {
        lines.push(`🔗 ${linkTxWithLabel(fields.txHash, subTxLabel)}`);
      }
      lines.push("");
      lines.push("━━━━━━━━━━━━━━━");
      lines.push(poweredByGoldenLabsLine());
      break;
    }
    case "mint": {
      const mintTxLabel = (process.env.TELEGRAM_MINT_TX_LABEL || "View Transaction").trim();
      const tidRaw = fields.tokenId != null && fields.tokenId !== "" ? String(fields.tokenId) : "";

      lines.push("🚀 <b>NEW NFT MINTED</b>");
      lines.push("");
      lines.push("🟢 <b>A fresh NFT has just been created on Golden Labs ecosystem!</b>");
      lines.push("");
      lines.push(`👤 <b>Wallet:</b> ${linkAddress(fields.address)}`);
      lines.push("");
      lines.push(
        tidRaw
          ? `🖼 <b>Token:</b> <code>#${escapeHtml(tidRaw)}</code>`
          : `🖼 <b>Token:</b> —`
      );
      lines.push("");
      if (fields.txHash) {
        lines.push(`🔗 ${linkTxWithLabel(fields.txHash, mintTxLabel)}`);
      }
      lines.push("");
      lines.push("━━━━━━━━━━━━━━━");
      lines.push("🔥 <b>Another asset enters the ecosystem</b>");
      lines.push(poweredByGoldenLabsLine());
      break;
    }
    case "listed": {
      const tidRaw = fields.tokenId != null && fields.tokenId !== "" ? String(fields.tokenId) : "";
      const priceLine =
        fields.priceWei != null ? formatUsdtFromWei6(String(fields.priceWei)) : "—";

      lines.push("🚨 <b>NEW NFT LISTED</b>");
      lines.push("");
      lines.push("🟡 <b>A fresh NFT is now live on Golden Labs marketplace!</b>");
      lines.push("");
      lines.push(`🏪 <b>Seller:</b> ${linkAddress(fields.seller)}`);
      lines.push("");
      lines.push(
        tidRaw
          ? `🖼 <b>Token:</b> <code>#${escapeHtml(tidRaw)}</code>`
          : `🖼 <b>Token:</b> —`
      );
      lines.push(`💰 <b>Price:</b> <b>${escapeHtml(priceLine)}</b>`);
      lines.push("");
      lines.push("━━━━━━━━━━━━━━━");
      lines.push("👀 <b>Keep an eye — this could sell fast</b>");
      lines.push("");
      lines.push(poweredByGoldenLabsLine());
      break;
    }
    case "bought": {
      const txLabel = (process.env.TELEGRAM_TX_VIEW_LABEL || "View on BscScan").trim();
      const tidRaw = fields.tokenId != null && fields.tokenId !== "" ? String(fields.tokenId) : "";
      const priceLine =
        fields.priceWei != null ? formatUsdtFromWei6(String(fields.priceWei)) : "—";

      lines.push("🔔 <b>NFT Purchase Alert</b>");
      lines.push("");
      lines.push("🟢 <b>New NFT Successfully Bought!</b>");
      lines.push("");
      lines.push(`👤 <b>Buyer:</b> ${linkAddress(fields.buyer)}`);
      lines.push(`🏪 <b>Seller:</b> ${linkAddress(fields.seller)}`);
      lines.push("");
      lines.push(
        tidRaw
          ? `🖼 <b>Token ID:</b> <code>#${escapeHtml(tidRaw)}</code>`
          : `🖼 <b>Token ID:</b> —`
      );
      lines.push(`💰 <b>Price:</b> <b>${escapeHtml(priceLine)}</b>`);
      lines.push("");
      if (fields.txHash) {
        lines.push(`🔗 <b>Transaction:</b> ${linkTxWithLabel(fields.txHash, txLabel)}`);
      }
      lines.push("");
      lines.push("━━━━━━━━━━━━━━━");
      lines.push(poweredByGoldenLabsLine("🚀"));
      break;
    }
    default:
      lines.push("🔔 <b>Activity</b>");
      lines.push(`<pre>${escapeHtml(JSON.stringify(fields))}</pre>`);
  }
  return lines.filter(Boolean).join("\n");
}

module.exports = { formatActivityMessage, addr, formatUsdtFromWei6, escapeHtml, explorerBase };
