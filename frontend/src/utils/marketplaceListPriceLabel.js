import { formatUnits } from "viem";
import { USDT_DECIMALS } from "../constants/usdtDecimals";

/** Display string for USDT from token wei (matches on-chain `listPrice` / listing amounts). */
export function marketplaceListPriceUsdtLabel(wei) {
  if (wei == null) return null;
  try {
    const s = formatUnits(BigInt(wei), USDT_DECIMALS);
    return s.includes(".") ? s.replace(/\.?0+$/, "") || "0" : s;
  } catch {
    return null;
  }
}
