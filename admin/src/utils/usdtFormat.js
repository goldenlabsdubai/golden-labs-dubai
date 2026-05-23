import { formatUnits } from "viem";

const USDT_DECIMALS = Number(import.meta.env.VITE_USDT_DECIMALS || 18) || 18;

export function formatUsdtFromWei(wei) {
  if (wei == null || wei === "") return "0.00";
  try {
    const raw = String(wei).split(".")[0] || "0";
    return Number.parseFloat(formatUnits(BigInt(raw), USDT_DECIMALS)).toFixed(2);
  } catch {
    return "0.00";
  }
}

export function formatUsdtDisplay(usdtStr) {
  if (usdtStr == null || usdtStr === "") return "0.00";
  const n = Number.parseFloat(String(usdtStr));
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}
