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

function trimEnv(key) {
  const v = process.env[key];
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Single on-chain deployment cluster (backend .env). Frontend VITE_* must match these for Subscribe/Mint/List.
 */
export function getDeployedContractsSnapshot() {
  return {
    usdtAddress: trimEnv("USDT_ADDRESS"),
    subscriptionContractAddress: trimEnv("SUBSCRIPTION_CONTRACT_ADDRESS"),
    nftContractAddress: trimEnv("NFT_CONTRACT_ADDRESS"),
    marketplaceAndReservePoolAddress: getMarketplaceAndReservePoolAddress(),
    referralContractAddress: trimEnv("REFERRAL_CONTRACT_ADDRESS"),
    referralEventsContractAddress: trimEnv("REFERRAL_EVENTS_CONTRACT_ADDRESS"),
  };
}

/** Call once on server start — makes PM2 logs show exactly which cluster this process uses. */
export function logDeployedContractsCluster() {
  const s = getDeployedContractsSnapshot();
  console.log(
    "[contracts] cluster — subscription=%s nft=%s marketplace=%s referral=%s usdt=%s",
    s.subscriptionContractAddress || "(unset)",
    s.nftContractAddress || "(unset)",
    s.marketplaceAndReservePoolAddress || "(unset)",
    s.referralContractAddress || "(unset)",
    s.usdtAddress || "(unset)"
  );
  const missing = [];
  if (!s.subscriptionContractAddress) missing.push("SUBSCRIPTION_CONTRACT_ADDRESS");
  if (!s.nftContractAddress) missing.push("NFT_CONTRACT_ADDRESS");
  if (!s.marketplaceAndReservePoolAddress) missing.push("MARKETPLACE_AND_RESERVE_POOL_CONTRACT_ADDRESS");
  if (missing.length) console.warn("[contracts] missing env (stack incomplete):", missing.join(", "));
}
