import { formatUnits } from "viem";
import { USDT_DECIMALS } from "../constants/usdtDecimals";

/** Matches ReferralContract views used for L1–L10 copy and dashboard pyramid. */
export const REFERRAL_TIER_READ_ABI = [
  { name: "referralTotalAmount", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "levelAmounts", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { name: "minDirectReferralsRequired", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
];

export function trimUsdtAmountString(s) {
  const out = String(s || "").replace(/\.?0+$/, "");
  return out || "0";
}

/**
 * Per-recipient USDT (trimmed string) for support/pyramid copy: L1 = full gross; L2+ = gross / minDirects.
 */
export function perTradeUsdtStringFromTier(grossWei, divWei, levelIndex0) {
  const gross = typeof grossWei === "bigint" ? grossWei : BigInt(String(grossWei ?? 0));
  const divRaw = typeof divWei === "bigint" ? divWei : BigInt(String(divWei ?? 1));
  const d = levelIndex0 === 0 ? 1n : divRaw > 0n ? divRaw : 1n;
  const per = gross / d;
  return trimUsdtAmountString(formatUnits(per, USDT_DECIMALS));
}

/** Fallback when RPC fails — matches default ReferralContract constructor. */
export function getDefaultReferralSupportRows() {
  const grossWei = [
    500000000000000000n,
    250000000000000000n,
    250000000000000000n,
    250000000000000000n,
    150000000000000000n,
    150000000000000000n,
    150000000000000000n,
    100000000000000000n,
    100000000000000000n,
    100000000000000000n,
  ];
  const div = [1n, 2n, 3n, 4n, 5n, 6n, 6n, 6n, 6n, 6n];
  const rows = [];
  for (let i = 0; i < 10; i++) {
    rows.push({
      level: i + 1,
      directs: Number(div[i]),
      perTradeUsdt: perTradeUsdtStringFromTier(grossWei[i], div[i], i),
    });
  }
  let totalWei = 0n;
  for (const g of grossWei) totalWei += g;
  const totalUsdt = trimUsdtAmountString(formatUnits(totalWei, USDT_DECIMALS));
  return { rows, totalUsdt };
}

/** Map level 1..10 → per-trade USDT string (pyramid fallback). */
export function defaultTierPerTradeUsdMap() {
  const { rows } = getDefaultReferralSupportRows();
  const o = {};
  for (const r of rows) o[r.level] = r.perTradeUsdt;
  return o;
}
