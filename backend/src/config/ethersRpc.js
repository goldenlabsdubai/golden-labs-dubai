import { ethers } from "ethers";

/**
 * RPC for referral indexer, backfill, and on-chain referral reads (`eth_getLogs`, `referralEarnings`, `referrerOf`).
 * Prefer a dedicated BSC endpoint here (e.g. Chainstack) so `RPC_URL` can stay on a public seed for the rest of the API.
 */
export function getReferralRpcUrl() {
  return (process.env.REFERRAL_RPC_URL || process.env.RPC_URL || "").trim();
}

/**
 * Pinned JsonRpcProvider for BSC mainnet (default). Avoids ethers v6 "detect network"
 * probe spam and cold-start failures when the RPC is slow or rate-limited.
 *
 * Set CHAIN_ID in .env to override (must match RPC_URL network).
 */
export function createPinnedJsonRpcProvider(rpcUrl) {
  const url = String(rpcUrl || "").trim();
  if (!url) throw new Error("createPinnedJsonRpcProvider: empty rpcUrl");

  const raw = process.env.CHAIN_ID;
  const chainId = raw != null && String(raw).trim() !== "" ? Number.parseInt(String(raw).trim(), 10) : 56;
  const safeId = Number.isFinite(chainId) && chainId > 0 ? chainId : 56;

  return new ethers.JsonRpcProvider(url, safeId, { staticNetwork: true });
}
