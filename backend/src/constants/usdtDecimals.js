/**
 * USDT (BEP20) decimals — Golden Labs mainnet stack uses 18-decimal USDT.
 * Set USDT_DECIMALS=6 only if you point at a legacy 6-decimal test token.
 */
const n = Number.parseInt(String(process.env.USDT_DECIMALS || "18"), 10);
export const USDT_DECIMALS = Number.isFinite(n) && n >= 0 && n <= 36 ? n : 18;
