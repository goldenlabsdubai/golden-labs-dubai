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

/** Primary BSC RPC for marketplace, subscription sync, mint config, etc. */
export function getMainRpcUrl() {
  return (process.env.RPC_URL || "http://127.0.0.1:8545").trim();
}

const providerByUrl = new Map();

/** One pinned JsonRpcProvider per RPC URL (avoids eth_chainId / detect-network per request). */
export function getSharedJsonRpcProvider(rpcUrl) {
  const url = String(rpcUrl || "").trim();
  if (!url) throw new Error("getSharedJsonRpcProvider: empty rpcUrl");
  let provider = providerByUrl.get(url);
  if (!provider) {
    provider = createPinnedJsonRpcProvider(url);
    providerByUrl.set(url, provider);
  }
  return provider;
}

export function getSharedMainRpcProvider() {
  return getSharedJsonRpcProvider(getMainRpcUrl());
}

export function getSharedReferralRpcProvider() {
  const url = getReferralRpcUrl();
  if (!url) throw new Error("getSharedReferralRpcProvider: REFERRAL_RPC_URL or RPC_URL required");
  return getSharedJsonRpcProvider(url);
}

export function isRpcRateLimitError(e) {
  const msg = (e?.message || "") + JSON.stringify(e?.value || []);
  return (
    msg.includes("rate limit") ||
    msg.includes("-32005") ||
    msg.includes("403") ||
    msg.includes("compute units per second") ||
    e?.value?.[0]?.error?.code === -32005 ||
    e?.code === 429
  );
}
