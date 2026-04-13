/**
 * Default matches MarketplaceAndReservePoolContract.tradingIncomeAmount (0.75 USDT, 6 decimals).
 * Override with MARKETPLACE_TRADING_INCOME_WEI if chain config differs and RPC is unused.
 */
export function getTradingIncomePerSellWeiFromEnv() {
  const raw = String(process.env.MARKETPLACE_TRADING_INCOME_WEI || "750000").trim();
  try {
    const v = BigInt(raw);
    return v > 0n ? v : 750000n;
  } catch {
    return 750000n;
  }
}
