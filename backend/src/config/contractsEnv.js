/**
 * MarketplaceAndReservePoolContract – single env for marketplace + on-chain reserve.
 * Env: MARKETPLACE_AND_RESERVE_POOL_CONTRACT_ADDRESS
 * Legacy fallback: MARKETPLACE_CONTRACT_ADDRESS (Node/backend only).
 */
export function getMarketplaceAndReservePoolAddress() {
  const v =
    process.env.MARKETPLACE_AND_RESERVE_POOL_CONTRACT_ADDRESS ||
    process.env.MARKETPLACE_CONTRACT_ADDRESS ||
    "";
  return typeof v === "string" ? v.trim() : "";
}
