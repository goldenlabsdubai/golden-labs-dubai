/**
 * All Golden Labs Telegram alert copy lives here (wallet addresses only).
 * Backend only POSTs { kind, ...fields } to the bridge — no formatting on the server.
 */

function addr(a) {
  if (a == null || a === "") return "";
  const s = String(a).trim().toLowerCase();
  return s.startsWith("0x") ? s : s;
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
 */
function formatActivityMessage(kind, fields) {
  const lines = [];
  switch (kind) {
    case "user_joined":
      lines.push("🔔 New user joined", `Address: ${addr(fields.address)}`);
      break;
    case "subscription":
      lines.push("🔔 Subscription", `Address: ${addr(fields.address)}`);
      if (fields.txHash) lines.push(`TX: ${fields.txHash}`);
      break;
    case "mint":
      lines.push("🔔 NFT minted", `Address: ${addr(fields.address)}`);
      if (fields.tokenId != null && fields.tokenId !== "") lines.push(`Token ID: ${fields.tokenId}`);
      if (fields.txHash) lines.push(`TX: ${fields.txHash}`);
      break;
    case "listed":
      lines.push(
        "🔔 NFT listed",
        `Seller: ${addr(fields.seller)}`,
        `Token ID: ${fields.tokenId != null ? String(fields.tokenId) : "—"}`,
        `Price: ${fields.priceWei != null ? formatUsdtFromWei6(String(fields.priceWei)) : "—"}`
      );
      break;
    case "bought":
      lines.push(
        "🔔 NFT bought",
        `Buyer: ${addr(fields.buyer)}`,
        `Seller: ${addr(fields.seller)}`,
        `Token ID: ${fields.tokenId != null ? String(fields.tokenId) : "—"}`,
        `Price: ${fields.priceWei != null ? formatUsdtFromWei6(String(fields.priceWei)) : "—"}`
      );
      if (fields.txHash) lines.push(`TX: ${fields.txHash}`);
      break;
    default:
      lines.push("🔔 Activity", JSON.stringify(fields));
  }
  return lines.filter(Boolean).join("\n");
}

module.exports = { formatActivityMessage, addr, formatUsdtFromWei6 };
