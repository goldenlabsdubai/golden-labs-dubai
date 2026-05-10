import { formatUnits, parseUnits } from "viem";
import { USDT_DECIMALS } from "../constants/usdtDecimals";

/**
 * Normalizes wagmi/viem uint256 reads (bigint, hex string, or nested array) for formatting.
 * @param {unknown} data
 * @returns {bigint | null}
 */
export function readContractUint256(data) {
  if (data == null) return null;
  if (typeof data === "bigint") return data;
  if (Array.isArray(data) && data.length > 0) return readContractUint256(data[0]);
  if (typeof data === "string") {
    const t = data.trim();
    if (!t) return null;
    if (t.startsWith("0x")) return BigInt(t);
    if (/^-?\d+$/.test(t)) return BigInt(t);
    return null;
  }
  if (typeof data === "number" && Number.isFinite(data)) return BigInt(Math.trunc(data));
  return null;
}

function trimDecimalString(s) {
  if (!s.includes(".")) return s;
  let out = s.replace(/0+$/, "");
  if (out.endsWith(".")) out = out.slice(0, -1);
  return out || "0";
}

/**
 * Display USDT from wei without Number() (avoids precision loss / scientific notation on large values).
 * @param {unknown} weiLike
 * @param {number} [decimals]
 * @returns {string | null}
 */
export function formatUsdtTrim(weiLike, decimals = USDT_DECIMALS) {
  const w = readContractUint256(weiLike);
  if (w == null) return null;
  return trimDecimalString(formatUnits(w, decimals));
}

/** Default on-chain referral withdraw chunk (10 USDT) in wei for the active decimal scale. */
export function defaultReferralWithdrawChunkWei(decimals = USDT_DECIMALS) {
  return parseUnits("10", decimals);
}
