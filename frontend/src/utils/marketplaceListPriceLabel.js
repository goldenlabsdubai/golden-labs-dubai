import { formatUnits } from "viem";

/** Display string for USDT from 6-decimal wei (matches on-chain `listPrice` / listing amounts). */
export function marketplaceListPriceUsdtLabel(wei) {
  if (wei == null) return null;
  try {
    const s = formatUnits(BigInt(wei), 6);
    return s.includes(".") ? s.replace(/\.?0+$/, "") || "0" : s;
  } catch {
    return null;
  }
}
